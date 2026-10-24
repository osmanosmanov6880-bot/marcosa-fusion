#!/usr/bin/env python3
"""Deterministic, allowlisted build of the public MARCOSA R2 Network OS preview.

This does NOT reproduce the authenticated MARCOSA social application.
Its inputs are twenty-three independently reviewed public files in site/.
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
PUBLIC_FILES = ("index.html", "network.css", "network.js", "immersive.css", "immersive.js", "stories.html", "stories.css", "stories.js", "creator.html", "creator.css", "creator.js", "creator-vault.js", "creator-backup.js", "creator-crypto.js", "creator-standalone.js", "creator-playtest.js", "film-network.html", "film-network.css", "film-network.js", "film-continuity.js", "source-hub.html", "source-hub.css", "source-hub.js")
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
    if any(anchor not in html for anchor in ('id="mn-dialog"', 'id="mn-film-form"', 'id="mi-world-canvas"', 'id="mi-benchmark"', 'href="./stories.html"', 'href="./creator.html"')):
        raise RuntimeError("Expected Network OS or R5 story entry points are missing")
    stories = (SOURCE / 'stories.html').read_text(encoding='utf-8')
    if any(anchor not in stories for anchor in ('id="ms-stage"', 'id="ms-brief-form"', 'id="ms-choices"', 'src="./stories.js"', 'href="./stories.css"', 'src="./network.js"')):
        raise RuntimeError("R5 story pilot is missing an entry point or a functional control")
    creator = (SOURCE / "creator.html").read_text(encoding="utf-8")
    if any(anchor not in creator for anchor in ('id="mc-editor"', 'id="mc-preview"', 'id="mc-fields"', 'id="mc-apply"', 'id="mc-download"', 'id="mc-import"', 'id="mc-choice-list"', 'src="./creator.js"', 'href="./creator.css"')):
        raise RuntimeError("R8 creator engine is missing a functional editor or preview control")
    if any(anchor not in creator for anchor in ('id="mc-vault"', 'id="mc-save-revision"', 'id="mc-project-list"', 'id="mc-version-list"', 'id="mc-export-review"', 'src="./creator-vault.js"')):
        raise RuntimeError("R9 local project archive or review gateway is missing")
    if any(anchor not in creator for anchor in ('id="mc-backup"', 'id="mc-backup-download"', 'id="mc-backup-file"', 'src="./creator-backup.js"')):
        raise RuntimeError("R10 portable local archive backup controls are missing")
    if 'href="./creator.html"' not in stories:
        raise RuntimeError("R8 creator engine is not discoverable from Story Lab")
    if any(anchor not in creator for anchor in ('id="mc-crypto"', 'id="mc-crypto-pass"', 'id="mc-crypto-confirm"', 'id="mc-crypto-download"', 'id="mc-crypto-file"', 'src="./creator-crypto.js"')):
        raise RuntimeError("R11 encrypted vault controls or crypto source are missing")
    if any(anchor not in creator for anchor in ('id="mc-standalone"', 'id="mc-standalone-preview"', 'id="mc-standalone-download"', 'id="mc-standalone-player"', 'sandbox="allow-scripts"', 'src="./creator-standalone.js"')):
        raise RuntimeError("R12 standalone playable story export or sandbox preview is missing")
    if any(anchor not in creator for anchor in ('id="mc-playtest"', 'id="mc-playtest-files"', 'id="mc-playtest-results"', 'src="./creator-playtest.js"')):
        raise RuntimeError("R13 offline playtest analysis dashboard is incomplete")
    films = (SOURCE / "film-network.html").read_text(encoding="utf-8")
    if any(anchor not in films for anchor in (
        'id="fn-continuity"', 'id="fn14-save"', 'id="fn14-import"',
        'id="fn14-list"', 'src="./film-continuity.js"'
    )):
        raise RuntimeError("R14 offline review continuity controls are missing")
    atlas = (SOURCE / "source-hub.html").read_text(encoding="utf-8")
    if any(anchor not in atlas for anchor in (
        'id="sh-app"', 'id="sh-grid"', 'id="sh-search"',
        'src="./source-hub.js"', 'href="./source-hub.css"'
    )):
        raise RuntimeError("R15 evidence-grounded source atlas is missing")
    if 'href="./source-hub.html"' not in html:
        raise RuntimeError("R15 source atlas has no entry link from MARCOSA home")
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
