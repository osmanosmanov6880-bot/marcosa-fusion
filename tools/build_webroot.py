#!/usr/bin/env python3
"""Deterministic, allowlisted build of the public MARCOSA R2 Network OS preview.

This does NOT reproduce the authenticated MARCOSA social application.
Its inputs are five independently reviewed files in site/.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site"
OUTPUT = ROOT / "dist"
PUBLIC_FILES = ("index.html", "network.css", "network.js", "immersive.css", "immersive.js")
MARKER = ".marcosa-preview-generated"


def build() -> dict:
    if OUTPUT.is_symlink():
        raise RuntimeError("Refusing to use symlink output")
    if OUTPUT.exists() and not (OUTPUT / MARKER).is_file():
        raise RuntimeError("Refusing to replace non-generated dist directory")
    for name in PUBLIC_FILES:
        if not (SOURCE / name).is_file() or (SOURCE / name).is_symlink():
            raise RuntimeError(f"Required public source missing or symlink: {name}")
    html = (SOURCE / "index.html").read_text(encoding="utf-8")
    if any(anchor not in html for anchor in ('src="./network.js"', 'href="./network.css"', 'src="./immersive.js"', 'href="./immersive.css"')):
        raise RuntimeError("Preview HTML references were not found")
    if any(anchor not in html for anchor in ('id="mn-dialog"', 'id="mn-film-form"', 'id="mi-world-canvas"', 'id="mi-benchmark"')):
        raise RuntimeError("Expected R2 UI elements are missing")
    manifest = {"release_kind": "public_static_preview_only", "files": {}}
    tmp = Path(tempfile.mkdtemp(prefix=".dist-pending-", dir=ROOT))
    try:
        for name in PUBLIC_FILES:
            raw = (SOURCE / name).read_bytes()
            if len(raw) > 512_000:
                raise RuntimeError(f"Unexpected oversized source: {name}")
            (tmp / name).write_bytes(raw)
            manifest["files"][name] = hashlib.sha256(raw).hexdigest()
        (tmp / "build-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (tmp / MARKER).write_text("Generated MARCOSA Network OS preview\n", encoding="utf-8")
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        os.replace(tmp, OUTPUT)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    return manifest


if __name__ == "__main__":
    m = build()
    print(json.dumps(m, ensure_ascii=False, indent=2))
