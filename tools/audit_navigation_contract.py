#!/usr/bin/env python3
"""R111: fail-closed navigation/asset checks for the editable MARCOSA preview.

Immutable 1+MB cinema snapshots are audited separately for legacy root URLs in
R108. This checks FIRST-PARTY editable navigation/assets only and does not
contact the user's web service, credentials or database.
"""
from __future__ import annotations

import argparse
import ast
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"site"
PAGES=("index.html","social.html","stories.html","creator.html","source-hub.html",
       "cinema-pilot.html","film-network.html","film-internet-v-humanity.html")
LIMIT=200_000
STATIC_ASSETS={*(
    "visual-station.webp","visual-city.webp","visual-cascade.webp","visual-hero.webp",
    "visual-archive.webp","visual-control.webp","visual-operator.webp","visual-earthrise.webp",
    "visual-city-director.webp","visual-cascade-director.webp","visual-hero-director.webp",
    "visual-archive-director.webp","visual-control-director.webp","visual-station-director.webp"
)}
FORBIDDEN_SCHEMES=("javascript:", "vbscript:", "file:")
KNOWN_SCHEMES={"http","https","mailto","tel","data","blob"}


def expected_public_files(builder:Path)->set[str]:
    module=ast.parse(builder.read_text(encoding="utf8"))
    for node in module.body:
        if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="PUBLIC_FILES" for t in node.targets):
            files=ast.literal_eval(node.value)
            if not isinstance(files,tuple) or len(files)<25 or any(not isinstance(x,str) for x in files):
                raise ValueError("Invalid trusted public allowlist")
            return set(files)|STATIC_ASSETS
    raise ValueError("Public file allowlist not found")


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links:list[tuple[str,str,str]]=[]
        self.anchors:set[str]=set()

    def handle_starttag(self,tag,attrs):
        row=dict(attrs)
        if row.get("id"):
            self.anchors.add(row["id"])
        if tag in ("a","link","script","img","source","iframe","form"):
            key="href" if tag in ("a","link") else "action" if tag=="form" else "src"
            value=row.get(key)
            if value:
                self.links.append((tag,value,row.get("target") or ""))


def check_page(html:Path,allowed:set[str],base:Path|None=None)->dict:
    if not html.is_file() or html.is_symlink() or html.stat().st_size>LIMIT:
        raise ValueError("Reviewed editable HTML not present or oversized")
    p=Links()
    p.feed(html.read_text(encoding="utf8",errors="strict"))
    bad:list[dict]=[]
    targets:set[str]=set()
    hashes=0
    external=0
    missing_hash=0
    for tag,value,target in p.links:
        url=value.strip()
        if not url:
            continue
        if url.lower().startswith(FORBIDDEN_SCHEMES):
            bad.append({"kind":"unsafe-scheme","tag":tag,"target":url[:120]})
            continue
        if url.startswith("#"):
            hashes+=1
            if len(url)>1 and unquote(url[1:]) not in p.anchors:
                missing_hash+=1
            continue
        if url.startswith("//"):
            external+=1
            continue
        try:
            parsed=urlsplit(url)
        except ValueError:
            bad.append({"kind":"malformed-url","tag":tag,"target":url[:120]})
            continue
        if parsed.scheme:
            if parsed.scheme.lower() not in KNOWN_SCHEMES:
                bad.append({"kind":"unapproved-scheme","tag":tag,"target":url[:120]})
            else:
                external+=1
            continue
        name=unquote(parsed.path)
        if not name and parsed.fragment:
            hashes+=1
            if unquote(parsed.fragment) not in p.anchors:
                missing_hash+=1
            continue
        if name.startswith("/"):
            bad.append({"kind":"root-relative-on-project-pages","tag":tag,"target":name[:120]})
            continue
        raw=PurePosixPath(name)
        if ".." in raw.parts or "\\" in name or name.startswith(".env"):
            bad.append({"kind":"unsafe-local-path","tag":tag,"target":name[:120]})
            continue
        normalized=str(raw)
        if normalized.startswith("./"):
            normalized=normalized[2:]
        if normalized not in allowed:
            bad.append({"kind":"missing-public-resource","tag":tag,"target":normalized[:120]})
        else:
            targets.add(normalized)
    return {"page":html.name,"references":len(p.links),"validInternalTargets":len(targets),
            "samePageAnchors":hashes,"unresolvedDynamicAnchorHints":missing_hash,
            "externalReferences":external,"errors":bad}


def audit(site:Path=SOURCE,builder:Path=ROOT/"tools"/"build_webroot.py")->dict:
    allowed=expected_public_files(builder)
    reports=[check_page(site/name,allowed) for name in PAGES]
    failures=sum(len(p["errors"]) for p in reports)
    return {"format":"MARCOSA-R111-NAVIGATION-VALIDATOR","editablePagesAudited":len(reports),
            "internalReferencesValidated":sum(p["validInternalTargets"] for p in reports),
            "externalReferencesIgnored":sum(p["externalReferences"] for p in reports),
            "samePageAnchorHints":sum(p["unresolvedDynamicAnchorHints"] for p in reports),
            "errorsCount":failures,"pages":reports,
            "immutableCinemaExcluded":True,"productionRootInspected":False,
            "authenticatedBackendVerified":False}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--site",default=str(SOURCE))
    p.add_argument("--builder",default=str(ROOT/"tools"/"build_webroot.py"))
    options=p.parse_args()
    report=audit(Path(options.site),Path(options.builder))
    print(json.dumps(report,sort_keys=True,ensure_ascii=True))
    if report["errorsCount"]:
        print("R111_INTERNAL_LINKS=FAIL",file=sys.stderr)
        sys.exit(2)
    print("R111_INTERNAL_LINKS=PASS",file=sys.stderr)


if __name__=="__main__":
    try:main()
    except (ValueError,OSError,SyntaxError) as e:
        print("R111_NAVIGATION_AUDIT_BLOCKED="+type(e).__name__,file=sys.stderr)
        raise SystemExit(2)
