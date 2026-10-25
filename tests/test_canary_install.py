#!/usr/bin/env python3
"""R105 root-canary install pure gate tests — never edits Nginx or production."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("canary_installer",ROOT/"ops/install_production_canary.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
CONF="""
server {
    listen 80;
    server_name marcosa.club www.marcosa.club;
    return 301 https://marcosa.club$request_uri;
}
server {
    listen 443 ssl http2;
    server_name marcosa.club www.marcosa.club;
    root /opt/marcosa/current;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:9999; }
}
server {
    listen [::]:443 ssl;
    server_name another.example;
    root /srv/other;
}
"""

def make_stage(tmp:Path):
    stage=tmp/"stage"
    releases=stage/"releases"
    files={"index.html":b"<html>New public preview</html>",
           "network.css":b"body {color:white}",
           "network.js":b"console.log('preview');"}
    sha="a"*40
    target=releases/sha
    target.mkdir(parents=True)
    (stage/".staging-approved").write_text("MARCOSA-STAGING-APPROVED-v1\n")
    for name,data in files.items():
        (target/name).write_bytes(data)
    manifest={"release_kind":"public_static_preview_only",
              "files":{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
    data=(json.dumps(manifest)+"\n").encode()
    (target/"build-manifest.json").write_bytes(data)
    (target/"staging-release.json").write_text(json.dumps({
        "sourceSha":sha,"productionAuthorized":False,
        "releaseKind":"public_static_preview_only","assetsCount":len(files),
        "buildManifestSha256":hashlib.sha256(data).hexdigest()
    }))
    (stage/"current").symlink_to("releases/"+sha)
    return stage,sha


class CanaryInstallTests(unittest.TestCase):
    def test_single_target_https_site_is_patched_additively(self):
        newer=mod.prepare_nginx_patch(CONF)
        self.assertEqual(newer.count("marcosa-network-os.conf"),1)
        self.assertIn("root /opt/marcosa/current;",newer)
        self.assertIn("location /api/ { proxy_pass http://127.0.0.1:9999; }",newer)
        self.assertEqual(newer.count("server_name marcosa.club"),CONF.count("server_name marcosa.club"))
        self.assertIn("location ^~ /network-os/",mod.NGINX_SNIPPET)
        self.assertIn("alias /var/www/marcosa-network-os/pointers/current/",mod.NGINX_SNIPPET)
        self.assertNotIn("proxy_pass",mod.NGINX_SNIPPET)
        self.assertEqual(mod.prepare_nginx_patch(CONF).count("include /etc/nginx/snippets/"),1)

    def test_reject_repeat_patch_and_existing_route(self):
        patched=mod.prepare_nginx_patch(CONF)
        with self.assertRaises(ValueError):
            mod.prepare_nginx_patch(patched)
        with self.assertRaises(ValueError):
            mod.prepare_nginx_patch(CONF.replace("location /api/","location /network-os/"))

    def test_reject_ambiguous_or_unknown_https_site(self):
        with self.assertRaises(ValueError):
            mod.prepare_nginx_patch(CONF + CONF)
        with self.assertRaises(ValueError):
            mod.prepare_nginx_patch(CONF.replace("marcosa.club", "wrong.example"))
        with self.assertRaises(ValueError):
            mod.prepare_nginx_patch(CONF.replace("root /opt/marcosa/current;","root /unsafe;"))

    def test_conservative_parser_quotes_comments_and_unbalanced_braces(self):
        sample='server { listen 443 ssl; server_name marcosa.club; root /opt/marcosa/current; location / { add_header X-Test "{#literal}" ; } # } ignored\n }'
        self.assertEqual(len([x for x in mod.nginx_blocks(sample) if x["depth"]==0]),1)
        with self.assertRaises(ValueError):
            mod.nginx_blocks("server { listen 443 ssl;")

    def test_approved_static_release_is_verified_without_root_access(self):
        with tempfile.TemporaryDirectory() as d:
            stage,sha=make_stage(Path(d))
            actual,files=mod.verify_stage(stage)
            self.assertEqual(actual,sha)
            self.assertEqual(len(files),3)

    def test_reject_modified_static_archive_and_provenance(self):
        with tempfile.TemporaryDirectory() as d:
            stage,sha=make_stage(Path(d))
            (stage/"current"/"network.js").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                mod.verify_stage(stage)
        with tempfile.TemporaryDirectory() as d:
            stage,sha=make_stage(Path(d))
            target=stage/"current"/"staging-release.json"
            p=json.loads(target.read_text())
            p["productionAuthorized"]=True
            target.write_text(json.dumps(p))
            with self.assertRaises(ValueError):
                mod.verify_stage(stage)

    def test_reject_traversal_manifest_entries(self):
        with tempfile.TemporaryDirectory() as d:
            stage,sha=make_stage(Path(d))
            target=stage/"current"
            mfile=target/"build-manifest.json"
            m=json.loads(mfile.read_text())
            m["files"]["../.env"]="0"*64
            contents=json.dumps(m).encode()
            mfile.write_bytes(contents)
            pfile=target/"staging-release.json"
            p=json.loads(pfile.read_text())
            p["assetsCount"]=len(m["files"])
            p["buildManifestSha256"]=hashlib.sha256(contents).hexdigest()
            pfile.write_text(json.dumps(p))
            with self.assertRaises(ValueError):
                mod.verify_stage(stage)

    def test_root_approval_marker_is_written_only_after_public_https_pass(self):
        code=(ROOT/"ops/install_production_canary.py").read_text()
        self.assertIn('verified_url=URL+',code)
        self.assertIn('run("nginx","-t")',code)
        self.assertIn('STATE.write_text',code)
        self.assertIn('marker.write_text(MARK)',code)
        self.assertGreater(code.index('marker.write_text(MARK)'),code.index('STATE.write_text'))
        self.assertIn('disabled.write_text("MARCOSA-CANARY-DISABLED-v1',code)

    def test_script_never_gives_ci_root_rights(self):
        code=(ROOT/"ops/install_production_canary.py").read_text()
        self.assertIn('os.geteuid()!=0',code)
        self.assertIn('confirm!="MARCOSA-ADD-ONLY-CANARY"',code)
        self.assertIn('confirm!="MARCOSA-REMOVE-ONLY-CANARY"',code)
        self.assertNotIn("chmod 777",code)
        self.assertNotIn("rsync --delete",code)
        self.assertNotIn("shutil.rmtree(LEGACY",code)
        self.assertIn("STATE_DIR",code)
        self.assertIn('run("nginx","-t")',code)


if __name__=="__main__":
    unittest.main()
