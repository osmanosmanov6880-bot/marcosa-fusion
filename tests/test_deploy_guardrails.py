"""MARCOSA R6 deployment safety checks that never touch an external VPS."""
from __future__ import annotations
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = (
    "scripts/diagnose-staging-ssh.sh",
    "scripts/bootstrap-staging.sh",
    "scripts/activate-staging.sh",
    "scripts/rollback-staging.sh",
)

class DeploymentGuardrailTests(unittest.TestCase):
    def test_all_deployment_scripts_are_valid_bash(self):
        if shutil.which("bash") is None:
            self.skipTest("bash unavailable")
        for relative in SCRIPTS:
            with self.subTest(relative=relative):
                result = subprocess.run(
                    ["bash", "-n", str(ROOT / relative)],
                    capture_output=True, text=True, timeout=10
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_diagnostics_rejects_root_user_before_network_or_secret_material(self):
        env = os.environ.copy()
        env.update(DEPLOY_HOST="example.com", DEPLOY_USER="root",
                   DEPLOY_KEY="not-a-real-key", KNOWN_HOSTS="host placeholder")
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/diagnose-staging-ssh.sh")],
            capture_output=True, text=True, env=env, timeout=10
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("INVALID_USER", result.stderr)
        self.assertNotIn("not-a-real-key", result.stderr)

    def test_diagnostics_rejects_public_key_used_as_private_key(self):
        env = os.environ.copy()
        env.update(DEPLOY_HOST="example.com", DEPLOY_USER="marcosa-deploy",
                   DEPLOY_KEY="ssh-ed25519 FAKE-KEY", KNOWN_HOSTS="host placeholder")
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/diagnose-staging-ssh.sh")],
            capture_output=True, text=True, env=env, timeout=10
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PUBLIC_KEY_AS_PRIVATE", result.stderr)

    def test_staging_bootstrap_requires_local_root_and_public_key(self):
        source = (ROOT / "scripts/bootstrap-staging.sh").read_text(encoding="utf-8")
        for marker in ("id -u", "ssh-ed25519", "authorized_keys", "staging-approved",
                       "marcosa-deploy", "install -d -m 750"):
            self.assertIn(marker, source)
        self.assertNotIn("/opt/marcosa", source)
        self.assertNotIn("/etc/nginx", source)
        self.assertNotIn("/etc/ssh/sshd_config", source)

    def test_staging_ssh_workflows_do_not_use_root_or_relax_pin(self):
        for name in ("marcosa-ssh-preflight.yml", "marcosa-staging.yml",
                     "marcosa-staging-rollback.yml"):
            source = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
            self.assertNotIn("StrictHostKeyChecking=no", source)
            self.assertNotIn("ssh-keyscan", source)
            self.assertNotIn("github.event.repository.private == true", source)
            self.assertIn("refs/heads/main", source)

if __name__ == "__main__":
    unittest.main()
