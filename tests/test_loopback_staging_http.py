#!/usr/bin/env python3
"""Offline R102 HTTP smoke checks; binds only 127.0.0.1 on ephemeral port."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("loopback_staging_http", ROOT / "ops/loopback_staging_http.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def create_stage(root: Path):
    stage = root / "staging"
    stage.mkdir()
    files = {"index.html": b"<html>R102</html>", "network.css": b"body {color: black}",
             "network.js": b"window.Marcosa = true;", "social.html": b"<html>Social</html>",
             "graphic.webp": b"RIFFxxxxWEBP" + b"\0" * 64}
    for name, data in files.items():
        (stage / name).write_bytes(data)
    manifest = {"release_kind": "public_static_preview_only",
                "files": {n: hashlib.sha256(raw).hexdigest() for n, raw in files.items()}}
    raw = (json.dumps(manifest, separators=(",", ":")) + "\n").encode()
    (stage / "build-manifest.json").write_bytes(raw)
    proof = {"sourceSha": "a"*40, "releaseKind": "public_static_preview_only",
             "productionAuthorized": False, "assetsCount": len(files),
             "buildManifestSha256": hashlib.sha256(raw).hexdigest()}
    (stage / "staging-release.json").write_text(json.dumps(proof))
    return stage


class LoopbackSmokeTests(unittest.TestCase):
    def test_succeeds_over_real_local_http_and_validates_every_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            result = smoke.verify_http(create_stage(Path(temp)))
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["loopback"], "127.0.0.1")
            self.assertEqual(result["filesVerified"], 5)
            self.assertFalse(result["publicHttpsVerified"])
            self.assertFalse(result["productionAuthorized"])

    def test_reject_tampered_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            path = create_stage(Path(temp))
            (path / "network.js").write_bytes(b"changed content")
            with self.assertRaises(ValueError):
                smoke.verify_http(path)

    def test_reject_missing_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            path = create_stage(Path(temp))
            (path / "graphic.webp").unlink()
            with self.assertRaises(ValueError):
                smoke.verify_http(path)

    def test_reject_bad_manifest_path(self):
        with tempfile.TemporaryDirectory() as temp:
            path = create_stage(Path(temp))
            mfile = path / "build-manifest.json"
            manifest = json.loads(mfile.read_text())
            manifest["files"]["../.env"] = "1" * 64
            data = json.dumps(manifest).encode()
            mfile.write_bytes(data)
            proof_file = path / "staging-release.json"
            proof = json.loads(proof_file.read_text())
            proof["assetsCount"] = len(manifest["files"])
            proof["buildManifestSha256"] = hashlib.sha256(data).hexdigest()
            proof_file.write_text(json.dumps(proof))
            with self.assertRaises(ValueError):
                smoke.verify_http(path)

    def test_public_origin_and_source_not_authorized(self):
        self.assertFalse(smoke.valid_path("../../secrets.json"))
        self.assertFalse(smoke.valid_path("/etc/passwd"))
        self.assertFalse(smoke.valid_path(".env"))
        self.assertFalse(smoke.valid_path("data/private.jwt"))
        self.assertTrue(smoke.valid_path("network.js"))
        self.assertTrue(smoke.valid_path("assets/art.webp"))


if __name__ == "__main__":
    unittest.main()
