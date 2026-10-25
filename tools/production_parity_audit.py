#!/usr/bin/env python3
"""R101: read-only, redact-safe parity audit of legacy MARCOSA vs staged static preview.

Never copies content, reads credentials, tests customer accounts, touches databases, or
changes either webroot. Output contains only known public filenames and aggregates.
"""
from __future__ import annotations
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import unquote, urlsplit

MAX_INDEX = 5 * 1024 * 1024
MAX_MANIFEST = 2 * 1024 * 1024
PUBLIC_SUFFIXES = frozenset({".html", ".htm", ".css", ".js", ".mjs", ".svg", ".webp", ".png", ".jpg", ".jpeg", ".json"})
CRITICAL = ("marcosa-config.js", "marcosa-supabase.js", "interaction-bridge.js",
            "developer-console.js", "nexus.js")
SENSITIVE = {"config.json", "secrets.json", "settings.json", "credentials.json"}
SHA = re.compile(r"^[0-9a-f]{40}$")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_bounded(path: Path, maximum: int) -> bytes:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Expected non-symlink public file: {path.name}")
    if path.stat().st_size > maximum:
        raise ValueError("Public comparison file exceeds size bound")
    return path.read_bytes()


def normal_public_path(value: str) -> str | None:
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if value.startswith(("//", "#")):
        return None
    try:
        u = urlsplit(value)
        if u.scheme or u.netloc or not u.path:
            return None
        decoded = unquote(u.path).lstrip("/")
        if any(part in {"..", ""} for part in PurePosixPath(decoded).parts):
            return None
        path = PurePosixPath(decoded)
        if path.name.startswith(".") or path.suffix.lower() not in PUBLIC_SUFFIXES:
            return None
        if path.name.lower() in SENSITIVE or ".env" in decoded:
            return None
        return str(path)
    except (ValueError, UnicodeError):
        return None


class PublicReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paths: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        candidate = None
        if tag in ("script", "img", "source", "iframe"):
            candidate = values.get("src")
        elif tag == "link":
            rel = (values.get("rel") or "").lower()
            if any(k in rel.split() for k in ("stylesheet", "preload", "modulepreload", "icon")):
                candidate = values.get("href")
        elif tag == "a":
            candidate = values.get("href")
        safe = normal_public_path(candidate) if candidate else None
        if safe:
            self.paths.add(safe)


def public_root_names(root: Path) -> set[str]:
    # Only top-level, public asset names; do not traverse private modules/Storage.
    names: set[str] = set()
    for file in root.iterdir():
        if (file.is_file() and not file.is_symlink()
                and file.suffix.lower() in PUBLIC_SUFFIXES
                and not file.name.startswith(".")
                and file.name.lower() not in SENSITIVE):
            names.add(file.name)
    return names


