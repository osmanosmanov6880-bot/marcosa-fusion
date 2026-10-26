#!/usr/bin/env python3
"""R121: non-root, read-only streaming SHA-256 of publicly served top-level files.

Read only the public root used by the already reviewed R101/R118 parity auditor.
Never follow symlinks, enumerate private directories or read a database. Output
is public filenames, byte counts and hashes, NEVER file contents or credentials.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

FORMAT = "MARCOSA-R121-LEGACY-PUBLIC-FILE-INVENTORY-v1"
SUFFIXES = frozenset({".html", ".htm", ".css", ".js", ".mjs", ".svg",
                      ".webp", ".png", ".jpg", ".jpeg", ".json"})
EXCLUDED = frozenset({"config.json", "secrets.json", "settings.json", "credentials.json"})
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_FILES = 128
CRITICAL = ("developer-console.js", "interaction-bridge.js", "marcosa-config.js",
            "marcosa-supabase.js", "nexus.js")


def allowed_name(name: str) -> bool:
    return (bool(NAME.fullmatch(name)) and not name.startswith(".")
            and ".env" not in name.lower() and name.lower() not in EXCLUDED
            and Path(name).suffix.lower() in SUFFIXES)


def collect_public(root: Path) -> dict:
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Public root must be a real directory, not a symlink")
    entries = []
    # Match R101's public top-level whitelist; never recurse.
    for entry in root.iterdir():
        if entry.is_file() and not entry.is_symlink() and not entry.name.startswith(".") \
                and entry.suffix.lower() in SUFFIXES and entry.name.lower() not in EXCLUDED:
            if not allowed_name(entry.name):
                raise ValueError("Unsafe visible public filename")
            entries.append(entry.name)
    entries.sort()
    if not 1 <= len(entries) <= MAX_FILES or "index.html" not in entries:
        raise ValueError("Missing public index or implausible public file count")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    directory_flags = flags | getattr(os, "O_DIRECTORY", 0)
    directory_fd = os.open(str(root), directory_flags)
    total = 0
    files = []
    try:
        for name in entries:
            fd = os.open(name, flags, dir_fd=directory_fd)
            try:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE_BYTES:
                    raise ValueError("Not a bounded regular public file")
                digest = hashlib.sha256()
                count = 0
                while True:
                    part = os.read(fd, 65536)
                    if not part:
                        break
                    count += len(part)
                    if count > MAX_FILE_BYTES:
                        raise ValueError("Public file exceeded streaming size cap")
                    digest.update(part)
                after = os.fstat(fd)
                if (before.st_size != count or after.st_size != count
                        or before.st_ino != after.st_ino
                        or before.st_mtime_ns != after.st_mtime_ns):
                    raise ValueError("Public file changed during a read-only audit")
                # Detect replaced path after open: never claim the current name
                # is hashed if it now points to a different inode.
                now = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if now.st_ino != after.st_ino or now.st_dev != after.st_dev:
                    raise ValueError("Public file path changed during hashing")
            finally:
                os.close(fd)
            total += count
            if total > MAX_TOTAL_BYTES:
                raise ValueError("Excessive total public file bytes")
            files.append({"name": name, "bytes": count, "sha256": digest.hexdigest()})
    finally:
        os.close(directory_fd)
    index_hash = next(f["sha256"] for f in files if f["name"] == "index.html")
    return {
        "format": FORMAT,
        "readOnly": True,
        "productionAuthorized": False,
        "publicTopLevelOnly": True,
        "fileCount": len(files),
        "totalBytes": total,
        "indexSha256": index_hash,
        "criticalPresent": sorted(x for x in CRITICAL if x in entries),
        "files": files,
    }


def main() -> int:
    if os.geteuid() == 0 or os.getenv("USER") != "marcosa-deploy":
        raise ValueError("Only non-root marcosa-deploy may inspect public filenames")
    result = collect_public(Path("/opt/marcosa/current"))
    print(json.dumps(result, sort_keys=True, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as exc:
        print("R121_PUBLIC_HASH_INVENTORY_BLOCKED=" + type(exc).__name__, file=sys.stderr)
        raise SystemExit(2)
