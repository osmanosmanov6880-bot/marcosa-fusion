#!/usr/bin/env python3
"""R108: actual isolated Nginx end-to-end integration, no Contabo/production edits.

Runs unprivileged on 127.0.0.1 with a disposable high port; executes EXACT
Nginx location snippet shipped by ops/install_production_canary.py and tests
both immutable preview assets and preserved legacy routes across a pointer swap.
"""
from __future__ import annotations
from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

PROJECT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("production_canary",PROJECT/"ops/install_production_canary.py")
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
SHA_A="a"*40
SHA_B="b"*40


class NeverRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None


@contextmanager
def nginx_sandbox():
    if shutil.which("nginx") is None:
        raise RuntimeError("nginx is REQUIRED for this integration test")
    with tempfile.TemporaryDirectory(prefix="marcosa-nginx-r108-") as folder:
        root=Path(folder)
        root.chmod(0o755)
        site=root/"legacy"
        site.mkdir()
        (site/"index.html").write_bytes(b"<html>ORIGINAL-LEGACY-DO-NOT-REPLACE</html>")
        canary=root/"canary"
        (canary/"releases").mkdir(parents=True)
        (canary/"pointers").mkdir()
        for sha,title in ((SHA_A,"R108-CANARY-A"),(SHA_B,"R108-CANARY-B")):
            release=canary/"releases"/sha
            release.mkdir()
            (release/"index.html").write_bytes(("<html>"+title+"</html>").encode())
            (release/"network.js").write_bytes(("window.canary='"+title+"';").encode())
            (release/"network.css").write_bytes(b"body{color:white}")
        (canary/"pointers"/"current").symlink_to("../releases/"+SHA_A)
        logs=root/"logs"
        logs.mkdir()
        port_sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        port_sock.bind(("127.0.0.1",0))
        port=port_sock.getsockname()[1]
        port_sock.close()
        snippet=installer.NGINX_SNIPPET.replace(
            "/var/www/marcosa-network-os/pointers/current/",
            str(canary/"pointers"/"current")+"/")
        cfg=root/"nginx.conf"
        cfg.write_text("\n".join([
            "worker_processes 1;",
            "pid "+str(root/"nginx.pid")+";",
            "error_log "+str(logs/"error.log")+" notice;",
            "events { worker_connections 128; }",
            "http {",
            "include /etc/nginx/mime.types;",
            "access_log "+str(logs/"access.log")+";",
            "server {",
            "listen 127.0.0.1:"+str(port)+";",
            "server_name localhost;",
            "root "+str(site)+";",
            "location / { try_files $uri $uri/ /index.html; }",
            'location = /api/ { return 200 "LEGACY-API-UNTOUCHED"; }',
            snippet,
            "}",
            "}",
        ])+"\n")
        test=subprocess.run(["nginx","-t","-c",str(cfg)],capture_output=True,text=True,timeout=8)
        if test.returncode:
            raise RuntimeError("real isolated Nginx config rejected: "+test.stderr[-1000:])
        p=subprocess.Popen(["nginx","-c",str(cfg),"-g","daemon off;"],
                           stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            endpoint="http://127.0.0.1:"+str(port)
            for attempt in range(80):
                if p.poll() is not None:
                    raise RuntimeError("real sandbox Nginx exited before HTTP test")
                try:
                    with build_opener(NeverRedirect).open(endpoint+"/index.html",timeout=0.5) as resp:
                        if resp.status==200:
                            break
                except OSError:
                    time.sleep(0.04)
            else:
                raise RuntimeError("real sandbox Nginx did not become ready")
            yield endpoint,canary,site
        finally:
            p.terminate()
            try:
                p.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.communicate(timeout=3)


def query(base,route):
    request=Request(base+route,headers={"Cache-Control":"no-store"})
    try:
        with build_opener(NeverRedirect).open(request,timeout=5) as response:
            return response.status,response.headers,response.read(2000)
    except HTTPError as error:
        return error.code,error.headers,error.read(2000)


class RealNginxCanaryContract(unittest.TestCase):
    @unittest.skipUnless(shutil.which("nginx"),"nginx binary not installed")
    def test_additive_real_http_routes_and_atomic_swap(self):
        with nginx_sandbox() as (url,canary,legacy):
            status,headers,body=query(url,"/")
            self.assertEqual(status,200)
            self.assertIn(b"ORIGINAL-LEGACY",body)
            status,_,api=query(url,"/api/")
            self.assertEqual(status,200)
            self.assertEqual(api,b"LEGACY-API-UNTOUCHED")
            status,headers,_=query(url,"/network-os")
            self.assertEqual(status,308)
            self.assertEqual(headers.get("Location"),"/network-os/")
            for route in ("/network-os/","/network-os/index.html"):
                status,headers,body=query(url,route)
                self.assertEqual(status,200)
                self.assertIn(b"R108-CANARY-A",body)
                self.assertIn("text/html",headers.get("Content-Type",""))
            for route,content_type in (("/network-os/network.js","javascript"),
                                       ("/network-os/network.css","text/css")):
                status,headers,data=query(url,route)
                self.assertEqual(status,200)
                self.assertIn(content_type,headers.get("Content-Type",""))
                self.assertNotIn(b"LEGACY",data)
            self.assertEqual(query(url,"/network-os/missing-doesnotexist.js")[0],404)
            # Mimic the verified atomic relink under the unchanged live Nginx.
            new=canary/"pointers"/".pending"
            new.symlink_to("../releases/"+SHA_B)
            os.replace(new,canary/"pointers"/"current")
            status,_,body=query(url,"/network-os/index.html")
            self.assertEqual(status,200)
            self.assertIn(b"R108-CANARY-B",body)
            status,_,original=query(url,"/index.html")
            self.assertEqual(status,200)
            self.assertIn(b"ORIGINAL-LEGACY",original)
            status,_,api=query(url,"/api/")
            self.assertEqual(status,200)
            self.assertEqual(api,b"LEGACY-API-UNTOUCHED")
            self.assertEqual((legacy/"index.html").read_bytes(),
                             b"<html>ORIGINAL-LEGACY-DO-NOT-REPLACE</html>")


if __name__=="__main__":
    unittest.main()
