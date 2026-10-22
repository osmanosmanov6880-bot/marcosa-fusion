#!/usr/bin/env bash
# Roll back the STAGING symlink only. No access to production is needed.
set -euo pipefail
[[ "$(id -un)" == "marcosa-deploy" ]] || { echo "Refusing non-staging user" >&2; exit 2; }
ROOT="$HOME/marcosa-staging"
[[ -d "$ROOT" && ! -L "$ROOT" ]] || exit 2
[[ -f "$ROOT/.staging-approved" ]] || exit 2
[[ "$(tr -d '\r\n' < "$ROOT/.staging-approved")" == "MARCOSA-STAGING-APPROVED-v1" ]] || exit 2
[[ -L "$ROOT/current" && -L "$ROOT/previous" ]] || {
  echo "No completed pair of staging releases to roll back" >&2; exit 2;
}
OLD="$(readlink "$ROOT/current")"
TARGET="$(readlink "$ROOT/previous")"
[[ "$OLD" =~ ^releases/[a-f0-9]{40}$ ]] || exit 2
[[ "$TARGET" =~ ^releases/[a-f0-9]{40}$ ]] || exit 2
[[ -s "$ROOT/$TARGET/index.html" ]] || exit 2
[[ -s "$ROOT/$OLD/index.html" ]] || exit 2
ln -s "$TARGET" "$ROOT/.rollback-current-next"
mv -Tf "$ROOT/.rollback-current-next" "$ROOT/current"
ln -s "$OLD" "$ROOT/.rollback-previous-next"
mv -Tf "$ROOT/.rollback-previous-next" "$ROOT/previous"
[[ -s "$ROOT/current/index.html" ]]
echo "STAGING rolled back from $OLD to $TARGET"
echo "Production, databases and other applications were not touched."
