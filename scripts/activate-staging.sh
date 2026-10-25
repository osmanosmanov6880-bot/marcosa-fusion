#!/usr/bin/env bash
# Atomic staging-only activation. Cannot write production paths or run as root.
set -euo pipefail

if [[ "$#" -ne 2 ]]; then echo "usage: activate-staging.sh SHA ARCHIVE_SHA256" >&2; exit 2; fi
SHA="$1"
DIGEST="$2"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid release SHA" >&2; exit 2; }
[[ "$DIGEST" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid archive SHA256" >&2; exit 2; }
[[ "$(id -un)" == "marcosa-deploy" ]] || { echo "Only marcosa-deploy may activate staging" >&2; exit 2; }

ROOT="$HOME/marcosa-staging"
[[ -d "$ROOT" && ! -L "$ROOT" ]] || { echo "Staging root missing or a symlink" >&2; exit 2; }
[[ -d "$ROOT/incoming" && ! -L "$ROOT/incoming" ]] || exit 2
[[ -d "$ROOT/releases" && ! -L "$ROOT/releases" ]] || exit 2
[[ -f "$ROOT/.staging-approved" && ! -L "$ROOT/.staging-approved" ]] || exit 2
[[ "$(tr -d '\r\n' < "$ROOT/.staging-approved")" == "MARCOSA-STAGING-APPROVED-v1" ]] || {
  echo "Staging marker missing or invalid" >&2; exit 2;
}

ARCHIVE="$ROOT/incoming/$SHA.tar.gz"
TARGET="$ROOT/releases/$SHA"
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || { echo "Missing staging archive" >&2; exit 2; }
printf '%s  %s\n' "$DIGEST" "$ARCHIVE" | sha256sum -c --status - || {
  echo "Archive checksum mismatch; refusing activation" >&2; exit 3;
}
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  [[ -d "$TARGET" && ! -L "$TARGET" ]] || { echo "Unsafe existing target" >&2; exit 3; }
else
  TMP="$(mktemp -d "$ROOT/releases/.incoming-$SHA.XXXXXXXX")"
  trap 'rm -rf -- "$TMP"' EXIT

  # Fail closed on all archive links, device nodes, traversal, oversized or
  # duplicate entries. Write files manually: tar -x is deliberately not used.
  python3 - "$ARCHIVE" "$TMP" <<'PY'
import pathlib
import shutil
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
seen = set()
total_size = 0
max_files = 5000
max_total = 300 * 1024 * 1024
max_file = 100 * 1024 * 1024
with tarfile.open(archive, "r:gz") as content:
    members = content.getmembers()
    if len(members) > max_files:
        raise SystemExit("Too many archive entries")
    for member in members:
        name = member.name
        if (not name or name.startswith("/") or "\\" in name or
                any(ord(char) < 32 for char in name)):
            raise SystemExit("Invalid archive entry")
        path = pathlib.PurePosixPath(name)
        if ".." in path.parts:
            raise SystemExit("Archive path traversal")
        if not (member.isdir() or member.isfile()):
            raise SystemExit("Symlinks, hardlinks and special files are forbidden")
        normalized = str(path)
        if normalized == ".":
            if not member.isdir():
                raise SystemExit("Unexpected archive root file")
            continue
        if normalized in seen:
            raise SystemExit("Duplicate archive member")
        seen.add(normalized)
        if member.isfile():
            if member.size > max_file:
                raise SystemExit("Oversized archive member")
            total_size += member.size
            if total_size > max_total:
                raise SystemExit("Oversized extraction")
        target = destination.joinpath(*path.parts)
        if member.isdir():
            if target.exists() and not target.is_dir():
                raise SystemExit("File/directory collision")
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with content.extractfile(member) as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            target.chmod(0o644)
PY
  [[ -s "$TMP/index.html" ]] || { echo "Invalid webroot: index.html missing" >&2; exit 3; }
  mv -- "$TMP" "$TARGET"
  trap - EXIT
fi

[[ -s "$TARGET/index.html" ]] || { echo "Invalid target webroot" >&2; exit 3; }
if find "$TARGET" -type l -print -quit | grep -q .; then
  echo "Unexpected symlinks in staging target" >&2; exit 3;
fi

CURRENT=""
if [[ -L "$ROOT/current" ]]; then
  CURRENT="$(readlink "$ROOT/current")"
  [[ "$CURRENT" =~ ^releases/[a-f0-9]{40}$ ]] || { echo "Unsafe current symlink" >&2; exit 3; }
elif [[ -e "$ROOT/current" ]]; then
  echo "Refusing to replace a non-symlink current" >&2; exit 3;
fi
if [[ -L "$ROOT/previous" ]]; then
  PREV="$(readlink "$ROOT/previous")"
  [[ "$PREV" =~ ^releases/[a-f0-9]{40}$ ]] || { echo "Unsafe previous symlink" >&2; exit 3; }
elif [[ -e "$ROOT/previous" ]]; then
  echo "Refusing to replace a non-symlink previous" >&2; exit 3;
fi

# Idempotent retry: keep a genuinely older previous release intact.
if [[ "$CURRENT" == "releases/$SHA" ]]; then
  echo "STAGING already active: $SHA (verified release retained)"
  exit 0
fi
if [[ -n "$CURRENT" ]]; then
  ln -s "$CURRENT" "$ROOT/.previous-next-$SHA"
  mv -Tf "$ROOT/.previous-next-$SHA" "$ROOT/previous"
fi
ln -s "releases/$SHA" "$ROOT/.current-next-$SHA"
mv -Tf "$ROOT/.current-next-$SHA" "$ROOT/current"
[[ -s "$ROOT/current/index.html" ]]
echo "STAGING deployed: $SHA"
echo "Production, Supabase, Nginx, DNS and other VPS applications unchanged."
