#!/usr/bin/env python3
"""R104: non-root, read-only Nginx canary feasibility audit for MARCOSA.

This program does not dump Nginx configuration or read secrets. It reports only
counts, booleans, familiar public paths and SHA256 of public index bytes.
A successful audit NEVER grants permission to edit Nginx or production.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

LIVE = Path("/opt/marcosa/current")
STAGING = Path("/home/marcosa-deploy/marcosa-staging")
CONF = Path("/etc/nginx/sites-available/marcosa")
ROUTE = "/network-os/"
SOURCE_SHA = re.compile(r"^[a-f0-9]{40}$")
MATCH_LEGACY = "33d79f35b6d4873113cab99575606e5700802c0d0720eefd4604d49fe08aa9b3"
CONFIG_LIMIT = 256 * 1024
INDEX_LIMIT = 5 * 1024 * 1024


def digest_file(path: Path, limit: int) -> str:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > limit:
        raise ValueError("Invalid public index or manifest file")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def nginx_topology(config: str) -> dict:
    # Never echo config contents: it can contain internal endpoints and credentials.
    # Remove comments first (not meant as a full parser, only a conservative gate).
    uncommented = "\n".join(s.split("#", 1)[0] for s in config.splitlines())
    tokens = re.findall(r"\b(server_name|listen|location|include|root|alias|proxy_pass)\s+([^;{}]+)([;{])", uncommented)
    names = [v.strip() for k, v, _ in tokens if k == "server_name"]
    listeners = [v.strip() for k, v, _ in tokens if k == "listen"]
    roots = [v.strip() for k, v, _ in tokens if k == "root"]
    includes = [v.strip() for k, v, _ in tokens if k == "include"]
    routes = [v.strip() for k, v, _ in tokens if k == "location"]
    return {
        "liveHostnameFound": any(
            "marcosa.club" in n.split() or "www.marcosa.club" in n.split()
            for n in names),
        "tlsListenerFound": any(re.match(r"(?:\S+:)?443(?:\s|$)", v)
                                or "ssl" in v.split() for v in listeners),
        "legacyRootDirectiveFound": "/opt/marcosa/current" in roots,
        "serverNameDirectives": len(names),
        "listenDirectives": len(listeners),
        "locationsCount": len(routes),
        "externalIncludeCount": len(includes),
        "canaryRouteAlreadyUsed": any(
            re.search(r"(^|\s)(?:=|\^~|~|~\*)?\s*/network-os(?:/|\s|$)", r)
            for r in routes),
        "nestedLocationOrRewriteNeedsReview": any(
            "rewrite" in v or "try_files" in v for k, v, _ in tokens if k == "location"),
        "configComplete": not bool(includes)
    }


def verify_readonly() -> dict:
    if os.geteuid() == 0 or os.environ.get("USER") != "marcosa-deploy":
        raise ValueError("only marcosa-deploy audit user is allowed")
    if not LIVE.is_dir() or LIVE.is_symlink() or not STAGING.is_dir() or STAGING.is_symlink():
        raise ValueError("Expected legacy root or non-root staging folder missing")
    live_index = LIVE / "index.html"
    current = STAGING / "current"
    if not current.is_symlink():
        raise ValueError("Staging release symlink missing")
    target = os.readlink(current)
    if not re.fullmatch(r"releases/[0-9a-f]{40}", target):
        raise ValueError("Staging release symlink is not source-pinned")
    if not current.resolve().is_relative_to((STAGING / "releases").resolve()):
        raise ValueError("Staging release symlink escapes approved folder")
    stage_index = current / "index.html"
    legacy_sha = digest_file(live_index, INDEX_LIMIT)
    stage_sha = digest_file(stage_index, INDEX_LIMIT)
    repo_sha = target.partition("/")[2]
    if not SOURCE_SHA.fullmatch(repo_sha):
        raise ValueError("Staging source identity invalid")
    approval = STAGING / ".staging-approved"
    if not approval.is_file() or approval.is_symlink() or approval.read_text().strip() != "MARCOSA-STAGING-APPROVED-v1":
        raise ValueError("Staging approval missing")
    file_available = CONF.is_file() and os.access(CONF, os.R_OK)
    topology = None
    if file_available:
        if CONF.stat().st_size > CONFIG_LIMIT:
            raise ValueError("Nginx configuration exceeds conservative read-only audit bound")
        topology = nginx_topology(CONF.read_text(encoding="utf8", errors="replace"))
    if os.access(LIVE, os.W_OK):
        raise ValueError("Staging SSH identity unexpectedly writable in production")
    return {
        "format": "MARCOSA-R104-PRODUCTION-CANARY-READINESS",
        "readOnly": True,
        "productionWritesMade": False,
        "productionCutoverAuthorized": False,
        "approvedReadOnlyVpsUser": "marcosa-deploy",
        "productionRoot": str(LIVE),
        "liveOwnerIsRoot": LIVE.stat().st_uid == 0,
        "productionWritableByDeploy": False,
        "liveIndexSha256": legacy_sha,
        "sameLiveIndexAsR101": legacy_sha == MATCH_LEGACY,
        "stagingIndexSha256": stage_sha,
        "liveAndStageIndexIdentical": legacy_sha == stage_sha,
        "stagingSourceSha": repo_sha,
        "stagingApprovalVerified": True,
        "nginxConfigReadable": bool(file_available),
        "nginxConfigSha256": digest_file(CONF, CONFIG_LIMIT) if file_available and not CONF.is_symlink() else None,
        "nginxTopology": topology,
        "proposedAdditivePath": ROUTE,
        "canaryCanBeInstalledByDeployUser": False,
        "nextRequiredGate": "ROOT_CONTROLLED_NGINX_CHANGE_WITH_BACKUP_AND_ROLLBACK",
        "canaryProposedButNotInstalled": True
    }


def main() -> int:
    print(json.dumps(verify_readonly(), sort_keys=True, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print("R104 READONLY_BLOCKED=" + type(error).__name__, file=sys.stderr)
        raise SystemExit(2)
