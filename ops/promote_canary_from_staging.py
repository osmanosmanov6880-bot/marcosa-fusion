#!/usr/bin/env python3
"""R106: non-root, additive canary promotion after a root-installed one-time gate.

Never edits Nginx, DNS, legacy /opt/marcosa, databases or user accounts.
If marker/sidecar has never been root-installed, reports CANARY_NOT_INSTALLED.
Public HTTP is verified independently by the caller; failures must invoke
the dedicated R106 rollback of the additive pointer, not STAGING/production.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import re
import shutil
import stat
import sys
import tempfile

HOME=Path("/home/marcosa-deploy/marcosa-staging")
ROOT=Path("/var/www/marcosa-network-os")
LIVE_INDEX=Path("/opt/marcosa/current/index.html")
OLD_LIVE_SHA="33d79f35b6d4873113cab99575606e5700802c0d0720eefd4604d49fe08aa9b3"
MARKER="MARCOSA-ADD-ONLY-CANARY-v1"
SOURCE=re.compile(r"^[a-f0-9]{40}$")
DIGEST=re.compile(r"^[a-f0-9]{64}$")
STATIC=re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_+.-]{0,180}\.(?:html|htm|js|mjs|css|svg|png|jpe?g|webp|json)$")
MAX=300*1024*1024
CAP=20*1024*1024


def sha_bytes(data:bytes)->str:
    return hashlib.sha256(data).hexdigest()


def sha_file(p:Path,maxbytes=CAP)->str:
    if p.is_symlink() or not p.is_file() or p.stat().st_size>maxbytes:
        raise ValueError("Missing, linked or oversized public asset")
    return sha_bytes(p.read_bytes())


def relative_release(path:Path)->str|None:
    if not path.is_symlink():
        if path.exists():
            raise ValueError("Expected only a release symlink")
        return None
    s=os.readlink(path)
    if not re.fullmatch(r"../releases/[a-f0-9]{40}",s):
        raise ValueError("Unexpected canary release pointer target")
    return s


def check_enabled()->bool:
    if os.geteuid()==0 or os.environ.get("USER")!="marcosa-deploy":
        raise ValueError("Canary publisher must be the unprivileged SSH deploy user")
    if not ROOT.exists():
        if ROOT.is_symlink():
            raise ValueError("Refuse canary symlink root")
        return False
    if ROOT.is_symlink() or not ROOT.is_dir() or ROOT.stat().st_uid!=0:
        raise ValueError("Canary sidecar root is not protected")
    marker=ROOT/".canary-approved"
    if not marker.exists():
        disabled=ROOT/".canary-disabled"
        if (disabled.is_file() and not disabled.is_symlink() and
                disabled.stat().st_uid==0 and
                disabled.read_text().strip()=="MARCOSA-CANARY-DISABLED-v1"):
            return False
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_uid!=0:
        raise ValueError("Missing independent ROOT-OWNED canary marker")
    if marker.read_text(encoding="utf8").strip()!=MARKER:
        raise ValueError("Canary marker contents unexpectedly changed")
    if ROOT.stat().st_mode&0o022 or marker.stat().st_mode&0o022:
        raise ValueError("Canary root/marker is writable by group/other")
    owner=pwd.getpwnam("marcosa-deploy").pw_uid
    nginx_gid=grp.getgrnam("www-data").gr_gid
    for name in ("releases","pointers"):
        p=ROOT/name
        if p.is_symlink() or not p.is_dir() or p.stat().st_uid!=owner or p.stat().st_gid!=nginx_gid:
            raise ValueError("Canary release/pointer directory ownership is wrong")
        if p.stat().st_mode&0o002 or not os.access(p,os.W_OK):
            raise ValueError("Canary directory unsafe/world writable/not writable")
    return True


def verify_stage(expected:str)->dict:
    if not SOURCE.fullmatch(expected):
        raise ValueError("Exact reviewed main SHA is required")
    if HOME.is_symlink() or not HOME.is_dir():
        raise ValueError("Approved STAGING home missing")
    approval=HOME/".staging-approved"
    if approval.is_symlink() or not approval.is_file() or approval.read_text().strip()!="MARCOSA-STAGING-APPROVED-v1":
        raise ValueError("STAGING approval no longer valid")
    current=HOME/"current"
    if not current.is_symlink() or os.readlink(current)!="releases/"+expected:
        raise ValueError("Staging current is not the requested exact build")
    target=HOME/"releases"/expected
    if not target.is_dir() or target.is_symlink() or current.resolve()!=target.resolve():
        raise ValueError("STAGING target is not an approved regular directory")
    m=target/"build-manifest.json"
    a=target/"staging-release.json"
    if m.is_symlink() or a.is_symlink() or not m.is_file() or not a.is_file():
        raise ValueError("Unapproved staging metadata symlink")
    manifest_raw=m.read_bytes()
    if len(manifest_raw)>2_000_000 or a.stat().st_size>8192:
        raise ValueError("STAGING manifest/attestation too large")
    manifest=json.loads(manifest_raw)
    att=json.loads(a.read_text())
    files=manifest.get("files")
    if (att.get("sourceSha")!=expected or
        att.get("buildManifestSha256")!=sha_bytes(manifest_raw) or
        att.get("releaseKind")!="public_static_preview_only" or
        manifest.get("release_kind")!="public_static_preview_only" or
        att.get("productionAuthorized") is not False or
        not isinstance(files,dict) or not 3<=len(files)<=5000 or
        att.get("assetsCount")!=len(files)):
        raise ValueError("No independently validated STAGING source provenance")
    total=0
    for name,checksum in files.items():
        if not STATIC.fullmatch(name) or ".." in name or "//" in name or "\\" in name or not DIGEST.fullmatch(checksum):
            raise ValueError("Unsafe canary public file path")
        file=target/name
        if sha_file(file)!=checksum:
            raise ValueError("Canary source asset checksum mismatch")
        total+=file.stat().st_size
    if total>MAX or sha_file(LIVE_INDEX,5_000_000)!=OLD_LIVE_SHA:
        raise ValueError("Static budget exceeded or original site changed since R104")
    return files


def promote(expected:str)->dict:
    if not check_enabled():
        return {"status":"NOT_INSTALLED"}
    files=verify_stage(expected)
    releases=ROOT/"releases"
    pointers=ROOT/"pointers"
    current=pointers/"current"
    old=relative_release(current)
    new="../releases/"+expected
    if old==new:
        if sha_file(current/"index.html")!=files["index.html"]:
            raise ValueError("Existing canary index was changed after staging verification")
        return {"status":"ALREADY_ACTIVE","sha":expected,"filesVerified":len(files)}
    target=releases/expected
    if target.is_symlink() or target.exists():
        raise ValueError("Reused canary release dir forbidden: only fresh exact builds")
    tmp=Path(tempfile.mkdtemp(prefix=".pending-",dir=releases))
    try:
        os.chmod(tmp,0o2750)
        for name,checksum in sorted(files.items()):
            src=HOME/"current"/name
            dest=tmp/name
            relative=Path(name).parts[:-1]
            par=tmp
            for piece in relative:
                par=par/piece
                if par.is_symlink():
                    raise ValueError("Unexpected canary directory symlink")
                if not par.exists():
                    par.mkdir(mode=0o2750)
                    os.chmod(par,0o2750)
            shutil.copyfile(src,dest,follow_symlinks=False)
            if sha_file(dest)!=checksum:
                raise ValueError("Canary destination checksum mismatch")
            dest.chmod(0o640)
        os.replace(tmp,target)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    if old:
        prev=pointers/".previous-next"
        if prev.exists() or prev.is_symlink():
            raise ValueError("Unexpected residual previous pointer")
        prev.symlink_to(old)
        os.replace(prev,pointers/"previous")
    temp=pointers/".current-next"
    if temp.exists() or temp.is_symlink():
        raise ValueError("Unexpected pending current pointer")
    temp.symlink_to(new)
    os.replace(temp,current)
    if sha_file(current/"index.html")!=files["index.html"]:
        raise ValueError("Canary pointer switched to wrong bytes")
    return {"status":"PASS","sha":expected,"filesVerified":len(files),"old":old or "",
            "productionRootModified":False}


def rollback(expected:str)->dict:
    if not check_enabled():
        raise ValueError("Root has not approved canary installation")
    if not SOURCE.fullmatch(expected):
        raise ValueError("Rollback expected canary SHA must be exact")
    pointers=ROOT/"pointers"
    current=pointers/"current"
    previous=pointers/"previous"
    old=relative_release(current)
    prior=relative_release(previous)
    if old!="../releases/"+expected or prior is None or old==prior:
        raise ValueError("Canary rollback is not needed or previous release missing")
    if not (pointers/prior/"index.html").is_file():
        raise ValueError("Previous canary release missing")
    temp=pointers/".canary-rollback-current"
    if temp.exists() or temp.is_symlink():
        raise ValueError("Unsafe residual rollback pointer")
    temp.symlink_to(prior)
    os.replace(temp,current)
    return {"status":"ROLLED_BACK","from":old,"to":prior,
            "productionRootModified":False}


def main():
    args=sys.argv[1:]
    if len(args)!=2 or args[0] not in ("status","promote","rollback"):
        raise ValueError("Usage: python3 - status|promote|rollback EXACT_MAIN_SHA")
    action,expected=args
    if not SOURCE.fullmatch(expected):
        raise ValueError("Exact 40-digit Git SHA required")
    if action=="status":
        result={"status":"READY" if check_enabled() else "NOT_INSTALLED"}
    elif action=="promote":
        result=promote(expected)
    else:
        result=rollback(expected)
    print(json.dumps(result,sort_keys=True))


if __name__=="__main__":
    try:
        main()
    except (ValueError,OSError,KeyError,json.JSONDecodeError) as e:
        print("R106_CANARY_PUBLISH_BLOCKED="+type(e).__name__,file=sys.stderr)
        raise SystemExit(2)
