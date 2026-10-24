#!/usr/bin/env python3
"""Fail-closed audit for accidental private material in the public source tree.

This is a *supplement* to manual review and GitHub secret protection.
It does not certify the safety of arbitrary code or the production server.
"""
from __future__ import annotations
import pathlib
import hashlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FORBIDDEN_PATH = re.compile(
    r"(^|/)(?:\.ssh|private|secrets|brief-crops|backups?|node_modules|__pycache__)(/|$)"
    r"|(?:^|/)\.env(?:$|\.)|(?:\.(?:pem|p12|pfx|key|sqlite|sqlite3|db|zip|tar|tgz|gz)$)",
    re.IGNORECASE,
)
CONTENT_MATCHES = {
    "PEM private key": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b"),
    "OpenAI key": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b"),
    "AWS Access Key ID": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Slack secret": re.compile(r"\bxox[baprs]-[a-zA-Z0-9-]{24,}\b"),
    "Supabase service-role JWT": re.compile(r"(?i)service_role['\"\s]*[:=]['\"\s]*eyJ"),
}
TEXT_EXT = {".md", ".js", ".css", ".html", ".json", ".py", ".yml", ".yaml", ".txt", ".csv", ".cjs", ".sh", ".sql", ".ps1"}
# R19 self-contained authored cinema is deliberately >1 MB due to embedded WebP.
# Exactly these reviewed immutable snapshots are accepted; hash mismatches fail closed.
REVIEWED_R19_LARGE = {
    "site/film-signal-worlds.html": "a8f7f6b5b689851da0e6b5fd5bee751ae077ae949da0f6ce24d721571f7856b5",
    "site/film-opspilot.html": "40550f7b20391ec89298821145cd74cc40fc928b590ebd7c8953b4504c177281",
    "site/film-intentgraph.html": "6f5769de3ce7be047c807f5dc69ecbe692cf94060d4384b5270d05a8b3d34e62",
}

def tracked_files() -> list[pathlib.Path]:
    proc = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], check=True, capture_output=True)
    return [ROOT / name.decode("utf-8", "strict") for name in proc.stdout.split(b"\0") if name]

def audit() -> list[str]:
    errors: list[str] = []
    for file in tracked_files():
        name = file.relative_to(ROOT).as_posix()
        if FORBIDDEN_PATH.search(name):
            errors.append("Forbidden path: " + name)
            continue
        if not file.is_file():
            errors.append("Tracked file not present: " + name)
            continue
        if file.is_symlink():
            errors.append("Symlink not permitted: " + name)
            continue
        if file.suffix.lower() not in TEXT_EXT:
            continue
        if file.stat().st_size > 1_000_000:
            expected = REVIEWED_R19_LARGE.get(name)
            if not expected or file.stat().st_size > 4_000_000:
                errors.append("Text file exceeds review cap: " + name)
                continue
            if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                errors.append("R19 cinema content SHA256 does not match approved immutable source: " + name)
                continue
        value = file.read_text(encoding="utf-8", errors="replace")
        for label, rx in CONTENT_MATCHES.items():
            if rx.search(value):
                errors.append(label + " pattern in " + name)
    return errors

if __name__ == "__main__":
    errs = audit()
    for issue in errs:
        print("ERROR:", issue, file=sys.stderr)
    print(f"Public-source safety audit: {'FAIL' if errs else 'PASS'}")
    sys.exit(1 if errs else 0)
