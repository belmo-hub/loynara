#!/usr/bin/env python3
"""Prepare or verify private local copies. Never rotates or deletes credentials."""
import argparse
import ctypes
import errno
import fcntl
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import sys

MAX_BYTES = 1024 * 1024


class Refused(Exception):
    pass


def is_dataless(info):
    return bool(getattr(info, "st_flags", 0) & 0x40000000)


def no_symlinks(path):
    if not path.is_absolute() or ".." in path.parts:
        raise Refused("absolute paths without traversal required")
    for item in [*reversed(path.parents), path]:
        if item.is_symlink():
            raise Refused("symlink paths refused")


def no_acl(descriptor):
    if sys.platform == "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        libc.acl_get_fd_np.argtypes = [ctypes.c_int, ctypes.c_int]
        libc.acl_get_fd_np.restype = ctypes.c_void_p
        libc.acl_free.argtypes = [ctypes.c_void_p]
        ctypes.set_errno(0)
        acl = libc.acl_get_fd_np(descriptor, 0x100)  # ACL_TYPE_EXTENDED
        if not acl:
            if ctypes.get_errno() == errno.ENOENT:
                return  # Darwin reports the absence of an extended ACL this way.
            raise Refused("ACL inspection failed")
        try:
            raise Refused("extended ACL refused")
        finally:
            libc.acl_free(acl)
    else:
        for name in ("system.posix_acl_access", "system.posix_acl_default"):
            try:
                if os.getxattr(descriptor, name):
                    raise Refused("extended ACL refused")
            except OSError as error:
                if error.errno not in (errno.ENODATA, errno.ENOTSUP):
                    raise


def private_file_metadata(before):
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
            or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) not in (0o400, 0o600)
            or before.st_size > MAX_BYTES or is_dataless(before)):
        raise Refused("private resident regular file required")


def regular_private(descriptor):
    before = os.fstat(descriptor)
    private_file_metadata(before)
    no_acl(descriptor)
    return before


def read_private_at(parent, name):
    inspected = os.stat(name, dir_fd=parent, follow_symlinks=False)
    private_file_metadata(inspected)
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(descriptor, "rb") as handle:
        before = regular_private(handle.fileno())
        if (before.st_dev, before.st_ino) != (inspected.st_dev, inspected.st_ino):
            raise Refused("source changed before opening")
        data = handle.read(MAX_BYTES + 1)
        after = os.fstat(handle.fileno())
    if (len(data) > MAX_BYTES or len(data) != before.st_size
            or (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                before.st_size, before.st_mtime_ns, before.st_ctime_ns)):
        raise Refused("file changed or exceeds size limit")
    return data


def reject_repository(descriptor):
    try:
        os.stat(".git", dir_fd=descriptor, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise Refused("repository destination refused")


def directory_child(parent, name, *, create=False, private=False, repository_check=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
        except FileExistsError:
            pass
    inspected = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not stat.S_ISDIR(inspected.st_mode) or is_dataless(inspected):
        raise Refused("resident directory required")
    descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = os.fstat(descriptor)
        if (is_dataless(info) or (info.st_dev, info.st_ino) != (inspected.st_dev, inspected.st_ino)):
            raise Refused("directory changed before opening")
        if private:
            if (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700 or is_dataless(info)):
                raise Refused("owner-only resident directory required")
            no_acl(descriptor)
        if repository_check:
            reject_repository(descriptor)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def open_directory(path, *, create_final=False, private_final=False, repository_check=False):
    no_symlinks(path)
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for i, name in enumerate(path.parts[1:], 1):
            final = i == len(path.parts) - 1
            child = directory_child(descriptor, name, create=create_final and final,
                                    private=private_final and final, repository_check=repository_check)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def read_private(path):
    no_symlinks(path)
    parent = open_directory(path.parent)
    try:
        return read_private_at(parent, path.name)
    finally:
        os.close(parent)


def validate_store(store, home):
    no_symlinks(store)
    developer = home / "Developer"
    if not store.is_relative_to(developer) or store == developer:
        raise Refused("store must be beneath the nonsynced Developer directory")
    # No custom sync location or repository should be nested around the store.
    forbidden = {"Desktop", "Documents", "Dropbox", "OneDrive", "Google Drive", "CloudStorage", "Mobile Documents"}
    for parent in [store, *store.parents]:
        if parent.name in forbidden or (parent / ".git").exists():
            raise Refused("repository or synced storage refused")
    for parent in reversed(store.parents):
        if parent == developer or parent.is_relative_to(developer):
            info = parent.lstat()
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o022:
                raise Refused("writable or foreign-owned storage ancestor refused")


def validate_entries(entries):
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise Refused("manifest must contain one to one hundred entries")
    ids, names = set(), set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"id", "source", "destination"}:
            raise Refused("invalid manifest entry")
        identifier, source, name = entry["id"], entry["source"], entry["destination"]
        if (not all(isinstance(v, str) for v in (identifier, source, name))
                or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", identifier)
                or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*){0,3}", name)
                or identifier in ids or name in names):
            raise Refused("invalid or duplicate manifest names")
        no_symlinks(Path(source))
        ids.add(identifier)
        names.add(name)


