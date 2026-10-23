"""MARCOSA Network OS R2 public-preview CI safety and build tests.

Deliberately verifies only the isolated, stateless preview. It cannot claim
end-to-end verification of the private/social MARCOSA production application.
"""
import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"

class PublicPreviewTests(unittest.TestCase):
    def test_preview_has_all_required_modules_and_usable_navigation(self):
        html = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="mn-dialog"', html)
        self.assertIn('id="mn-film-form"', html)
        self.assertIn('id="mn-grid"', html)
        self.assertIn('id="mn-campaign-form"', html)
        self.assertIn('href="./network.css"', html)
        self.assertIn('href="./immersive.css"', html)
        self.assertIn('src="./immersive.js"', html)
        self.assertIn('id="mi-world-canvas"', html)
        self.assertIn('id="mi-benchmark"', html)
        self.assertIn('id="mi-diagnostics"', html)
        self.assertIn('src="./network.js"', html)
        self.assertTrue((SITE / "network.css").is_file())
        self.assertTrue((SITE / "network.js").is_file())
        self.assertTrue((SITE / "immersive.js").is_file())
        self.assertTrue((SITE / "immersive.css").is_file())
        self.assertIn('href="./creator.html"', html)
        creator = (SITE / "creator.html").read_text(encoding="utf-8")
        self.assertIn('id="mc-editor"', creator)
        self.assertIn('id="mc-preview"', creator)
        self.assertIn('src="./creator.js"', creator)
        self.assertTrue((SITE / "creator.css").is_file())

    def test_public_frontend_no_private_backend_or_tracking_calls(self):
        js = (SITE / "network.js").read_text(encoding="utf-8")
        html = (SITE / "index.html").read_text(encoding="utf-8")
        immersive = (SITE / "immersive.js").read_text(encoding="utf-8")
        for forbidden in (
            "service_role", "-----BEGIN", "sk-proj-", "ghp_",
            "XMLHttpRequest(", "navigator.sendBeacon(", "document.cookie",
            "localStorage.setItem(", "sessionStorage.setItem(",
        ):
            self.assertNotIn(forbidden, js)
            self.assertNotIn(forbidden, immersive)
        self.assertNotIn("marcosa-supabase.js", html)
        self.assertNotIn("https://", js.split("const rows = ")[0])

    def test_network_browser_factory_receives_window_scope(self):
        """Regression: opening catalogue must not raise 'root is not defined'."""
        source = (SITE / "network.js").read_text(encoding="utf-8")
        self.assertIn("const api = factory(root);", source)
        self.assertIn("})(typeof window !== 'undefined' ? window : undefined, function (root) {", source)

    def test_builder_creates_only_allowlisted_files_and_manifest(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "build_webroot.py")],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIn("public_static_preview_only", result.stdout)
        dist = ROOT / "dist"
        files = {p.name for p in dist.iterdir() if p.is_file()}
        self.assertEqual(files, {
            "index.html", "network.css", "network.js",
            "immersive.css", "immersive.js",
            "stories.html", "stories.css", "stories.js",
            "creator.html", "creator.css", "creator.js",
            "build-manifest.json", ".marcosa-preview-generated",
        })
        manifest = json.loads((dist / "build-manifest.json").read_text(encoding="utf-8"))
        for name, digest in manifest["files"].items():
            self.assertEqual(digest, hashlib.sha256((dist / name).read_bytes()).hexdigest())
        self.assertNotIn("supabase", " ".join(files))

    def test_staging_is_explicitly_restricted_to_trusted_main_and_dedicated_user(self):
        yml = (ROOT / ".github" / "workflows" / "marcosa-staging.yml").read_text(encoding="utf-8")
        self.assertIn("github.ref == 'refs/heads/main'", yml)
        self.assertIn("environment: marcosa-staging", yml)
        self.assertIn("MARCOSA_SSH_KNOWN_HOSTS", yml)
        self.assertIn("MARCOSA_SSH_KEY", yml)
        self.assertIn("scripts/diagnose-staging-ssh.sh", yml)
        self.assertIn("scripts/activate-staging.sh", yml)
        self.assertNotIn("github.event.repository.private == true", yml)
        activate = (ROOT / "scripts" / "activate-staging.sh").read_text(encoding="utf-8")
        self.assertIn('id -un', activate)
        self.assertIn('marcosa-deploy', activate)
        self.assertIn('MARCOSA-STAGING-APPROVED-v1', activate)
        self.assertNotIn('/opt/marcosa', activate)

    def test_pages_deploys_only_from_main_without_hidden_variable(self):
        yml = (ROOT / ".github" / "workflows" / "marcosa-public-pages.yml").read_text(encoding="utf-8")
        self.assertIn("github.ref == 'refs/heads/main'", yml)
        self.assertNotIn("MARCOSA_PUBLIC_PAGES_ENABLED", yml)
        self.assertIn("actions/deploy-pages@v4", yml)
        self.assertIn("pages: write", yml)
        self.assertIn("id-token: write", yml)
        self.assertIn("one-time", yml.lower())

    def test_no_private_notes_or_runtime_data_in_public_distribution(self):
        names = {str(p.relative_to(ROOT)) for p in (SITE).rglob("*") if p.is_file()}
        self.assertFalse(any("brief-crops/" in name for name in names))
        self.assertFalse(any(name.endswith((".sqlite", ".pem", ".key", ".env")) for name in names))

if __name__ == "__main__":
    unittest.main()