def audit(live: Path, stage: Path) -> dict:
    if not live.is_dir() or live.is_symlink() or not stage.is_dir():
        raise ValueError("Legacy root and isolated stage must exist")
    legacy_bytes = read_bounded(live / "index.html", MAX_INDEX)
    staged_bytes = read_bounded(stage / "index.html", MAX_INDEX)
    manifest = json.loads(read_bounded(stage / "build-manifest.json", MAX_MANIFEST))
    attestation = json.loads(read_bounded(stage / "staging-release.json", 8192))
    if (manifest.get("release_kind") != "public_static_preview_only"
            or attestation.get("releaseKind") != "public_static_preview_only"
            or attestation.get("productionAuthorized") is not False
            or not SHA.fullmatch(attestation.get("sourceSha") or "")
            or sha256(read_bounded(stage / "build-manifest.json", MAX_MANIFEST))
               != attestation.get("buildManifestSha256")):
        raise ValueError("STAGING static-only provenance cannot be verified")
    files = manifest.get("files")
    if not isinstance(files, dict) or not 3 <= len(files) <= 5000:
        raise ValueError("Invalid stage manifest file count")
    if not all(normal_public_path(name) == name for name in files):
        raise ValueError("Unexpected paths in published static manifest")
    live_names = public_root_names(live)
    preview_names = {PurePosixPath(name).name for name in files
                     if len(PurePosixPath(name).parts) == 1}
    legacy_refs = PublicReferences()
    preview_refs = PublicReferences()
    legacy_refs.feed(legacy_bytes.decode("utf8", errors="replace"))
    preview_refs.feed(staged_bytes.decode("utf8", errors="replace"))
    missing_live = sorted(p for p in legacy_refs.paths if
                          not (live / p).is_file())
    missing_preview = sorted(p for p in preview_refs.paths if p not in files)
    overlapping = live_names & preview_names
    legacy_only = live_names - preview_names
    preview_only = preview_names - live_names
    critical_present = sorted(name for name in CRITICAL if (live / name).is_file())
    critical_missing_from_preview = sorted(set(critical_present) - preview_names)
    flags = ["LIVE_AND_PREVIEW_INDEX_DIFFER"] if legacy_bytes != staged_bytes else []
    if critical_missing_from_preview:
        flags.append("EXISTING_INTEGRATIONS_NOT_IN_STATIC_PREVIEW")
    if legacy_only:
        flags.append("LEGACY_ASSETS_WOULD_BE_REMOVED_BY_ROOT_REPLACEMENT")
    if missing_live:
        flags.append("LEGACY_INDEX_REFERENCES_ABSENT_FILES")
    if missing_preview:
        flags.append("PREVIEW_INDEX_REFERENCES_ABSENT_FILES")
    flags.append("STATIC_PREVIEW_NOT_PROVEN_AUTHENTICATED_PRODUCTION")
    return {
        "format": "MARCOSA-PRODUCTION-PARITY-R101",
        "auditReadOnly": True,
        "productionAuthorized": False,
        "directRootReplacementAllowed": False,
        "liveIndexSha256": sha256(legacy_bytes),
        "stagingIndexSha256": sha256(staged_bytes),
        "indexBytesIdentical": legacy_bytes == staged_bytes,
        "stagingSourceSha": attestation["sourceSha"],
        "legacyPublicTopLevelCount": len(live_names),
        "stagingManifestCount": len(files),
        "stagingTopLevelCount": len(preview_names),
        "overlappingPublicTopLevelCount": len(overlapping),
        "legacyOnlyTopLevelCount": len(legacy_only),
        "previewOnlyTopLevelCount": len(preview_only),
        "criticalLegacyIntegrationFiles": critical_present,
        "criticalMissingFromStaticPreview": critical_missing_from_preview,
        "legacyOnlyExample": sorted(legacy_only)[:16],
        "previewOnlyExample": sorted(preview_only)[:16],
        "legacyIndexLocalReferences": len(legacy_refs.paths),
        "previewIndexLocalReferences": len(preview_refs.paths),
        "legacyBrokenLocalReferencesCount": len(missing_live),
        "previewBrokenLocalReferencesCount": len(missing_preview),
        "legacyBrokenLocalExamples": missing_live[:10],
        "previewBrokenLocalExamples": missing_preview[:10],
        "riskFlags": flags
    }


def main() -> int:
    root = Path("/home/marcosa-deploy/marcosa-staging")
    stage = root / "current"
    if os.geteuid() == 0 or os.getenv("USER") != "marcosa-deploy":
        raise ValueError("Only non-root marcosa-deploy may inspect this STAGING audit")
    if not stage.is_symlink() or not SHA.fullmatch(Path(os.readlink(stage)).name):
        raise ValueError("STAGING current is not a release symlink")
    if not str(stage.resolve()).startswith(str((root / "releases").resolve()) + "/"):
        raise ValueError("STAGING current symlink escapes isolated release tree")
    result = audit(Path("/opt/marcosa/current"), stage)
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print("R101 production parity BLOCKED: " + type(exc).__name__, file=sys.stderr)
        raise SystemExit(2)
