"""R115 isolated rollback rehearsal: real Bash and SHA256, never any VPS connection."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts/rollback-staging.sh"
OLD = "a" * 40
PREVIOUS = "b" * 40


def trusted_release(staging: Path, sha: str, label: str) -> Path:
    target = staging / "releases" / sha
    target.mkdir(parents=True)
    files = {
        "index.html": f"<html><h1>{label}</h1></html>".encode("utf8"),
        "network.js": ("window.preview="+json.dumps(label)+";").encode(),
        "network.css": b"body { color: #abc; }",
        "assets/scene.webp": b"RIFF" + b"webp" * 11
    }
    for name, data in files.items():
        file = target / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    manifest = {
        "release_kind": "public_static_preview_only",
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    }
    raw = (json.dumps(manifest, sort_keys=True) + "\n").encode()
    (target/"build-manifest.json").write_bytes(raw)
    (target/"staging-release.json").write_text(json.dumps({
        "format": "MARCOSA-STAGING-READBACK-v1",
        "sourceSha": sha,
        "releaseKind": "public_static_preview_only",
        "productionAuthorized": False,
        "assetsCount": len(files),
        "buildManifestSha256": hashlib.sha256(raw).hexdigest(),
    }))
    return target


class IsolatedRollbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="marcosa-r115-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.home = self.base / "user"
        self.home.mkdir()
        self.root = self.home / "marcosa-staging"
        (self.root/"releases").mkdir(parents=True)
        (self.root/".staging-approved").write_text("MARCOSA-STAGING-APPROVED-v1\n")
        self.old = trusted_release(self.root, OLD, "CURRENT")
        self.good = trusted_release(self.root, PREVIOUS, "VERIFIED-ROLLBACK")
        (self.root/"current").symlink_to("releases/"+OLD)
        (self.root/"previous").symlink_to("releases/"+PREVIOUS)
        self.bin = self.base/"fake-bin"
        self.bin.mkdir()
        helper = self.bin/"id"
        helper.write_text("#!/bin/sh\nif [ \"$1\" = '-un' ]; then printf 'marcosa-deploy\\n'; else exec /usr/bin/id \"$@\"; fi\n")
        helper.chmod(0o755)
        self.env = os.environ.copy()
        self.env.update(HOME=str(self.home), PATH=str(self.bin)+":"+self.env.get("PATH",""))

    def execute(self):
        return subprocess.run(["bash",str(SCRIPT)],env=self.env,check=False,
                              capture_output=True,text=True,timeout=12)

    def assert_unmoved(self):
        self.assertEqual(os.readlink(self.root/"current"),"releases/"+OLD)
        self.assertEqual(os.readlink(self.root/"previous"),"releases/"+PREVIOUS)

    def test_real_two_pointer_rollback_after_every_target_checksum(self):
        result=self.execute()
        self.assertEqual(result.returncode,0,result.stdout+"\n"+result.stderr)
        self.assertIn("STAGING_ROLLBACK_TARGET_BYTES_VERIFIED=PASS",result.stdout)
        self.assertIn("STAGING_ROLLBACK_TARGET_ASSETS_VERIFIED=4",result.stdout)
        self.assertEqual(os.readlink(self.root/"current"),"releases/"+PREVIOUS)
        self.assertEqual(os.readlink(self.root/"previous"),"releases/"+OLD)
        self.assertIn(b"VERIFIED-ROLLBACK",(self.root/"current"/"index.html").read_bytes())

    def test_corrupted_current_cannot_block_recovery_to_verified_previous(self):
        (self.old/"index.html").unlink()
        (self.old/"network.js").write_bytes(b"corrupted current")
        result=self.execute()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(os.readlink(self.root/"current"),"releases/"+PREVIOUS)

    def test_rollback_is_denied_if_earlier_asset_tampered_even_with_valid_index(self):
        (self.good/"network.js").write_bytes(b"attacker changed this")
        result=self.execute()
        self.assertNotEqual(result.returncode,0,result.stdout)
        self.assertIn("ROLLBACK_TARGET_CHECKSUM_MISMATCH",result.stderr)
        self.assert_unmoved()

    def test_reject_forged_attestation_even_with_valid_public_files(self):
        proof = self.good/"staging-release.json"
        data=json.loads(proof.read_text())
        data["productionAuthorized"]=True
        proof.write_text(json.dumps(data))
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("ROLLBACK_TARGET_ATTESTATION_INVALID",result.stderr)
        self.assert_unmoved()

    def test_reject_path_traversal_even_if_manifest_and_proof_are_rehashed(self):
        m=self.good/"build-manifest.json"
        manifest=json.loads(m.read_text())
        manifest["files"]["../secret.js"]="0"*64
        raw=json.dumps(manifest).encode()
        m.write_bytes(raw)
        proof=self.good/"staging-release.json"
        p=json.loads(proof.read_text())
        p["assetsCount"]=len(manifest["files"])
        p["buildManifestSha256"]=hashlib.sha256(raw).hexdigest()
        proof.write_text(json.dumps(p))
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("ROLLBACK_TARGET_MANIFEST_PATH_UNSAFE",result.stderr)
        self.assert_unmoved()

    def test_reject_symlink_asset_which_could_escape_release_directory(self):
        (self.good/"network.js").unlink()
        (self.good/"network.js").symlink_to(self.old/"network.js")
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("ROLLBACK_TARGET_FILE_INVALID",result.stderr)
        self.assert_unmoved()

    def test_reject_symlinked_staging_approval_marker(self):
        marker=self.root/".staging-approved"
        text=marker.read_text()
        marker.unlink()
        substitute=self.base/"marker"
        substitute.write_text(text)
        marker.symlink_to(substitute)
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assert_unmoved()

    def test_identical_current_and_previous_never_rotate(self):
        (self.root/"previous").unlink()
        (self.root/"previous").symlink_to("releases/"+OLD)
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(os.readlink(self.root/"current"),"releases/"+OLD)

    def test_missing_previous_release_does_not_mutate_active(self):
        (self.good/"index.html").unlink()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assert_unmoved()


if __name__=="__main__":
    unittest.main()
