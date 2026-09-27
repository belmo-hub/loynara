#!/usr/bin/env python3
"""Local macOS PC/SC bridge. JSON lines on stdio; never logs APDUs or keys."""

import ctypes
import ctypes.util
import json
import sys


class PcscError(Exception):
    pass


library_name = ctypes.util.find_library("PCSC") or ctypes.util.find_library("pcsclite")
if not library_name:
    print(json.dumps({"ready": False, "error": "PC/SC transport unavailable"}), flush=True)
    sys.exit(1)
pcsc = ctypes.CDLL(library_name)
scope = ctypes.c_void_p()
handle = ctypes.c_void_p()
protocol = ctypes.c_uint32()


class IoRequest(ctypes.Structure):
    _fields_ = [("protocol", ctypes.c_uint32), ("length", ctypes.c_uint32)]


def check(code, operation):
    if code != 0:
        raise PcscError(f"{operation} failed (PC/SC 0x{code & 0xffffffff:08x})")


def readers():
    size = ctypes.c_uint32(0)
    result = pcsc.SCardListReaders(scope, None, None, ctypes.byref(size))
    if result & 0xffffffff == 0x8010002e:  # SCARD_E_NO_READERS_AVAILABLE
        return []
    check(result, "reader enumeration")
    buffer = ctypes.create_string_buffer(size.value)
    check(pcsc.SCardListReaders(scope, None, buffer, ctypes.byref(size)), "reader enumeration")
    return [name.decode("utf-8", "replace") for name in buffer.raw.split(b"\x00") if name]


def connect(name):
    global handle, protocol
    if handle.value:
        pcsc.SCardDisconnect(handle, 0)
        handle = ctypes.c_void_p()
    if name not in readers():
        raise PcscError("selected reader not found")
    check(pcsc.SCardConnect(scope, name.encode(), 2, 3, ctypes.byref(handle), ctypes.byref(protocol)), "card connection")
    if protocol.value != 2:
        raise PcscError("card did not negotiate PC/SC T=1 / ISO-DEP")
    atr = ctypes.create_string_buffer(64)
    atr_size = ctypes.c_uint32(64)
    state = ctypes.c_uint32()
    proto = ctypes.c_uint32()
    reader_buffer = ctypes.create_string_buffer(512)
    reader_size = ctypes.c_uint32(512)
    check(pcsc.SCardStatus(handle, reader_buffer, ctypes.byref(reader_size), ctypes.byref(state), ctypes.byref(proto), atr, ctypes.byref(atr_size)), "card status")
    return {"protocol": "T=1", "atr": atr.raw[:atr_size.value].hex()}


def transmit(hex_apdu):
    if not handle.value:
        raise PcscError("no selected card")
    if not isinstance(hex_apdu, str) or len(hex_apdu) > 1024 or len(hex_apdu) % 2:
        raise PcscError("invalid APDU framing")
    command = bytes.fromhex(hex_apdu)
    output = ctypes.create_string_buffer(4096)
    output_size = ctypes.c_uint32(4096)
    io = IoRequest(protocol.value, ctypes.sizeof(IoRequest))
    check(pcsc.SCardTransmit(handle, ctypes.byref(io), command, len(command), None, output, ctypes.byref(output_size)), "APDU exchange")
    return output.raw[:output_size.value].hex()


try:
    check(pcsc.SCardEstablishContext(2, None, None, ctypes.byref(scope)), "PC/SC context")
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            operation = request.get("operation")
            if operation == "readers":
                result = readers()
            elif operation == "connect":
                result = connect(request["reader"])
            elif operation == "transmit":
                result = transmit(request["apdu"])
            elif operation == "disconnect":
                if handle.value:
                    pcsc.SCardDisconnect(handle, 0)
                    handle = ctypes.c_void_p()
                result = True
            else:
                raise PcscError("unsupported bridge operation")
            print(json.dumps({"ok": True, "result": result}), flush=True)
        except (PcscError, KeyError, ValueError, TypeError) as error:
            print(json.dumps({"ok": False, "error": str(error)}), flush=True)
finally:
    if handle.value:
        pcsc.SCardDisconnect(handle, 0)
    if scope.value:
        pcsc.SCardReleaseContext(scope)