def publish(parent, name, data):
    temporary = "copy-" + secrets.token_hex(16) + ".pending"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            regular_private(handle.fileno())
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # link publishes only a complete file and fails if the target exists.
        os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
    finally:
        os.unlink(temporary, dir_fd=parent)
    os.fsync(parent)
    if not hmac.compare_digest(read_private_at(parent, name), data):
        raise Refused("published copy verification failed")


def prepare(entries, store, *, home=None, verify=False):
    home = Path.home() if home is None else Path(home)
    store = Path(store)
    directories = []
    try:
        validate_entries(entries)
        validate_store(store, home)
        contents = [(entry, read_private(Path(entry["source"]))) for entry in entries]
        root = open_directory(store, create_final=not verify, private_final=True, repository_check=True)
        directories.append(root)
        # Verification does not create files, including the lock.
        flags = os.O_RDONLY if verify else os.O_RDWR | os.O_CREAT
        lock = os.open(".preparation.lock", flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=root)
        with os.fdopen(lock, "rb" if verify else "r+b") as handle:
            regular_private(handle.fileno())
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            work = []
            for entry, data in contents:
                if Path(entry["source"]).is_relative_to(store):
                    raise Refused("source cannot be inside destination store")
                parts = entry["destination"].split("/")
                parent = root
                for component in parts[:-1]:
                    parent = directory_child(parent, component, create=not verify,
                                             private=True, repository_check=True)
                    directories.append(parent)
                name = parts[-1]
                try:
                    os.stat(name, dir_fd=parent, follow_symlinks=False)
                    exists = True
                except FileNotFoundError:
                    exists = False
                if exists:
                    if not hmac.compare_digest(read_private_at(parent, name), data):
                        raise Refused("existing destination differs; no overwrite permitted")
                elif verify:
                    raise Refused("prepared copy missing")
                work.append((entry, parent, name, data, exists))
            results = []
            for entry, parent, name, data, exists in work:
                if not exists:
                    publish(parent, name, data)
                results.append({"id": entry["id"], "status": "verified" if verify else "verified-existing" if exists else "prepared"})
            return results
    except (OSError, ValueError, TypeError):
        raise Refused("local storage operation failed; sources preserved") from None
    finally:
        for descriptor in reversed(directories):
            os.close(descriptor)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise Refused("invalid command arguments")


def main():
    parser = SafeParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "verify"])
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--store", type=Path, default=Path.home() / "Developer/Loynara-secrets")
    try:
        args = parser.parse_args()
        # Bound unexpected local I/O stalls without echoing the failing path.
        def timeout(_signum, _frame):
            raise Refused("local file operation timed out")
        signal.signal(signal.SIGALRM, timeout)
        signal.alarm(30)
        manifest = json.loads(read_private(args.manifest))
        if not isinstance(manifest, dict) or set(manifest) != {"files"}:
            raise Refused("invalid manifest schema")
        result = prepare(manifest["files"], args.store, verify=args.action == "verify")
        signal.alarm(0)
        print(json.dumps({"files": result, "sources_deleted": False, "production_changed": False}))
        return 0
    except (Refused, OSError, ValueError, TypeError):
        # Fixed diagnostic: exceptions can include content, paths or JSON fragments.
        print("Credential preparation refused. Check private metadata and the runbook; no sources were deleted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
