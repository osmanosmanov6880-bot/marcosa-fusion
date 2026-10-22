#!/usr/bin/env bash
# Deploy a validated static MARCOSA build ONLY under the staging user's home.
set -euo pipefail

if [[ "$#" -ne 2 ]]; then echo "usage: activate-staging.sh COMMIT_SHA ARCHIVE_SHA256" >&2; exit 2; fi
SHA="$1"
DIGEST="$2"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid release SHA" >&2; exit 2; }
[[ "$DIGEST" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid archive hash" >&2; exit 2; }
[[ "$(id -un)" == "marcosa-deploy" ]] || { echo "Only marcosa-deploy may run" >&2; exit 2; }

ROOT="$HOME/marcosa-staging"
MARKER="$ROOT/.staging-approved"
[[ -d "$ROOT" && ! -L "$ROOT" ]] || { echo "Staging directory not provisioned" >&2; exit 2; }
[[ -f "$MARKER" ]] || { echo "Missing staging approval marker" >&2; exit 2; }
[[ "$(tr -d '\r\n' < "$MARKER")" == "MARCOSA-STAGING-APPROVED-v1" ]] || {
  echo "Incorrect staging approval marker" >&2; exit 2;
}
[[ -d "$ROOT/incoming" && -d "$ROOT/releases" ]] || { echo "Staging directories missing" >&2; exit 2; }

ARCHIVE="$ROOT/incoming/$SHA.tar.gz"
TARGET="$ROOT/releases/$SHA"
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || { echo "Release archive missing" >&2; exit 2; }
printf '%s  %s\n' "$DIGEST" "$ARCHIVE" | sha256sum -c --status - || {
  echo "SHA256 mismatch; release refused" >&2; exit 3;
}
# The archive is created by the CI build from dist/; reject unsafe paths.
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..|*\\*) echo "Unsafe tar path; release refused" >&2; exit 3 ;;
  esac
done < <(tar -tzf "$ARCHIVE")
umask 027
if [[ ! -e "$TARGET" ]]; then
  TMP="$(mktemp -d "$ROOT/releases/.incoming-$SHA.XXXXXXXX")"
  trap 'rm -rf -- "$TMP"' EXIT
  tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$TMP"
  [[ -s "$TMP/index.html" ]] || { echo "Missing index.html" >&2; exit 3; }
  if find "$TMP" -type l -print -quit | grep -q .; then
    echo "Unexpected symlink in site archive" >&2
    exit 3
  fi
  mv -- "$TMP" "$TARGET"
  trap - EXIT
fi
[[ -s "$TARGET/index.html" ]] || { echo "Invalid target release" >&2; exit 3; }

CURRENT=""
if [[ -L "$ROOT/current" ]]; then
  CURRENT="$(readlink "$ROOT/current")"
  [[ "$CURRENT" =~ ^releases/[a-f0-9]{40}$ ]] || { echo "Unexpected current symlink" >&2; exit 3; }
elif [[ -e "$ROOT/current" ]]; then
  echo "Refusing to replace non-symlink current" >&2
  exit 3
fi

if [[ -n "$CURRENT" ]]; then
  ln -s "$CURRENT" "$ROOT/.previous-next-$SHA"
  mv -Tf "$ROOT/.previous-next-$SHA" "$ROOT/previous"
fi
ln -s "releases/$SHA" "$ROOT/.current-next-$SHA"
mv -Tf "$ROOT/.current-next-$SHA" "$ROOT/current"
[[ -s "$ROOT/current/index.html" ]]
echo "STAGING deployed: $SHA"
echo "No production files, DNS, Supabase or other services changed."
