#!/usr/bin/env python3
"""Offline root-canary transaction tests: no live Nginx or SSH."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('canary_installer', ROOT / 'ops/install_production_canary.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
CONFIG = """server {
    listen 443 ssl http2;
    server_name marcosa.club www.marcosa.club;
    root /opt/marcosa/current;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:9999; }
}
"""
SHA='a'*40
INDEX=b'<html>Approved static preview</html>'
DIGEST=hashlib.sha256(INDEX).hexdigest()

class FakeHTTPS:
    status=200
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,n): return INDEX
    def geturl(self): return 'https://marcosa.club/network-os/?verify='+SHA

class CanaryAtomicityTests(unittest.TestCase):
    def harness(self,folder):
        d=Path(folder)
        site=d/'sites'/'marcosa'
        site.parent.mkdir()
        site.write_text(CONFIG)
        snippet=d/'snippets'/'marcosa-network-os.conf'
        snippet.parent.mkdir()
        canary=d/'canary'
        canary.mkdir()
        state_dir=d/'recovery'
        state=state_dir/'active.json'
        legacy=d/'legacy'
        legacy.mkdir()
        (legacy/'index.html').write_bytes(b'legacy')
        expected=hashlib.sha256(CONFIG.encode()).hexdigest()
        after=hashlib.sha256(mod.prepare_nginx_patch(CONFIG).encode()).hexdigest()
        before={'beforeConfigSha256':expected,'afterConfigSha256':after,
                'liveRootSha256':'legacy-digest'}
        patches=[
          patch.multiple(mod,CONF=site,SNIPPET=snippet,CANARY=canary,
                         STATE_DIR=state_dir,STATE=state,LEGACY=legacy,STAGING=d/'stage'),
          patch.object(mod.os,'geteuid',return_value=0),
          patch.object(mod,'do_plan',return_value=before),
          patch.object(mod,'verify_stage',return_value=(SHA,{'index.html':DIGEST})),
          patch.object(mod,'populate_sidecar'),
          patch.object(mod,'run'),
          patch.object(mod,'sha_file',return_value='legacy-digest'),
          patch.object(mod,'build_opener',return_value=SimpleNamespace(open=lambda *a,**k:FakeHTTPS())),
        ]
        return site,snippet,canary,state,state_dir,expected,patches

    def inject(self,fail_at):
        with tempfile.TemporaryDirectory() as d:
            site,snippet,canary,state,state_dir,expected,patches=self.harness(d)
            for p in patches:p.start()
            try:
                orig_write,orig_chmod=Path.write_text,Path.chmod
                marker=canary/'.canary-approved'
                def fail_write(path,data,*args,**kwargs):
                    if ((fail_at=='state_write' and path==state) or
                        (fail_at=='marker_write' and path==marker)):
                        orig_write(path,data[:4],*args,**kwargs)
                        raise OSError('injected final write failure')
                    return orig_write(path,data,*args,**kwargs)
                def fail_chmod(path,mode,*args,**kwargs):
                    if fail_at=='marker_chmod' and path==marker:
                        raise OSError('injected approval chmod failure')
                    return orig_chmod(path,mode,*args,**kwargs)
                with patch.object(Path,'write_text',new=fail_write),patch.object(Path,'chmod',new=fail_chmod):
                    with self.assertRaisesRegex(OSError,'injected'):
                        mod.apply(expected,'MARCOSA-ADD-ONLY-CANARY',SHA)
                self.assertEqual(site.read_text(),CONFIG)
                self.assertFalse(snippet.exists(),'failed apply left active Nginx snippet')
                self.assertFalse(marker.exists(),'failed apply left approval marker')
                self.assertFalse(state.exists(),'failed apply left active state')
                self.assertEqual(len(list(state_dir.glob('nginx-before-*.conf'))),1,
                                 'keep original Nginx backup for forensic inspection')
            finally:
                for p in reversed(patches):p.stop()

    def test_state_write_failure_restores_nginx_and_revokes_approval(self):
        self.inject('state_write')

    def test_marker_write_failure_restores_nginx_and_revokes_approval(self):
        self.inject('marker_write')

    def test_marker_chmod_failure_restores_nginx_and_revokes_approval(self):
        self.inject('marker_chmod')

    def test_stale_or_missing_exact_main_sha_rejected_before_changes(self):
        with tempfile.TemporaryDirectory() as d:
            site,snippet,canary,state,state_dir,expected,patches=self.harness(d)
            for p in patches:p.start()
            try:
                with self.assertRaisesRegex(ValueError,'currently staged source differ'):
                    mod.apply(expected,'MARCOSA-ADD-ONLY-CANARY','b'*40)
                with self.assertRaisesRegex(ValueError,'Explicit exact approved main SHA'):
                    mod.apply(expected,'MARCOSA-ADD-ONLY-CANARY','')
                self.assertEqual(site.read_text(),CONFIG)
                self.assertFalse(snippet.exists())
                self.assertFalse((canary/'.canary-approved').exists())
            finally:
                for p in reversed(patches):p.stop()

    def test_valid_https_then_root_state_and_approval(self):
        with tempfile.TemporaryDirectory() as d:
            site,snippet,canary,state,state_dir,expected,patches=self.harness(d)
            for p in patches:p.start()
            try:
                result=mod.apply(expected,'MARCOSA-ADD-ONLY-CANARY',SHA)
                self.assertEqual(result['sourceSha'],SHA)
                self.assertTrue(result['liveRootUnchanged'])
                self.assertTrue(result['revertPrepared'])
                self.assertIn('include /etc/nginx/snippets/marcosa-network-os.conf;',site.read_text())
                self.assertTrue(snippet.is_file())
                self.assertEqual((canary/'.canary-approved').read_text(),mod.MARK)
                self.assertEqual(json.loads(state.read_text())['sourceSha'],SHA)
                self.assertEqual(len(list(state_dir.glob('nginx-before-*.conf'))),1)
            finally:
                for p in reversed(patches):p.stop()

if __name__=='__main__':
    unittest.main()
