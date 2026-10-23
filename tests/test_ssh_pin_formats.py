"""Unit/integration validation for SSH host-key pin handling, entirely offline.

Generate disposable SSH test keys. Fake *only* ssh transport; no production
credentials are touched, and no real network request is made in this suite.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIAGNOSTIC=ROOT/"scripts/diagnose-staging-ssh.sh"

@unittest.skipUnless(shutil.which("ssh-keygen") and shutil.which("bash"),"Requires OpenSSH and bash")
class StagingPinTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="marcosa-pin-test-")
        self.addCleanup(self.tmp.cleanup)
        d=Path(self.tmp.name)
        self.key=d/"key"
        generated=subprocess.run(
            ["ssh-keygen","-q","-t","ed25519","-N","","-f",str(self.key)],
            capture_output=True,text=True,timeout=10
        )
        if generated.returncode:
            self.skipTest("Cannot generate temporary OpenSSH key: "+generated.stderr[:100])
        self.public=self.key.with_suffix(".pub").read_text(encoding="utf-8").strip()
        self.host="staging.example.test"
        self.full=self.host+" "+self.public
        self.fingerprint=subprocess.run(
            ["ssh-keygen","-lf",str(self.key.with_suffix(".pub")),"-E","sha256"],
            capture_output=True,text=True,check=True,timeout=10
        ).stdout.split()[1]
        mock=d/"mock"
        mock.mkdir()
        fake_ssh=mock/"ssh"
        fake_ssh.write_text("#!/bin/sh\nprintf 'REMOTE_AUTH=PASS\\nREMOTE_USER=marcosa-deploy\\nREMOTE_READY=STAGING_READY\\n'\n",encoding="utf-8")
        fake_ssh.chmod(0o755)
        fake_scan=mock/"ssh-keyscan"
        fake_scan.write_text("#!/bin/sh\nprintf '%s\\n' \"$MOCK_HOST_LINE\"\n",encoding="utf-8")
        fake_scan.chmod(0o755)
        self.env=os.environ.copy()
        self.env.update(
            PATH=str(mock)+os.pathsep+os.environ.get("PATH",""),
            DEPLOY_HOST=self.host,
            DEPLOY_USER="marcosa-deploy",
            DEPLOY_PORT="22",
            DEPLOY_KEY=self.key.read_text(encoding="utf-8"),
            MOCK_HOST_LINE=self.full,
        )

    def run_probe(self,known_hosts):
        return subprocess.run(
            ["bash",str(DIAGNOSTIC)],
            env={**self.env,"KNOWN_HOSTS":known_hosts},
            capture_output=True,text=True,timeout=15
        )

    def test_full_known_hosts_line(self):
        out=self.run_probe(self.full)
        self.assertEqual(out.returncode,0,out.stderr)
        self.assertIn("HOST_PIN_FORMAT=full_known_hosts",out.stdout)
        self.assertIn("MARCOSA_DEPLOY_PREFLIGHT=PASS",out.stdout)

    def test_raw_host_public_key_is_bound_to_target_host(self):
        out=self.run_probe(self.public)
        self.assertEqual(out.returncode,0,out.stderr)
        self.assertIn("HOST_PIN_FORMAT=host_public_key",out.stdout)

    def test_verified_sha256_fingerprint_is_compared_to_actual_host_key(self):
        out=self.run_probe(self.fingerprint)
        self.assertEqual(out.returncode,0,out.stderr)
        self.assertIn("HOST_PIN_FORMAT=pinned_sha256_fingerprint",out.stdout)

    def test_mismatched_fingerprint_never_reaches_ssh_auth(self):
        bad=self.fingerprint[:-1]+("A" if self.fingerprint[-1]!="A" else "B")
        out=self.run_probe(bad)
        self.assertNotEqual(out.returncode,0)
        self.assertIn("HOST_KEY_MISMATCH",out.stderr)
        self.assertNotIn("REMOTE_AUTH=PASS",out.stdout)

    def test_known_hosts_bound_to_other_machine_rejected(self):
        out=self.run_probe("another.example.test "+self.public)
        self.assertNotEqual(out.returncode,0)
        self.assertIn("HOST_NOT_PINNED",out.stderr)

    def test_unrecognized_secret_is_not_logged(self):
        unexpected="this-is-not-a-host-pin--sample"
        out=self.run_probe(unexpected)
        self.assertNotEqual(out.returncode,0)
        self.assertIn("INVALID_KNOWN_HOSTS",out.stderr)
        self.assertNotIn(unexpected,out.stdout+out.stderr)

if __name__=="__main__":
    unittest.main()
