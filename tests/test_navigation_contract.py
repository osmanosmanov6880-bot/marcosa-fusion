#!/usr/bin/env python3
"""R111 offline unit/fixture tests. No browser account or network required."""
import importlib.util
import pathlib
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("navigation",ROOT/"tools/audit_navigation_contract.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class NavigationTests(unittest.TestCase):
    def test_real_public_allowlist_is_literal_and_contains_every_core_route(self):
        files=mod.expected_public_files(ROOT/"tools"/"build_webroot.py")
        for name in mod.PAGES:
            self.assertIn(name,files)
        for name in ("network.js","social-core.js","marcosa-mark.svg","visual-hero-director.webp"):
            self.assertIn(name,files)

    def test_relative_assets_and_fragments_are_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/"social.html"
            p.write_text('''<html><head><link rel="stylesheet" href="./network.css"></head>
            <body><a href="#draft">Move</a><h2 id="draft">Draft</h2>
            <a href="./creator.html?view=private#editor">Create</a>
            <script src="./network.js"></script></body></html>''')
            r=mod.check_page(p,{"network.css","network.js","creator.html","social.html"})
            self.assertEqual(r["errors"],[])
            self.assertEqual(r["samePageAnchors"],1)
            self.assertEqual(r["unresolvedDynamicAnchorHints"],0)
            self.assertEqual(r["validInternalTargets"],3)

    def test_unresolved_path_and_project_host_root_are_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/"index.html"
            p.write_text('''<a href="/api/profile">wrong root</a><a href="./missing.html">missing</a>
             <img src="./image-that-doesnotexist.webp"><script src="../unsafe.js"></script>''')
            r=mod.check_page(p,{"index.html","main.js"})
            kinds={x["kind"] for x in r["errors"]}
            self.assertEqual(len(r["errors"]),4)
            self.assertIn("root-relative-on-project-pages",kinds)
            self.assertIn("missing-public-resource",kinds)
            self.assertIn("unsafe-local-path",kinds)

    def test_external_links_do_not_give_false_missing_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/"index.html"
            p.write_text('''<a href="https://github.com/example">Repo</a>
             <a href="mailto:info@example.com">Mail</a><img src="data:image/png;base64,AA==">''')
            result=mod.check_page(p,{"index.html"})
            self.assertEqual(result["externalReferences"],3)
            self.assertEqual(result["errorsCount"] if "errorsCount" in result else len(result["errors"]),0)

    def test_reject_javascript_and_custom_code_url_scheme(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/"index.html"
            p.write_text('''<a href="javascript:alert(1)">Unsafe</a>
             <a href="vbscript:msgbox(1)">Unsafe</a>
             <a href="unknownscheme:payload">Unsafe</a>''')
            r=mod.check_page(p,{"index.html"})
            self.assertEqual(len(r["errors"]),3)

    def test_analyzer_handles_actual_editable_pages_without_private_data(self):
        r=mod.audit()
        self.assertEqual(r["format"],"MARCOSA-R111-NAVIGATION-VALIDATOR")
        self.assertEqual(r["editablePagesAudited"],len(mod.PAGES))
        self.assertFalse(r["productionRootInspected"])
        self.assertFalse(r["authenticatedBackendVerified"])
        self.assertGreater(r["internalReferencesValidated"],7)


if __name__=="__main__":
    unittest.main()
