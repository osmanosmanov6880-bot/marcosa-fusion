#!/usr/bin/env python3
"""R105: root-only, explicitly approved, ADDITIVE MARCOSA /network-os/ canary.

It does not replace /opt/marcosa/current, edit databases or copy private config.
One-time root activation is deliberately NOT callable with the GitHub Actions
non-root SSH credential. Future updates use restricted owner-only sidecar trees.

Usage:
  python3 ops/install_production_canary.py plan --expect-config-sha256 HASH
  sudo python3 ops/install_production_canary.py apply --expect-config-sha256 HASH --confirm MARCOSA-ADD-ONLY-CANARY
  sudo python3 ops/install_production_canary.py rollback --confirm MARCOSA-REMOVE-ONLY-CANARY
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from urllib.request import Request, build_opener, HTTPRedirectHandler

CONF=Path("/etc/nginx/sites-available/marcosa")
ENABLED=Path("/etc/nginx/sites-enabled/marcosa")
SNIPPET=Path("/etc/nginx/snippets/marcosa-network-os.conf")
LEGACY=Path("/opt/marcosa/current")
STAGING=Path("/home/marcosa-deploy/marcosa-staging")
CANARY=Path("/var/www/marcosa-network-os")
STATE_DIR=Path("/root/marcosa-canary-recovery")
STATE=STATE_DIR/"active.json"
URL="https://marcosa.club/network-os/"
MARK="MARCOSA-ADD-ONLY-CANARY-v1\n"
SHA40=re.compile(r"^[0-9a-f]{40}$")
SHA64=re.compile(r"^[0-9a-f]{64}$")
ASSET=re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_+.-]{0,180}\.(?:html|htm|js|mjs|css|svg|png|jpe?g|webp|json)$")
MAX_TOTAL=300*1024*1024
MAX_ITEM=20*1024*1024

NGINX_SNIPPET = """# MARCOSA additive STATIC PREVIEW ONLY. Legacy root, Auth and APIs untouched.
location = /network-os {
    return 308 /network-os/;
}
location ^~ /network-os/ {
    alias /var/www/marcosa-network-os/pointers/current/;
    index index.html;
    autoindex off;
    try_files $uri $uri/ =404;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
"""
INCLUDE_LINE="\n    include /etc/nginx/snippets/marcosa-network-os.conf;\n"


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha_file(path: Path, cap=MAX_ITEM) -> str:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > cap:
        raise ValueError("Expected a bounded, real public file")
    return digest(path.read_bytes())


def nginx_blocks(raw: str) -> list[dict]:
    """Conservative brace scanner ignoring quoted content & comments."""
    stack=[]
    blocks=[]
    start=0
    quote=None
    comment=False
    i=0
    while i<len(raw):
        c=raw[i]
        if comment:
            if c=="\n":
                comment=False
            i+=1;continue
        if quote:
            if c=="\\":
                i+=2;continue
            if c==quote:
                quote=None
            i+=1;continue
        if c=="#":
            comment=True;i+=1;continue
        if c in ("'",'"'):
            quote=c;i+=1;continue
        if c=="{":
            header=raw[start:i].strip()
            block={"header":header,"open":i,"close":-1,"depth":len(stack)}
            blocks.append(block);stack.append(block)
            start=i+1
        elif c=="}":
            if not stack:
                raise ValueError("Unbalanced Nginx configuration")
            block=stack.pop()
            block["close"]=i
            start=i+1
        elif c==";":
            start=i+1
        i+=1
    if stack or quote:
        raise ValueError("Incomplete Nginx configuration")
    return blocks


def prepare_nginx_patch(source: str) -> str:
    if "marcosa-network-os.conf" in source or re.search(
        r"location\s+(?:=|\^~)?\s*/network-os(?:/|\s)",source):
        raise ValueError("Existing canary route/include must not be overwritten")
    candidates=[]
    for block in nginx_blocks(source):
        if block["depth"]!=0 or block["header"]!="server":
            continue
        content=source[block["open"]+1:block["close"]]
        if (re.search(r"(?m)^\s*server_name\s+[^;]*\bmarcosa\.club\b",content)
                and re.search(r"(?m)^\s*listen\s+(?:\S+:)?443\b[^;]*;",content)
                and re.search(r"(?m)^\s*root\s+/opt/marcosa/current\s*;",content)):
            candidates.append(block)
    if len(candidates)!=1:
        raise ValueError("Exactly one HTTPS MARCOSA legacy server block is required")
    b=candidates[0]
    return source[:b["close"]]+INCLUDE_LINE+source[b["close"]:]


def verify_stage(root: Path) -> tuple[str,dict]:
    current=root/"current"
    if not current.is_symlink():
        raise ValueError("Missing approved STAGING current symlink")
    relative=os.readlink(current)
    if not re.fullmatch(r"releases/[a-f0-9]{40}",relative):
        raise ValueError("Unexpected STAGING source release")
    sha=relative.split("/")[1]
    target=(root/relative)
    if not target.is_dir() or target.is_symlink() or current.resolve()!=target.resolve():
        raise ValueError("Invalid STAGING release target")
    approved=root/".staging-approved"
    if approved.is_symlink() or not approved.is_file() or approved.read_text().strip()!="MARCOSA-STAGING-APPROVED-v1":
        raise ValueError("Missing explicit non-production marker")
    mfile=target/"build-manifest.json"
    pfile=target/"staging-release.json"
    if mfile.is_symlink() or pfile.is_symlink() or mfile.stat().st_size>2_000_000:
        raise ValueError("Unapproved build manifest")
    raw=mfile.read_bytes()
    manifest=json.loads(raw)
    proof=json.loads(pfile.read_text())
    files=manifest.get("files")
    if (proof.get("sourceSha")!=sha or
        proof.get("productionAuthorized") is not False or
        proof.get("releaseKind")!="public_static_preview_only" or
        proof.get("buildManifestSha256")!=digest(raw) or
        manifest.get("release_kind")!="public_static_preview_only" or
        not isinstance(files,dict) or not 3<=len(files)<=5000 or
        proof.get("assetsCount")!=len(files)):
        raise ValueError("STAGING provenance or asset count mismatch")
    total=0
    for name,sha256 in files.items():
        if not ASSET.fullmatch(name) or ".." in name or "//" in name or "\\" in name or not SHA64.fullmatch(sha256):
            raise ValueError("Unsafe static asset path/digest")
        f=target/name
        if f.is_symlink() or not f.is_file() or f.stat().st_size>MAX_ITEM or sha_file(f)!=sha256:
            raise ValueError("STAGING static file differs from signed-run build")
        total+=f.stat().st_size
    if total>MAX_TOTAL or "index.html" not in files:
        raise ValueError("Static canary exceeds strict size/entry budget")
    return sha,files


def mkdir_owned(path: Path, uid: int, gid: int, mode: int) -> None:
    if path.is_symlink():
        raise ValueError("Symlink directory forbidden")
    path.mkdir(exist_ok=True)
    if not path.is_dir():
        raise ValueError("Expected directory")
    os.chown(path,uid,gid)
    os.chmod(path,mode)


def populate_sidecar(sha: str, files: dict) -> None:
    owner=pwd.getpwnam("marcosa-deploy")
    group=grp.getgrnam("www-data")
    uid,gid=owner.pw_uid,group.gr_gid
    if CANARY.exists() or CANARY.is_symlink():
        raise ValueError("Canary destination already exists: rerun is not permitted")
    if not CANARY.parent.is_dir() or CANARY.parent.is_symlink():
        raise ValueError("Unexpected /var/www parent")
    mkdir_owned(CANARY,0,0,0o755)
    releases=CANARY/"releases"
    pointers=CANARY/"pointers"
    mkdir_owned(releases,uid,gid,0o2750)
    mkdir_owned(pointers,uid,gid,0o2750)
    source=STAGING/"current"
    tmp=Path(tempfile.mkdtemp(prefix=".pending-",dir=releases))
    try:
        os.chown(tmp,uid,gid)
        os.chmod(tmp,0o2750)
        for name,expected in sorted(files.items()):
            src=source/name
            dst=tmp/name
            for parent in reversed(list(dst.parents)[:-1]):
                if parent==tmp or tmp in parent.parents:
                    if not parent.exists():
                        parent.mkdir(mode=0o2750)
                        os.chown(parent,uid,gid)
                        os.chmod(parent,0o2750)
            shutil.copyfile(src,dst,follow_symlinks=False)
            if sha_file(dst)!=expected:
                raise ValueError("Canary copy verification failed")
            os.chown(dst,uid,gid)
            os.chmod(dst,0o640)
        final=releases/sha
        if final.exists() or final.is_symlink():
            raise ValueError("Release collision")
        os.replace(tmp,final)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    # Keep the approval marker ABSENT until Nginx and public HTTPS both pass.
    # This prevents main CI from promoting an incompletely installed canary.
    pointer=pointers/"current"
    pointer.symlink_to("../releases/"+sha)
    if not (pointer/"index.html").is_file():
        raise ValueError("Canary pointer activation failed")


def run(*args: str) -> None:
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=18)


def write_atomic(path:Path, raw:bytes, mode=0o644):
    if path.is_symlink():
        raise ValueError("Refuse symlink destination")
    temp=path.with_name(path.name+".marcosa-pending")
    if temp.exists() or temp.is_symlink():
        raise ValueError("Temporary config already exists")
    try:
        with temp.open("xb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        temp.chmod(mode)
        os.replace(temp,path)
    finally:
        if temp.exists():
            temp.unlink()


def check_host() -> None:
    hostname=subprocess.check_output(["hostname"],text=True,timeout=3).strip()
    if hostname!="vmi3625032":
        raise ValueError("Unexpected VPS: refusing production canary install")
    if not ENABLED.is_symlink() or ENABLED.resolve()!=CONF.resolve():
        raise ValueError("Unexpected Nginx enabled-site symlink")
    if CONF.is_symlink() or not CONF.is_file() or CONF.stat().st_uid!=0:
        raise ValueError("Site config must be regular, root-owned file")
    if LEGACY.is_symlink() or not LEGACY.is_dir() or LEGACY.stat().st_uid!=0:
        raise ValueError("Legacy production root must remain root owned")


def root_recovery_active() -> bool:
    # Never touch /root during non-root read-only PLAN. The privileged APPLY
    # checks this same root state as part of its fail-closed preflight.
    return os.geteuid() == 0 and STATE.exists()


def do_plan(expect: str) -> dict:
    if not SHA64.fullmatch(expect):
        raise ValueError("Pinned expected Nginx SHA256 required")
    check_host()
    existing=CONF.read_bytes()
    if digest(existing)!=expect:
        raise ValueError("Nginx configuration changed since R104 read-only audit")
    patched=prepare_nginx_patch(existing.decode("utf8"))
    sha,files=verify_stage(STAGING)
    if CANARY.exists() or root_recovery_active() or SNIPPET.exists():
        raise ValueError("Canary installation already exists; no overwriting allowed")
    return {"sourceSha":sha,"stagingAssetsVerified":len(files),
            "liveRootSha256":sha_file(LEGACY/"index.html",5_000_000),
            "beforeConfigSha256":expect,"afterConfigSha256":digest(patched.encode()),
            "canaryPath":"/network-os/","rootReplacementAllowed":False}


def apply(expect: str,confirm: str) -> dict:
    if os.geteuid()!=0 or confirm!="MARCOSA-ADD-ONLY-CANARY":
        raise ValueError("Explicit root-owned approval required for Nginx modification")
    before=do_plan(expect)
    run("nginx","-t")
    raw=CONF.read_bytes()
    patched=prepare_nginx_patch(raw.decode("utf8")).encode()
    sha,files=verify_stage(STAGING)
    populate_sidecar(sha,files)
    STATE_DIR.mkdir(mode=0o700,exist_ok=True)
    if STATE_DIR.is_symlink() or STATE.exists():
        raise ValueError("Recovery state must be fresh")
    STATE_DIR.chmod(0o700)
    backup=STATE_DIR/("nginx-before-"+sha+".conf")
    if backup.exists() or backup.is_symlink():
        raise ValueError("Unexpected backup collision")
    backup.write_bytes(raw)
    backup.chmod(0o600)
    # Explicit authorization is only durable after HTTPS, recovery-state and
    # root-owned marker writes ALL succeed. Never leave an approved sidecar
    # behind when even the final chmod/write fails.
    marker=CANARY/".canary-approved"
    if marker.exists() or marker.is_symlink():
        raise ValueError("Unexpected preexisting canary approval")
    snippet_created=False
    try:
        if not SNIPPET.parent.is_dir():
            raise ValueError("Nginx snippet directory missing")
        write_atomic(SNIPPET,NGINX_SNIPPET.encode())
        snippet_created=True
        write_atomic(CONF,patched,CONF.stat().st_mode & 0o777)
        run("nginx","-t")
        run("systemctl","reload","nginx")
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):
                return None
        verified_url=URL+"?verify="+sha
        with build_opener(NoRedirect).open(Request(verified_url,headers={"Cache-Control":"no-store"}),timeout=16) as response:
            actual=response.read(5_000_001)
            if (response.status!=200 or response.geturl()!=verified_url or
                len(actual)>5_000_000 or digest(actual)!=files["index.html"]):
                raise ValueError("Public canary HTTPS bytes differ from trusted index")
        if sha_file(LEGACY/"index.html",5_000_000)!=before["liveRootSha256"]:
            raise ValueError("Unexpected change in original MARCOSA production root")
        state={"format":"MARCOSA-CANARY-R105","sourceSha":sha,
               "beforeConfigSha256":before["beforeConfigSha256"],
               "afterConfigSha256":before["afterConfigSha256"],
               "liveRootSha256":before["liveRootSha256"],
               "backup":str(backup),"snippetSha256":digest(NGINX_SNIPPET.encode())}
        STATE.write_text(json.dumps(state,indent=2)+"\n")
        STATE.chmod(0o600)
        marker.write_text(MARK)
        marker.chmod(0o444)
    except Exception:
        # Final-state and marker writes belong to the SAME rollback boundary
        # as Nginx activation and HTTPS readback. Fail closed if reload fails.
        restored=False
        try:
            write_atomic(CONF,raw,0o644)
            run("nginx","-t")
            run("systemctl","reload","nginx")
            restored=True
        finally:
            # An incomplete approval marker must never let a subsequent
            # non-root CI delivery promote an unapproved canary.
            if marker.is_file() and not marker.is_symlink():
                marker.unlink()
            if restored:
                if snippet_created and SNIPPET.is_file() and not SNIPPET.is_symlink():
                    SNIPPET.unlink()
                if STATE.is_file() and not STATE.is_symlink():
                    STATE.unlink()
        # Keep the unapproved sidecar and root backup for operator inspection,
        # never silently delete the original app or the only rollback evidence.
        raise
    return {"canaryUrl":URL,"sourceSha":sha,"assetsVerified":len(files),
            "liveRootUnchanged":True,"productionAppReplaced":False,
            "nginxConfigTestPassed":True,"revertPrepared":True}


def rollback(confirm: str) -> dict:
    if os.geteuid()!=0 or confirm!="MARCOSA-REMOVE-ONLY-CANARY":
        raise ValueError("Explicit root-only canary rollback approval required")
    check_host()
    if STATE.is_symlink() or not STATE.is_file():
        raise ValueError("Missing canary install evidence")
    state=json.loads(STATE.read_text())
    backup=Path(state["backup"])
    if not backup.is_relative_to(STATE_DIR) or backup.is_symlink() or not backup.is_file():
        raise ValueError("Unsafe canary recovery backup path")
    if digest(CONF.read_bytes())!=state["afterConfigSha256"]:
        raise ValueError("Existing Nginx file changed since canary install: refuse to overwrite")
    if sha_file(SNIPPET)!=state["snippetSha256"]:
        raise ValueError("Canary include changed unexpectedly: refuse to overwrite")
    original=backup.read_bytes()
    if digest(original)!=state["beforeConfigSha256"]:
        raise ValueError("Backup corrupted")
    write_atomic(CONF,original,CONF.stat().st_mode&0o777)
    run("nginx","-t")
    run("systemctl","reload","nginx")
    SNIPPET.unlink()
    marker=CANARY/".canary-approved"
    if marker.is_symlink() or not marker.is_file() or marker.read_text()!=MARK:
        raise ValueError("Unexpected canary approval state")
    marker.unlink()
    disabled=CANARY/".canary-disabled"
    if disabled.exists() or disabled.is_symlink():
        raise ValueError("Unexpected canary disabled marker")
    disabled.write_text("MARCOSA-CANARY-DISABLED-v1\n")
    disabled.chmod(0o444)
    STATE.rename(STATE_DIR/"reverted.json")
    return {"canaryRemovedFromNginx":True,"legacyProductionUnchanged":True,
            "sidecarFilesRetainedForForensicReview":True}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("mode",choices=["plan","apply","rollback"])
    p.add_argument("--expect-config-sha256")
    p.add_argument("--confirm")
    a=p.parse_args()
    if a.mode=="plan":
        result=do_plan(a.expect_config_sha256 or "")
    elif a.mode=="apply":
        result=apply(a.expect_config_sha256 or "",a.confirm or "")
    else:
        result=rollback(a.confirm or "")
    print(json.dumps(result,sort_keys=True))


if __name__=="__main__":
    try:
        main()
    except Exception as e:
        print("MARCOSA_R105_INSTALL_BLOCKED="+type(e).__name__+": "+str(e)[:140],file=sys.stderr)
        sys.exit(2)
