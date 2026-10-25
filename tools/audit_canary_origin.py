#!/usr/bin/env python3
"""R108: self-contained source audit for hosting the preview under MARCOSA auth origin.

This is a RISK REPORT, never authorization for same-origin production.
Do not print source snippets, storage content, credentials, or API endpoints.
"""
from __future__ import annotations
import json
from pathlib import Path
import re
import sys

EXT={".html",".css",".js",".mjs"}
CAP=5*1024*1024
MAX_FILES=1000
URL_ATTRIBUTE=re.compile(r"""(?:href|src|action)\s*=\s*["']/(?!/)[^"']+["']""",re.I)
CSS_ROOT=re.compile(r"""url\(\s*['"]?/(?!/)""",re.I)
JS_ROOT=re.compile(r"""(?:fetch|open|assign|replace)\s*\(\s*['"]/(?!/)""",re.I)
ORIGIN_REF=re.compile(r"""https://(?:www\.)?marcosa\.club(?:/|["'])""",re.I)
COUNTS={
    "localStorage":re.compile(r"\blocalStorage\b"),
    "sessionStorage":re.compile(r"\bsessionStorage\b"),
    "indexedDB":re.compile(r"\bindexedDB\b"),
    "cookieApi":re.compile(r"\bdocument\.cookie\b"),
    "serviceWorker":re.compile(r"\bserviceWorker\b")
}


def audit(root:Path)->dict:
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Expected genuine static-source directory")
    files=sorted(p for p in root.rglob("*") if p.suffix.lower() in EXT and p.is_file())
    if len(files)>MAX_FILES:
        raise ValueError("Source asset count exceeds audit cap")
    issues=[]
    files_checked=0
    absolute=0
    storage_counts={k:0 for k in COUNTS}
    hardcoded_old=0
    for path in files:
        if path.is_symlink() or path.stat().st_size>CAP or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Linked, external or oversized static source: refused")
        content=path.read_text(encoding="utf8",errors="replace")
        rel=path.relative_to(root).as_posix()
        files_checked+=1
        root_urls=len(URL_ATTRIBUTE.findall(content))+len(CSS_ROOT.findall(content))+len(JS_ROOT.findall(content))
        absolute+=root_urls
        if root_urls:issues.append({"file":rel,"type":"root-relative-navigation-or-asset","count":root_urls})
        for key,pattern in COUNTS.items():
            count=len(pattern.findall(content))
            if count:
                storage_counts[key]+=count
                issues.append({"file":rel,"type":key,"count":count})
        old=len(ORIGIN_REF.findall(content))
        hardcoded_old+=old
        if old:issues.append({"file":rel,"type":"hardcoded-legacy-origin","count":old})
    uses_persistent_storage=bool(storage_counts["localStorage"] or storage_counts["indexedDB"] or storage_counts["cookieApi"])
    return {
        "format":"MARCOSA-R108-ORIGIN-RISK",
        "filesAudited":files_checked,
        "rootRelativeUrlReferences":absolute,
        "legacyOriginReferences":hardcoded_old,
        "storageApis":storage_counts,
        "filesWithFindings":len({x["file"] for x in issues}),
        "findings":issues,
        "sameOriginCanaryRisk":uses_persistent_storage,
        "legacyAuthStorageInspected":False,
        "safeToEnableSameOriginProductionAutomatically":False,
        "productionCutoverAuthorized":False,
        "recommendedIsolation":"independent HTTPS origin (GitHub Pages preview or dedicated subdomain)",
        "interpretation":"Path-only isolation is NOT origin isolation. No auth, database or localStorage integration reviewed."
    }


def main():
    if len(sys.argv)>2:
        raise ValueError("Usage: python audit_canary_origin.py [site-dir]")
    path=Path(sys.argv[1]) if len(sys.argv)==2 else Path("site")
    print(json.dumps(audit(path),sort_keys=True,ensure_ascii=True))


if __name__=="__main__":
    try:
        main()
    except (OSError,ValueError) as error:
        print("R108_ORIGIN_AUDIT_BLOCKED="+type(error).__name__,file=sys.stderr)
        raise SystemExit(2)
