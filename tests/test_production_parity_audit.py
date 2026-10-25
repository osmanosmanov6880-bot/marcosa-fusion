#!/usr/bin/env python3
"""R101 compatibility tests (entirely offline; no production credentials/files)."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("production_parity_audit", ROOT / "tools/production_parity_audit.py")
auditlib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auditlib)


def make_fixture(root, *, mismatch=True, extra=True):
    live = root / "legacy"
    staged = root / "staged"
    live.mkdir()
    staged.mkdir()
    live_html = b'<html><link rel="stylesheet" href="./network.css"><script src="./marcosa-config.js"></script><a href="./legacy.html">Old</a></html>'
    new_html = b'<html><link rel="stylesheet" href="./network.css"><script src="./network.js"></script><a href="./creator.html">New</a></html>' if mismatch else live_html
    (live / "index.html").write_bytes(live_html)
    (live / "network.css").write_bytes(b"old styles")
    (live / "marcosa-config.js").write_bytes(b"/* private legacy data is never read */")
    (live / "legacy.html").write_bytes(b"legacy route")
    if extra:
        (live / "developer-console.js").write_bytes(b"legacy console")
    (staged / "index.html").write_bytes(new_html)
    (staged / "network.css").write_bytes(b"new styles")
    (staged / "network.js").write_bytes(b"console.log('preview')")
    (staged / "creator.html").write_bytes(b"preview creator")
    names = ("index.html", "network.css", "network.js", "creator.html")
    manifest = {"release_kind": "public_static_preview_only",
                "files": {n: hashlib.sha256((staged/n).read_bytes()).hexdigest() for n in names}}
    raw = (json.dumps(manifest) + "\n").encode()
    (staged / "build-manifest.json").write_bytes(raw)
    (staged / "staging-release.json").write_text(json.dumps({
        "format": "MARCOSA-STAGING-READBACK-v1",
        "sourceSha": "a" * 40,
        "buildManifestSha256": hashlib.sha256(raw).hexdigest(),
        "releaseKind": "public_static_preview_only",
        "productionAuthorized": False
    }))
    return live, staged


class ProductionParityTests(unittest.TestCase):
    def test_existing_integrations_are_protected(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, stage = make_fixture(Path(tmp))
            report = auditlib.audit(live, stage)
            self.assertFalse(report["directRootReplacementAllowed"])
            self.assertFalse(report["productionAuthorized"])
            self.assertTrue(report["auditReadOnly"])
            self.assertFalse(report["indexBytesIdentical"])
            self.assertIn("marcosa-config.js", report["criticalMissingFromStaticPreview"])
            self.assertIn("developer-console.js", report["criticalMissingFromStaticPreview"])
            self.assertEqual(report["legacyBrokenLocalReferencesCount"], 0)
            self.assertEqual(report["previewBrokenLocalReferencesCount"], 0)
            self.assertGreater(report["legacyOnlyTopLevelCount"], 0)
            self.assertGreater(report["previewOnlyTopLevelCount"], 0)
            self.assertEqual(len(report["liveIndexSha256"]), 64)

    def test_no_crash_when_public_ref_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, stage = make_fixture(Path(tmp))
            (live / "legacy.html").unlink()
            report = auditlib.audit(live, stage)
            self.assertEqual(report["legacyBrokenLocalReferencesCount"], 1)
            self.assertIn("LEGACY_INDEX_REFERENCES_ABSENT_FILES", report["riskFlags"])

    def test_no_credentials_or_html_content_in_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, stage = make_fixture(Path(tmp))
            secret = "do-not-leak-a-password-or-inline-html"
            with (live / "index.html").open("ab") as out:
                out.write(("<!-- " + secret + " -->").encode())
            report = json.dumps(auditlib.audit(live, stage), ensure_ascii=True)
            self.assertNotIn(secret, report)
            self.assertNotIn("private legacy data", report)

    def test_reject_preview_fake_production_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, stage = make_fixture(Path(tmp))
            p = stage / "staging-release.json"
            attestation = json.loads(p.read_text())
            attestation["productionAuthorized"] = True
            p.write_text(json.dumps(attestation))
            with self.assertRaises(ValueError):
                auditlib.audit(live, stage)

    def test_reject_manifest_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, stage = make_fixture(Path(tmp))
            manifest = json.loads((stage/"build-manifest.json").read_text())
            manifest["files"]["../.env"] = "0"*64
            new = (json.dumps(manifest)+"\n").encode()
            (stage/"build-manifest.json").write_bytes(new)
            att = json.loads((stage/"staging-release.json").read_text())
            att["buildManifestSha256"] = hashlib.sha256(new).hexdigest()
            (stage/"staging-release.json").write_text(json.dumps(att))
            with self.assertRaises(ValueError):
                auditlib.audit(live, stage)

    def test_sensitive_urls_ignored(self):
        for url in ("#token", "https://example.com/api?key=abc", "//host/file.css",
                    "../.env", "/../../config.json", "data:image/webp,abcd", "javascript:alert(1)"):
            self.assertIsNone(auditlib.normal_public_path(url))
        self.assertEqual(auditlib.normal_public_path("./network.css?v=1"), "network.css")


if __name__ == "__main__":
    unittest.main()
