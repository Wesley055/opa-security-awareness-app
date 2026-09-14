"""Allowlisted supervisor observations; never serialize args, output or exceptions."""
import contextlib
import ctypes
import json
import pathlib
import shutil
import subprocess
import time

def resources():
    result = {"diskFreeBytes": shutil.disk_usage(pathlib.Path.cwd()).free}
    if hasattr(ctypes, "windll"):
        class Memory(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong) for name in
                ("total", "available", "totalPage", "availablePage", "totalVirtual", "availableVirtual", "extended")]
        value = Memory()
        value.length = ctypes.sizeof(value)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
            result.update(memoryAvailableBytes=value.available, memoryTotalBytes=value.total)
    return result

class Recorder:
    def __init__(self, file=None):
        self.file = file
        self.events = []
        self.versions = {}
        self.last_stage = "invocation"
        self.failure_stage = None
    def save(self):
        if self.file:
            self.file.parent.mkdir(parents=True, exist_ok=True)
            self.file.write_text(json.dumps({"events": self.events, "toolchain": self.versions}, indent=2))
    @contextlib.contextmanager
    def operation(self, stage, command):
        self.last_stage = stage
        start = time.monotonic()
        item = {"stage": stage, "command": command, "exitCode": None, "signal": None,
                "exceptionClass": None, "timeout": False}
        try:
            yield item
        except Exception as exc:
            if self.failure_stage is None:
                self.failure_stage = stage
            known = {"TimeoutExpired", "CalledProcessError", "ReadTimeout", "ConnectTimeout",
                     "ConnectionError", "RuntimeError", "ValueError", "JSONDecodeError",
                     "FileNotFoundError", "OSError", "BrokenPipeError"}
            item["exceptionClass"] = type(exc).__name__ if type(exc).__name__ in known else "Exception"
            item["timeout"] = isinstance(exc, subprocess.TimeoutExpired) or type(exc).__name__ in {"ReadTimeout", "ConnectTimeout"}
            trace = exc.__traceback__
            while trace:
                filename = pathlib.Path(trace.tb_frame.f_code.co_filename).name
                if filename in {"run-protected-migration.py", "runner_runtime.py"}:
                    item["source"] = {"file": filename, "line": trace.tb_lineno,
                                      "function": trace.tb_frame.f_code.co_name}
                trace = trace.tb_next
            code = getattr(exc, "returncode", None)
            if isinstance(code, int):
                item["exitCode"] = code
                item["signal"] = -code if code < 0 else None
            raise
        finally:
            item["durationMs"] = round((time.monotonic() - start) * 1000)
            item["resources"] = resources()
            self.events.append(item)
            self.save()
    def call(self, stage, command, fn, *args, **kwargs):
        with self.operation(stage, command) as item:
            result = fn(*args, **kwargs)
            code = getattr(result, "returncode", None)
            if isinstance(code, int):
                item["exitCode"] = code
                item["signal"] = -code if code < 0 else None
            return result

def cleanup_step(name, action, recorder, outcomes):
    """Each resource cleanup runs even when a previous cleanup raised."""
    try:
        with recorder.operation("cleanup." + name, "cleanup." + name):
            outcomes[name] = action() is True
    except Exception:
        outcomes[name] = False
    return outcomes[name]
