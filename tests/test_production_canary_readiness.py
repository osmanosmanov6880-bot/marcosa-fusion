#!/usr/bin/env python3
"""R104 read-only canary audit contract tests; no VPS needed."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("canary_readiness", ROOT / "ops/production_canary_readiness.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CanaryReadinessTests(unittest.TestCase):
    def test_regular_https_legacy_nginx_config(self):
        source = """
        server {
          listen 80;
          server_name marcosa.club www.marcosa.club;
        }
        server {
          listen 443 ssl http2;
          server_name marcosa.club www.marcosa.club;
          root /opt/marcosa/current;
          location / { try_files $uri $uri/ /index.html; }
          location /assets/ { expires 1d; }
        }
        """
        p = module.nginx_topology(source)
        self.assertTrue(p["liveHostnameFound"])
        self.assertTrue(p["tlsListenerFound"])
        self.assertTrue(p["legacyRootDirectiveFound"])
        self.assertFalse(p["canaryRouteAlreadyUsed"])
        self.assertEqual(p["locationsCount"], 2)
        self.assertEqual(p["listenDirectives"], 2)
        self.assertTrue(p["configComplete"])

    def test_existing_canary_location_must_not_be_overwritten(self):
        s = "server_name marcosa.club; location ^~ /network-os/ { alias /var/www/a/; }"
        p = module.nginx_topology(s)
        self.assertTrue(p["canaryRouteAlreadyUsed"])

    def test_nginx_includes_mark_incomplete_review(self):
        s = "listen 443 ssl; include /etc/nginx/snippets/*.conf; location / { root /opt/marcosa/current; }"
        p = module.nginx_topology(s)
        self.assertFalse(p["configComplete"])
        self.assertEqual(p["externalIncludeCount"], 1)

    def test_no_private_nginx_content_can_enter_report(self):
        opaque = "some-private-upstream-credential-should-never-be-displayed"
        src = "listen 443 ssl; proxy_pass https://"+opaque+"; server_name marcosa.club;"
        serialized = json.dumps(module.nginx_topology(src))
        self.assertNotIn(opaque, serialized)
        self.assertNotIn("proxy_pass", serialized)

    def test_staging_root_cannot_install_canary_itself(self):
        code = (ROOT/"ops/production_canary_readiness.py").read_text()
        self.assertIn('"productionCutoverAuthorized": False', code)
        self.assertIn('"canaryCanBeInstalledByDeployUser": False', code)
        self.assertIn('"productionWritesMade": False', code)
        self.assertNotIn("nginx -s reload", code)
        self.assertNotIn("chmod 777", code)


if __name__ == "__main__":
    unittest.main()
