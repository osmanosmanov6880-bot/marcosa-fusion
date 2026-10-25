#!/usr/bin/env bash
# Roll back the STAGING symlink only. No access to production is needed.
set -euo pipefail
[[ "$(id -un)" == "marcosa-deploy" ]] || { echo "Refusing non-staging user" >&2; exit 2; }
ROOT="$HOME/marcosa-staging"
[[ -d "$ROOT" && ! -L "$ROOT" ]] || exit 2
[[ -f "$ROOT/.staging-approved" && ! -L "$ROOT/.staging-approved" ]] || exit 2
[[ -d "$ROOT/releases" && ! -L "$ROOT/releases" ]] || exit 2
[[ "$(tr -d '\r\n' < "$ROOT/.staging-approved")" == "MARCOSA-STAGING-APPROVED-v1" ]] || exit 2
[[ -L "$ROOT/current" && -L "$ROOT/previous" ]] || {
  echo "No completed pair of staging releases to roll back" >&2; exit 2;
}
OLD="$(readlink "$ROOT/current")"
TARGET="$(readlink "$ROOT/previous")"
[[ "$OLD" =~ ^releases/[a-f0-9]{40}$ ]] || exit 2
[[ "$TARGET" =~ ^releases/[a-f0-9]{40}$ ]] || exit 2
# Verify the TARGET release, not just index.html. The active release may
# be corrupt (that is exactly when a rollback must remain possible).
# No remote helper file is required: GitHub streams this complete script to VPS.
python3 - "$ROOT" "$TARGET" <<'PY'
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys

root=Path(sys.argv[1])
rel=sys.argv[2]
expected=rel.removeprefix("releases/")
sha40=re.compile(r"^[0-9a-f]{40}$")
sha64=re.compile(r"^[0-9a-f]{64}$")
asset=re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_+.-]{0,180}\.(?:html|htm|js|mjs|css|svg|png|jpe?g|webp|json)$")
if not sha40.fullmatch(expected) or rel!="releases/"+expected:
    raise SystemExit("ROLLBACK_TARGET_ID_INVALID")
target=root/"releases"/expected
if (target.is_symlink() or not target.is_dir() or
        not target.resolve().is_relative_to((root/"releases").resolve())):
    raise SystemExit("ROLLBACK_TARGET_DIRECTORY_UNTRUSTED")
manifest_path=target/"build-manifest.json"
proof_path=target/"staging-release.json"
def regular(path,cap):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>cap:
        raise SystemExit("ROLLBACK_TARGET_FILE_INVALID")
    if not stat.S_ISREG(path.lstat().st_mode):
        raise SystemExit("ROLLBACK_TARGET_SPECIAL_FILE")
    return path
raw=regular(manifest_path,2*1024*1024).read_bytes()
proof_raw=regular(proof_path,8192).read_bytes()
manifest=json.loads(raw)
proof=json.loads(proof_raw)
files=manifest.get("files")
if (manifest.get("release_kind")!="public_static_preview_only" or
    proof.get("releaseKind")!="public_static_preview_only" or
    proof.get("productionAuthorized") is not False or
    proof.get("sourceSha")!=expected or
    proof.get("format")!="MARCOSA-STAGING-READBACK-v1" or
    proof.get("buildManifestSha256")!=hashlib.sha256(raw).hexdigest() or
    not isinstance(files,dict) or not 3<=len(files)<=5000 or
    proof.get("assetsCount")!=len(files) or
    "index.html" not in files):
    raise SystemExit("ROLLBACK_TARGET_ATTESTATION_INVALID")
count=0
total=0
for name,checksum in files.items():
    if (not isinstance(name,str) or not asset.fullmatch(name) or
        ".." in name or "//" in name or "\\" in name or
        not isinstance(checksum,str) or not sha64.fullmatch(checksum)):
        raise SystemExit("ROLLBACK_TARGET_MANIFEST_PATH_UNSAFE")
    relpath=PurePosixPath(name)
    path=target.joinpath(*relpath.parts)
    parent=path.parent
    while parent!=target:
        if parent.is_symlink() or not parent.is_dir():
            raise SystemExit("ROLLBACK_TARGET_PARENT_LINK_UNSAFE")
        parent=parent.parent
    regular(path,20*1024*1024)
    total+=path.stat().st_size
    if total>300*1024*1024:
        raise SystemExit("ROLLBACK_TARGET_TOTAL_SIZE_UNSAFE")
    digest=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024*1024),b""):
            digest.update(chunk)
    if digest.hexdigest()!=checksum:
        raise SystemExit("ROLLBACK_TARGET_CHECKSUM_MISMATCH")
    count+=1
print("STAGING_ROLLBACK_TARGET_BYTES_VERIFIED=PASS")
print("STAGING_ROLLBACK_TARGET_ASSETS_VERIFIED="+str(count))
PY
[[ "$OLD" != "$TARGET" ]] || { echo "Current and previous are identical" >&2; exit 2; }
[[ -d "$ROOT/$OLD" && ! -L "$ROOT/$OLD" ]] || exit 2
# Prepare both new pointers before changing the existing ones.
[[ ! -e "$ROOT/.rollback-current-next" && ! -L "$ROOT/.rollback-current-next" ]] || exit 2
[[ ! -e "$ROOT/.rollback-previous-next" && ! -L "$ROOT/.rollback-previous-next" ]] || exit 2
ln -s "$TARGET" "$ROOT/.rollback-current-next"
ln -s "$OLD" "$ROOT/.rollback-previous-next"
mv -Tf "$ROOT/.rollback-current-next" "$ROOT/current"
mv -Tf "$ROOT/.rollback-previous-next" "$ROOT/previous"
[[ -s "$ROOT/current/index.html" ]]
echo "STAGING rolled back from $OLD to $TARGET"
echo "Production, databases and other applications were not touched."
