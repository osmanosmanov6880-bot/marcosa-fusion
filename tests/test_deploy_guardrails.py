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
    "ops/ssh-stage-verified.sh",
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

    def test_r99_continuous_staging_is_main_only_nonroot_and_never_production(self):
        source = (ROOT / "ops/ssh-stage-verified.sh").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/marcosa-staging.yml").read_text(encoding="utf-8")
        self.assertIn('GITHUB_REF', source)
        self.assertIn('GITHUB_REPOSITORY', source)
        self.assertIn('GITHUB_SHA', source)
        self.assertIn('source ops/load-pinned-staging-host.sh', source)
        self.assertIn('bash scripts/diagnose-staging-ssh.sh', source)
        self.assertIn('ssh_stage', workflow.replace('deploy_ssh_filesystem','ssh_stage'))
        self.assertIn('name: marcosa-site-${{ github.sha }}', workflow)
        self.assertIn('bash ops/ssh-stage-verified.sh', workflow)
        self.assertIn('sha256sum -c marcosa-site.tar.gz.sha256', source)
        self.assertIn('SSH_STAGING_ASSETS_VERIFIED=', source)
        self.assertIn('ops/loopback_staging_http.py', source)
        self.assertIn('VPS loopback HTTP smoke failed', source)
        self.assertIn('PUBLIC_HTTPS_VERIFIED=NO', source)
        self.assertNotIn('/opt/marcosa/current', source)
        self.assertNotIn('StrictHostKeyChecking=no', source)
        self.assertNotIn('rm -rf /opt/marcosa', source)

    def test_r99_script_denies_wrong_repo_before_network(self):
        env = os.environ.copy()
        env.update(GITHUB_REPOSITORY="unknown/repo", GITHUB_REF="refs/heads/main",
                   GITHUB_EVENT_NAME="push", GITHUB_SHA="f"*40,
                   DEPLOY_HOST="169.58.48.38", DEPLOY_USER="marcosa-deploy",
                   DEPLOY_KEY="not-a-valid-private-key")
        result = subprocess.run(
            ["bash", str(ROOT / "ops/ssh-stage-verified.sh")],
            capture_output=True, text=True, env=env, timeout=10)
        self.assertNotEqual(result.returncode,0)
        self.assertIn("Not the approved MARCOSA source repo",result.stdout+result.stderr)
        self.assertNotIn("not-a-valid-private-key",result.stdout+result.stderr)

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
