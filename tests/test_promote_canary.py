#!/usr/bin/env python3
"""R106 dry-run tests: exercise actual atomic canary pointer changes in a temp tree."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("canary_publisher",ROOT/"ops/promote_canary_from_staging.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def fixture(home,sha,word):
    files={"index.html":f"<html>{word}</html>".encode(),
           "network.css":b"body{color:white}",
           "network.js":f"console.log('{word}')".encode()}
    target=home/"releases"/sha
    target.mkdir(parents=True)
    for name,raw in files.items():
        (target/name).write_bytes(raw)
    manifest={"release_kind":"public_static_preview_only",
              "files":{n:hashlib.sha256(raw).hexdigest() for n,raw in files.items()}}
    data=(json.dumps(manifest)+"\n").encode()
    (target/"build-manifest.json").write_bytes(data)
    proof={"sourceSha":sha,"productionAuthorized":False,
           "releaseKind":"public_static_preview_only","assetsCount":len(files),
           "buildManifestSha256":hashlib.sha256(data).hexdigest()}
    (target/"staging-release.json").write_text(json.dumps(proof))
    return files


class AdditivePublisherTests(unittest.TestCase):
    def test_undisturbed_legacy_root_and_atomic_canary_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)
            home=base/"home"
            (home/"releases").mkdir(parents=True)
            (home/".staging-approved").write_text("MARCOSA-STAGING-APPROVED-v1\n")
            site=base/"canary"
            (site/"releases").mkdir(parents=True)
            (site/"pointers").mkdir()
            live=base/"live.html"
            live.write_bytes(b"legacy never edited")
            with patch.object(mod,"HOME",home),patch.object(mod,"ROOT",site),\
                 patch.object(mod,"LIVE_INDEX",live),\
                 patch.object(mod,"OLD_LIVE_SHA",hashlib.sha256(live.read_bytes()).hexdigest()),\
                 patch.object(mod,"check_enabled",return_value=True):
                sha1="a"*40
                fixture(home,sha1,"first")
                (home/"current").symlink_to("releases/"+sha1)
                self.assertEqual(mod.verify_stage(sha1)["index.html"],hashlib.sha256((home/"current"/"index.html").read_bytes()).hexdigest())
                self.assertEqual(mod.promote(sha1)["status"],"PASS")
                self.assertEqual(mod.promote(sha1)["status"],"ALREADY_ACTIVE")
                (home/"current").unlink()
                sha2="b"*40
                fixture(home,sha2,"second")
                (home/"current").symlink_to("releases/"+sha2)
                self.assertEqual(mod.promote(sha2)["status"],"PASS")
                self.assertEqual((site/"pointers"/"current"/"index.html").read_bytes(),b"<html>second</html>")
                self.assertEqual(mod.rollback(sha2)["status"],"ROLLED_BACK")
                self.assertEqual((site/"pointers"/"current"/"index.html").read_bytes(),b"<html>first</html>")
                self.assertEqual(live.read_bytes(),b"legacy never edited")

    def test_reject_unapproved_or_modified_staging(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)
            home=base/"home"
            (home/"releases").mkdir(parents=True)
            (home/".staging-approved").write_text("MARCOSA-STAGING-APPROVED-v1\n")
            sha="c"*40
            fixture(home,sha,"working")
            (home/"current").symlink_to("releases/"+sha)
            live=base/"legacy"
            live.write_bytes(b"legacy")
            with patch.object(mod,"HOME",home),patch.object(mod,"LIVE_INDEX",live),\
                 patch.object(mod,"OLD_LIVE_SHA",hashlib.sha256(live.read_bytes()).hexdigest()):
                self.assertEqual(len(mod.verify_stage(sha)),3)
                (home/"current"/"network.js").write_bytes(b"tampered")
                with self.assertRaises(ValueError):
                    mod.verify_stage(sha)

    def test_refuse_arbitrary_external_rollback_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"next"
            p.symlink_to("../../etc/passwd")
            with self.assertRaises(ValueError):
                mod.relative_release(p)

    def test_ci_canary_requires_admin_created_marker_and_never_edits_nginx(self):
        code=(ROOT/"ops/promote_canary_from_staging.py").read_text()
        self.assertIn('marker.stat().st_uid!=0',code)
        self.assertIn('productionRootModified":False',code)
        self.assertNotIn("systemctl",code)
        self.assertNotIn("nginx -s reload",code)
        self.assertNotIn("chmod 777",code)


if __name__=="__main__":
    unittest.main()
