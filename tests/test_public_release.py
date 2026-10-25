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
        self.assertIn('href="./source-hub.html"', html)
        source_atlas = (SITE / "source-hub.html").read_text(encoding="utf-8")
        self.assertIn('id="sh-app"', source_atlas)
        self.assertIn('id="sh-search"', source_atlas)
        self.assertIn('src="./source-hub.js"', source_atlas)
        self.assertTrue((SITE / "source-hub.css").is_file())
        self.assertTrue((SITE / "source-hub.js").is_file())
        cinema = (SITE / "cinema-pilot.html").read_text(encoding="utf-8")
        self.assertIn('id="cp-film-frame"', cinema)
        self.assertIn('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"', cinema)
        self.assertIn('src="./cinema-pilot.js"', cinema)
        self.assertIn('href="./cinema-pilot.html"', html)
        self.assertTrue((SITE / "film-internet-v-humanity.html").is_file())
        self.assertTrue((SITE / "film-protocol-zero.html").is_file())
        self.assertTrue((SITE / "film-adverse-judge.html").is_file())
        for name in ("film-signal-worlds.html", "film-opspilot.html", "film-intentgraph.html"):
            self.assertTrue((SITE / name).is_file(), name)
        network_film = (SITE / "film-network.html").read_text(encoding="utf-8")
        self.assertIn('id="fn-continuity"', network_film)
        self.assertIn('id="fn14-save"', network_film)
        self.assertIn('id="fn14-import"', network_film)
        self.assertIn('src="./film-continuity.js"', network_film)
        self.assertTrue((SITE / "film-continuity.js").is_file())
        creator = (SITE / "creator.html").read_text(encoding="utf-8")
        self.assertIn('id="mc-editor"', creator)
        self.assertIn('id="mc-preview"', creator)
        self.assertIn('src="./creator.js"', creator)
        self.assertIn('src="./creator-vault.js"', creator)
        self.assertIn('src="./creator-backup.js"', creator)
        self.assertIn('src="./creator-crypto.js"', creator)
        self.assertIn('src="./creator-standalone.js"', creator)
        self.assertIn('src="./creator-playtest.js"', creator)
        self.assertIn('id="mc-playtest"', creator)
        self.assertIn('id="mc-playtest-files"', creator)
        self.assertIn('id="mc-playtest-results"', creator)
        self.assertIn('id="mc-standalone"', creator)
        self.assertIn('id="mc-standalone-preview"', creator)
        self.assertIn('id="mc-standalone-download"', creator)
        self.assertIn('sandbox="allow-scripts"', creator)
        self.assertIn('id="mc-crypto"', creator)
        self.assertIn('id="mc-crypto-pass"', creator)
        self.assertIn('id="mc-crypto-file"', creator)
        self.assertIn('id="mc-backup"', creator)
        self.assertIn('id="mc-backup-download"', creator)
        self.assertIn('id="mc-backup-file"', creator)
        self.assertIn('id="mc-vault"', creator)
        self.assertIn('id="mc-save-revision"', creator)
        self.assertIn('id="mc-export-review"', creator)
        self.assertTrue((SITE / "creator-vault.js").is_file())
        self.assertTrue((SITE / "creator-backup.js").is_file())
        self.assertTrue((SITE / "creator-crypto.js").is_file())
        self.assertTrue((SITE / "creator-standalone.js").is_file())
        self.assertTrue((SITE / "creator-playtest.js").is_file())
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
            "creator.html", "creator.css", "creator.js", "creator-vault.js", "creator-backup.js", "creator-crypto.js", "creator-standalone.js", "creator-playtest.js", "film-network.html", "film-network.css", "film-network.js", "film-continuity.js", "source-hub.html", "source-hub.css", "source-hub.js", "cinema-pilot.html", "cinema-pilot.css", "cinema-pilot.js", "film-internet-v-humanity.html", "film-protocol-zero.html", "film-adverse-judge.html", "film-signal-worlds.html", "film-opspilot.html", "film-intentgraph.html",
            "social.html", "social-core.css", "social-core.js",
            "marcosa-brand.css", "marcosa-brand.js", "marcosa-mark.svg", "marcosa-cinematic.css", "marcosa-gateway.js", "marcosa-quiet.css", "marcosa-quiet.js", "marcosa-nocturne.css", "marcosa-director.css", "marcosa-director.js", "marcosa-social-first.css", "social-journal.js", "marcosa-journal.css",
            "visual-station.webp", "visual-city.webp", "visual-cascade.webp", "visual-hero.webp",
            "visual-archive.webp", "visual-control.webp", "visual-operator.webp", "visual-earthrise.webp",
            "visual-city-director.webp", "visual-cascade-director.webp", "visual-hero-director.webp",
            "visual-archive-director.webp", "visual-control-director.webp", "visual-station-director.webp",
            "build-manifest.json", ".marcosa-preview-generated",
        })
        manifest = json.loads((dist / "build-manifest.json").read_text(encoding="utf-8"))
        for name, digest in manifest["files"].items():
            self.assertEqual(digest, hashlib.sha256((dist / name).read_bytes()).hexdigest())
        # R25: derived (not generated) cinema grades must retain original WebP
        # frames, dimensions and provenance in the signed release manifest.
        from PIL import Image
        grade_pairs = (("visual-city.webp", "visual-city-director.webp"),
                       ("visual-cascade.webp", "visual-cascade-director.webp"),
                       ("visual-hero.webp", "visual-hero-director.webp"),
                       ("visual-archive.webp", "visual-archive-director.webp"),
                       ("visual-control.webp", "visual-control-director.webp"),
                       ("visual-station.webp", "visual-station-director.webp"))
        for original, graded in grade_pairs:
            self.assertIn(original, manifest["files"])
            self.assertIn(graded, manifest["files"])
            self.assertNotEqual(manifest["files"][original], manifest["files"][graded])
            self.assertGreater((dist / graded).stat().st_size, (dist / original).stat().st_size)
            with Image.open(dist / graded) as image:
                self.assertEqual(image.size, (1600, 900))
                self.assertEqual(image.format, "WEBP")
        self.assertNotIn("supabase", " ".join(files))

    def test_staging_is_explicitly_restricted_to_trusted_main_and_dedicated_user(self):
        yml = (ROOT / ".github" / "workflows" / "marcosa-staging.yml").read_text(encoding="utf-8")
        self.assertIn("github.ref == 'refs/heads/main'", yml)
        self.assertIn("environment: marcosa-staging", yml)
        self.assertIn("source ops/load-pinned-staging-host.sh", yml)
        self.assertNotIn("secrets.MARCOSA_SSH_KNOWN_HOSTS", yml)
        self.assertIn("DEPLOY_SSH_KEY", yml)
        self.assertNotIn("secrets.MARCOSA_SSH_KEY", yml)
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
