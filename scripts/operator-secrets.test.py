#!/usr/bin/env python3
"""Synthetic-only tests for local operator credential preparation."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("operator-secrets.py")


class StorageTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("operator_secrets", SCRIPT)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        (self.home / "Developer").mkdir()
        self.source = self.home / "source.secret"
        self.source.write_bytes(b"SYNTHETIC-ONLY-DO-NOT-PRINT\n")
        self.source.chmod(0o600)
        self.store = self.home / "Developer" / "Loynara-secrets"
        self.entries = [{"id": "test-token", "source": str(self.source), "destination": "production/test.secret"}]

    def operate(self, verify=False):
        return self.mod.prepare(self.entries, self.store, home=self.home, verify=verify)

    def test_copy_is_private_complete_and_preserves_source(self):
        before = self.source.stat()
        result = self.operate()
        target = self.store / "production/test.secret"
        self.assertEqual(target.read_bytes(), self.source.read_bytes())
        self.assertEqual(result, [{"id": "test-token", "status": "prepared"}])
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        for path in [self.store, target.parent]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
        self.assertEqual(before.st_mtime_ns, self.source.stat().st_mtime_ns)
        self.assertEqual(before.st_ino, self.source.stat().st_ino)

    def test_retry_and_verification_do_not_rewrite(self):
        self.operate()
        target = self.store / "production/test.secret"
        before = target.stat()
        self.assertEqual(self.operate()[0]["status"], "verified-existing")
        self.assertEqual(self.operate(verify=True)[0]["status"], "verified")
        self.assertEqual(before.st_ino, target.stat().st_ino)
        self.assertEqual(before.st_mtime_ns, target.stat().st_mtime_ns)

    def test_conflicting_existing_copy_is_not_overwritten(self):
        self.operate()
        target = self.store / "production/test.secret"
        target.write_bytes(b"other synthetic credential")
        with self.assertRaises(self.mod.Refused):
            self.operate()
        self.assertEqual(target.read_bytes(), b"other synthetic credential")

    def test_verify_never_creates_store(self):
        with self.assertRaises(self.mod.Refused):
            self.operate(verify=True)
        self.assertFalse(self.store.exists())

    def test_refuses_synced_destination(self):
        self.store = self.home / "Desktop" / "secrets"
        with self.assertRaises(self.mod.Refused):
            self.operate()
        self.assertFalse(self.store.exists())

    def test_refuses_repository_destination(self):
        (self.home / "Developer/.git").write_text("synthetic worktree marker")
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_repository_nested_inside_store(self):
        self.store.mkdir(mode=0o700)
        nested = self.store / "production"
        nested.mkdir(mode=0o700)
        (nested / ".git").mkdir(mode=0o700)
        with self.assertRaises(self.mod.Refused):
            self.operate()
        self.assertFalse((nested / "test.secret").exists())

    @unittest.skipUnless(sys.platform == "darwin", "macOS extended ACL regression")
    def test_refuses_store_with_inheritable_read_acl(self):
        self.store.mkdir(mode=0o700)
        subprocess.run([
            "chmod", "+a",
            "everyone allow read,execute,readattr,readextattr,readsecurity,file_inherit,directory_inherit",
            str(self.store),
        ], check=True, capture_output=True)
        with self.assertRaises(self.mod.Refused):
            self.operate()
        self.assertFalse((self.store / "production/test.secret").exists())
        self.assertEqual(list(self.store.rglob("*.pending")), [])

    def test_destination_parent_swap_cannot_redirect_publication(self):
        self.store.mkdir(mode=0o700)
        nested = self.store / "production"
        nested.mkdir(mode=0o700)
        outside = self.home / "Desktop"
        outside.mkdir(mode=0o700)
        original_publish = self.mod.publish

        def swap_parent_before_publication(*args, **kwargs):
            nested.rename(self.store / "old-production")
            nested.symlink_to(outside, target_is_directory=True)
            return original_publish(*args, **kwargs)

        with patch.object(self.mod, "publish", side_effect=swap_parent_before_publication):
            try:
                self.operate()
            except self.mod.Refused:
                pass
        self.assertEqual(list(outside.iterdir()), [])

    def test_refuses_symlinked_destination_ancestor(self):
        original = self.home / "Developer"
        original.rename(self.home / "actual")
        original.symlink_to(self.home / "actual", target_is_directory=True)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_symlinked_source(self):
        link = self.home / "linked.secret"
        link.symlink_to(self.source)
        self.entries[0]["source"] = str(link)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_hardlinked_source(self):
        os.link(self.source, self.home / "linked.secret")
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_fifo_without_opening_it(self):
        fifo = self.home / "fifo"
        os.mkfifo(fifo, 0o600)
        self.entries[0]["source"] = str(fifo)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_source_with_broad_permissions(self):
        self.source.chmod(0o644)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_cloud_placeholder_before_read(self):
        with patch.object(self.mod, "is_dataless", return_value=True):
            with self.assertRaises(self.mod.Refused):
                self.operate()

    def test_cloud_placeholder_file_is_never_opened(self):
        parent = os.open(self.source.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with patch.object(self.mod, "is_dataless", return_value=True), patch.object(
                    self.mod.os, "open", side_effect=AssertionError("placeholder opened")):
                with self.assertRaises(self.mod.Refused):
                    self.mod.read_private_at(parent, self.source.name)
        finally:
            os.close(parent)

    def test_cloud_placeholder_directory_is_never_opened(self):
        parent = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with patch.object(self.mod, "is_dataless", return_value=True), patch.object(
                    self.mod.os, "open", side_effect=AssertionError("placeholder opened")):
                with self.assertRaises(self.mod.Refused):
                    self.mod.directory_child(parent, "Developer")
        finally:
            os.close(parent)

    def test_refuses_oversize_secret(self):
        with patch.object(self.mod, "MAX_BYTES", 4):
            with self.assertRaises(self.mod.Refused):
                self.operate()

    def test_refuses_destination_traversal_and_duplicates(self):
        for name in ["../escape", "/absolute", "a/../../escape", "a//b", "a/./b"]:
            with self.subTest(name=name):
                self.entries[0]["destination"] = name
                with self.assertRaises(self.mod.Refused):
                    self.operate()
        self.entries[0]["destination"] = "test.secret"
        self.entries.append(dict(self.entries[0], id="second-token"))
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_existing_store_with_broad_permissions(self):
        self.store.mkdir(mode=0o755)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_refuses_symlinked_or_hardlinked_existing_copy(self):
        self.operate()
        target = self.store / "production/test.secret"
        target.unlink()
        target.symlink_to(self.source)
        with self.assertRaises(self.mod.Refused):
            self.operate()
        target.unlink()
        os.link(self.source, target)
        with self.assertRaises(self.mod.Refused):
            self.operate()

    def test_all_sources_preflight_before_any_copy(self):
        self.entries.append({"id": "missing", "source": str(self.home / "missing"), "destination": "missing.secret"})
        with self.assertRaises(self.mod.Refused):
            self.operate()
        self.assertFalse((self.store / "production/test.secret").exists())

    def test_failed_publication_cleans_its_own_temp_only(self):
        with patch.object(self.mod.os, "link", side_effect=OSError("synthetic failure")):
            with self.assertRaises(self.mod.Refused):
                self.operate()
        self.assertEqual(list(self.store.rglob("*.pending")), [])
        self.assertTrue(self.source.exists())

    def test_bad_manifest_cli_does_not_echo_input_or_traceback(self):
        manifest = self.home / "bad.json"
        manifest.write_text("SYNTHETIC-SECRET-MALFORMED-JSON")
        manifest.chmod(0o600)
        result = subprocess.run([sys.executable, str(SCRIPT), "prepare", "--manifest", str(manifest)], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("SYNTHETIC-SECRET", result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
