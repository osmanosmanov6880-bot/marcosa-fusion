#!/usr/bin/env python3
"""R109 DNS/TLS readiness tests without external network or credentials."""
import importlib.util
from pathlib import Path
import socket
import ssl
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("r109_origin",ROOT/"tools/audit_preview_hostname.py")
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class IndependentOriginTests(unittest.TestCase):
    def test_missing_dns_means_no_false_tls_or_publish_claim(self):
        def no_dns(host):
            raise socket.gaierror("missing")
        def forbidden(*args):
            raise AssertionError("No TLS attempts allowed without verified DNS")
        r=m.audit(resolve_fn=no_dns,probe_fn=forbidden)
        self.assertFalse(r["previewHostnameReady"])
        self.assertFalse(r["tlsChecked"])
        self.assertFalse(r["productionCutoverAuthorized"])
        self.assertEqual(r["dnsErrorClass"],"DNS_UNAVAILABLE_OR_UNEXPECTED")

    def test_wrong_vps_ip_will_not_proceed_to_tls(self):
        r=m.audit(resolve_fn=lambda name:["203.0.113.5"],probe_fn=lambda *args:1/0)
        self.assertEqual(r["dnsErrorClass"],"DOES_NOT_RESOLVE_TO_APPROVED_VPS")
        self.assertFalse(r["tlsChecked"])
        self.assertEqual(r["ipv4Answers"],["203.0.113.5"])

    def test_expected_ip_with_valid_hostname_tls_and_public_http(self):
        def good_probe(ip,host):
            self.assertEqual(host,"preview.marcosa.club")
            self.assertEqual(ip,"169.58.48.38")
            return {"validHostnameCertificate":True,"tlsVersion":"TLSv1.3",
                    "httpStatus":200,"httpHeadReachable":True}
        r=m.audit(resolve_fn=lambda n:["169.58.48.38"],probe_fn=good_probe)
        self.assertTrue(r["previewHostnameReady"])
        self.assertFalse(r["productionCutoverAuthorized"])
        self.assertFalse(r["crossSubdomainCookieIsolationVerified"])
        self.assertFalse(r["staticSiteInstalledOnSubdomain"])

    def test_tls_validation_failure_is_reported_without_secrets(self):
        def bad_probe(ip,host):
            raise ssl.SSLError("wrong certificate")
        r=m.audit(resolve_fn=lambda n:["169.58.48.38"],probe_fn=bad_probe)
        self.assertFalse(r["previewHostnameReady"])
        self.assertTrue(r["tlsChecked"])
        self.assertEqual(r["tlsErrorClass"],"TLS_OR_HTTP_NOT_READY")

    def test_independent_origin_does_not_claim_cookie_or_auth_isolation(self):
        r=m.audit(resolve_fn=lambda n:["169.58.48.38"],probe_fn=lambda ip,host:{
            "validHostnameCertificate":True,"httpHeadReachable":True,"httpStatus":302})
        self.assertFalse(r["previewHostnameReady"])
        self.assertTrue(r["webStorageIsSeparateFromMainHostname"])
        self.assertFalse(r["legacyAuthStorageInspected"])
        self.assertFalse(r["crossSubdomainCookieIsolationVerified"])
        self.assertFalse(r["productionCutoverAuthorized"])


if __name__=="__main__":
    unittest.main()
