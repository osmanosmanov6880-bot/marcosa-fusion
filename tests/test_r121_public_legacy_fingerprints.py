#!/usr/bin/env python3
"""Offline tests for R121: no network, production filesystem, or credentials."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "r121_public_legacy_fingerprints",
    ROOT / "tools/r121_public_legacy_fingerprints.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def make_files(root: Path):
    assets = {
        "index.html": b"<html>public</html>",
        "network.js": b"console.log('public')",
        "styles.css": b"body{}",
        "marcosa-config.js": b"/* public script: never emit content */",
        "nexus.js": b"/* another public script */",
    }
    for name, raw in assets.items():
        (root / name).write_bytes(raw)
    (root / ".env").write_bytes(b"PRIVATE_ENV_DO_NOT_READ")
    (root / "secrets.json").write_bytes(b"PRIVATE_JSON_DO_NOT_READ")
    (root / "readme.txt").write_bytes(b"PRIVATE_TEXT_DO_NOT_READ")
    return assets


class R121PublicFileInventoryTests(unittest.TestCase):
    def test_full_top_level_sha256_and_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = make_files(root)
            result = module.collect_public(root)
            self.assertTrue(result["readOnly"])
            self.assertFalse(result["productionAuthorized"])
            self.assertEqual(result["fileCount"], len(files))
            self.assertEqual(result["totalBytes"], sum(map(len, files.values())))
            self.assertEqual(
                [i["name"] for i in result["files"]],
                sorted(files))
            self.assertEqual(result["indexSha256"],
                             hashlib.sha256(files["index.html"]).hexdigest())
            for item in result["files"]:
                self.assertEqual(item["sha256"],
                                 hashlib.sha256(files[item["name"]]).hexdigest())
            text = json.dumps(result)
            for secret in ("PRIVATE_ENV_DO_NOT_READ", "PRIVATE_JSON_DO_NOT_READ",
                           "PRIVATE_TEXT_DO_NOT_READ", "public script: never emit content"):
                self.assertNotIn(secret, text)

    def test_symlinked_public_asset_excluded_and_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_files(root)
            (root / "hidden-file.js").symlink_to(root / "network.js")
            result = module.collect_public(root)
            self.assertNotIn("hidden-file.js", [x["name"] for x in result["files"]])

    def test_symlinked_public_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source = base / "real"
            source.mkdir()
            make_files(source)
            alias = base / "alias"
            alias.symlink_to(source, target_is_directory=True)
            with self.assertRaises(ValueError):
                module.collect_public(alias)

    def test_fails_closed_on_oversized_public_file_without_reading_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_files(root)
            with (root / "oversized.js").open("wb") as handle:
                handle.truncate(module.MAX_FILE_BYTES + 1)
            with self.assertRaisesRegex(ValueError, "bounded"):
                module.collect_public(root)

    def test_temporary_report_has_no_private_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_files(root)
            subdir = root / "private"
            subdir.mkdir()
            (subdir / "session.js").write_text("SENSITIVE_PRIVATE_BYTES")
            result = module.collect_public(root)
            self.assertEqual(result["fileCount"], 5)
            self.assertNotIn("session.js", json.dumps(result))

    def test_missing_public_index_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_files(root)
            (root / "index.html").unlink()
            with self.assertRaises(ValueError):
                module.collect_public(root)

    def test_filename_allowlist_and_reject_dot_env_like(self):
        self.assertTrue(module.allowed_name("network.js"))
        self.assertFalse(module.allowed_name("../secret.js"))
        self.assertFalse(module.allowed_name("config.json"))
        self.assertFalse(module.allowed_name("customers.env.js"))
        self.assertFalse(module.allowed_name("cookie dump.js"))
        self.assertFalse(module.allowed_name(".hidden.js"))

    def test_fails_closed_on_unsafe_public_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_files(root)
            (root / "cookie dump.js").write_bytes(b"unsafe path for JSON")
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                module.collect_public(root)

    def test_source_tree_never_requires_supabase_or_network(self):
        source = (ROOT / "tools/r121_public_legacy_fingerprints.py").read_text()
        for forbidden in ("requests.get(", "urllib.request", "subprocess.", "os.system(",
                          "sqlite3.connect(", "psycopg", "supabase.client"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
