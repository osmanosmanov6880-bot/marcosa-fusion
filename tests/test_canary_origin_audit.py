#!/usr/bin/env python3
"""R108 source-scoped origin risk report tests; does not contact production."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("origin_audit",ROOT/"tools/audit_canary_origin.py")
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class SourceOriginRiskTests(unittest.TestCase):
    def test_localstorage_and_indexeddb_mark_same_origin_risk(self):
        with tempfile.TemporaryDirectory() as d:
            site=Path(d)
            (site/"index.html").write_text('''<a href="./social.html">Social</a><script src="./main.js"></script>''')
            (site/"main.js").write_text('''localStorage.setItem("draft","x"); indexedDB.open("vault");''')
            r=audit.audit(site)
            self.assertTrue(r["sameOriginCanaryRisk"])
            self.assertFalse(r["safeToEnableSameOriginProductionAutomatically"])
            self.assertFalse(r["legacyAuthStorageInspected"])
            self.assertEqual(r["rootRelativeUrlReferences"],0)
            self.assertEqual(r["storageApis"]["localStorage"],1)
            self.assertEqual(r["storageApis"]["indexedDB"],1)
            self.assertEqual(len(r["findings"]),2)

    def test_root_relative_resources_and_hardcoded_old_domain(self):
        with tempfile.TemporaryDirectory() as d:
            site=Path(d)
            (site/"index.html").write_text('''<link href="/network.css"><a href="/social.html"></a><img src="./a.png">''')
            (site/"app.css").write_text('''body { background: url('/logo.png') }''')
            (site/"app.js").write_text('''fetch('/health'); const target="https://marcosa.club/#network";''')
            r=audit.audit(site)
            self.assertEqual(r["rootRelativeUrlReferences"],4)
            self.assertEqual(r["legacyOriginReferences"],1)
            self.assertFalse(r["productionCutoverAuthorized"])

    def test_source_content_not_exposed_in_findings(self):
        with tempfile.TemporaryDirectory() as d:
            site=Path(d)
            payload='PASSWORD_NOT_TO_REPORT_1234567'
            (site/"secret.js").write_text(f'''const privateToken="{payload}"; localStorage.getItem("auth");''')
            result=str(audit.audit(site))
            self.assertNotIn(payload,result)

    def test_symlink_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            site=Path(d)
            (site/"index.js").symlink_to("/etc/hosts")
            with self.assertRaises(ValueError):
                audit.audit(site)

    def test_project_preview_does_not_claim_auth_isolation(self):
        result=audit.audit(ROOT/"site")
        self.assertGreater(result["filesAudited"],15)
        self.assertFalse(result["legacyAuthStorageInspected"])
        self.assertFalse(result["safeToEnableSameOriginProductionAutomatically"])
        self.assertFalse(result["productionCutoverAuthorized"])


if __name__=="__main__":
    unittest.main()
