#!/usr/bin/env python3
"""R102: real loopback HTTP smoke test of *all* approved static STAGING assets.

No persistent web service, external port, Nginx changes, secrets, or production
writes. HTTP listens only on 127.0.0.1 using a disposable OS-assigned port and
shuts down before script exits. Source SHA + manifest digest are checked.
"""
from __future__ import annotations

import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from threading import Thread
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener, Request

SHA40 = re.compile(r"^[a-f0-9]{40}$")
SHA64 = re.compile(r"^[a-f0-9]{64}$")
ALLOWED_EXT = {".html", ".htm", ".js", ".mjs", ".css", ".svg",
               ".png", ".jpg", ".jpeg", ".webp", ".json"}
MAX_FILES = 5000
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 320 * 1024 * 1024


def valid_path(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    if value.startswith(("/", ".")) or any(ord(c) < 32 for c in value):
        return False
    path = PurePosixPath(value)
    if ".." in path.parts or path.name.startswith("."):
        return False
    return path.suffix.lower() in ALLOWED_EXT and len(value) <= 200


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_http(stage: Path) -> dict:
    manifest_path = stage / "build-manifest.json"
    att_path = stage / "staging-release.json"
    if not stage.is_dir() or not manifest_path.is_file() or not att_path.is_file():
        raise ValueError("Missing isolated STAGING manifest/attestation")
    manifest_raw = manifest_path.read_bytes()
    if len(manifest_raw) > 2 * 1024 * 1024:
        raise ValueError("Oversize build manifest")
    manifest = json.loads(manifest_raw)
    proof = json.loads(att_path.read_text("utf8"))
    files = manifest.get("files")
    sha = proof.get("sourceSha", "")
    if (manifest.get("release_kind") != "public_static_preview_only"
            or proof.get("releaseKind") != "public_static_preview_only"
            or proof.get("productionAuthorized") is not False
            or not SHA40.fullmatch(sha)
            or proof.get("buildManifestSha256") != digest(manifest_raw)
            or not isinstance(files, dict) or not 3 <= len(files) <= MAX_FILES
            or proof.get("assetsCount") != len(files)):
        raise ValueError("Untrusted staging provenance")
    if not {"index.html", "network.css", "network.js"}.issubset(files):
        raise ValueError("Missing core static resources")
    if not all(valid_path(name) and isinstance(h, str)
               and SHA64.fullmatch(h) for name, h in files.items()):
        raise ValueError("Unsafe manifest path or SHA256")
    for name in files:
        path = stage / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("Missing, linked, or oversized static file")

    approved = set(files) | {"staging-release.json", "build-manifest.json"}

    class SafeHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(stage), **kwargs)

        def do_GET(self):
            u = urlsplit(self.path)
            item = unquote(u.path).lstrip("/")
            if (item not in approved or u.fragment or u.username or u.password
                    or ".." in PurePosixPath(item).parts):
                self.send_error(404)
                return
            super().do_GET()

        def list_directory(self, path):
            self.send_error(403)
            return None

        def log_message(self, format, *args):
            pass

    count = 0
    total = 0
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), SafeHandler)
    httpd.daemon_threads = True
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(NoRedirect)
    try:
        port = httpd.server_address[1]
        for name, expected in sorted(files.items()):
            url = "http://127.0.0.1:" + str(port) + "/" + quote(name, safe="/") + "?verify=" + sha
            with opener.open(Request(url, headers={"Cache-Control": "no-store"}), timeout=8) as response:
                if response.status != 200 or response.geturl() != url:
                    raise ValueError("HTTP route or redirect mismatch")
                mime = response.headers.get("Content-Type", "").split(";")[0]
                if (not mime or
                        (name.endswith(".css") and mime != "text/css") or
                        (name.endswith((".html", ".htm")) and mime != "text/html") or
                        (name.endswith((".js", ".mjs")) and "javascript" not in mime)):
                    raise ValueError("Unexpected MIME type")
                raw = response.read(MAX_FILE_BYTES + 1)
                if len(raw) > MAX_FILE_BYTES or digest(raw) != expected:
                    raise ValueError("HTTP-delivered bytes differ from reviewed build manifest")
                count += 1
                total += len(raw)
                if total > MAX_TOTAL_BYTES:
                    raise ValueError("Aggregate HTTP payload exceeds limit")
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=4)
    return {"status": "PASS", "loopback": "127.0.0.1", "filesVerified": count,
            "sourceSha": sha, "totalBytesVerified": total,
            "publicHttpsVerified": False, "productionAuthorized": False}


def main() -> None:
    root = Path("/home/marcosa-deploy/marcosa-staging")
    current = root / "current"
    if os.geteuid() == 0 or os.getenv("USER") != "marcosa-deploy":
        raise ValueError("Loopback smoke restricted to marcosa-deploy")
    if not current.is_symlink() or not SHA40.fullmatch(Path(os.readlink(current)).name):
        raise ValueError("Current staging release symlink invalid")
    if not str(current.resolve()).startswith(str((root / "releases").resolve()) + "/"):
        raise ValueError("Current staging release outside isolated root")
    result = verify_http(current)
    print("VPS_LOOPBACK_HTTP=PASS")
    print("VPS_LOOPBACK_HOST=127.0.0.1")
    print("VPS_HTTP_FILES_VERIFIED=" + str(result["filesVerified"]))
    print("VPS_HTTP_SOURCE_SHA=" + result["sourceSha"])
    print("PUBLIC_HTTPS_VERIFIED=NO")
    print("PRODUCTION_UNCHANGED=YES")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print("R102 VPS loopback HTTP BLOCKED: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(2)
