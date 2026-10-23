#!/usr/bin/env bash
# MARCOSA R6 — read-only SSH connection diagnostics.
# Never print private keys or change remote files. Run only on trusted main.
set -Eeuo pipefail
umask 077

fail() {
  local code="$1" message="$2"
  printf '::error title=%s::%s\n' "$code" "$message" >&2
  exit 1
}
: "${DEPLOY_HOST:?Set MARCOSA_STAGING_HOST repository secret}"
: "${DEPLOY_USER:?Set MARCOSA_STAGING_USER repository secret}"
: "${DEPLOY_KEY:?Set MARCOSA_SSH_KEY repository secret}"
: "${KNOWN_HOSTS:?Set MARCOSA_SSH_KNOWN_HOSTS repository secret}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]{1,253}$ && "$DEPLOY_HOST" != -* && "$DEPLOY_HOST" != *..* ]] || fail "INVALID_HOST" "Configure a DNS name or IPv4 address, not an URL or port."
[[ "$DEPLOY_USER" == "marcosa-deploy" ]] || fail "INVALID_USER" "MARCOSA_STAGING_USER must be the restricted marcosa-deploy account, never root."
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] || fail "INVALID_PORT" "SSH port must be numeric."
((10#$DEPLOY_PORT >= 1 && 10#$DEPLOY_PORT <= 65535)) || fail "INVALID_PORT" "SSH port out of range."
if [[ "$DEPLOY_KEY" == ssh-ed25519\ * || "$DEPLOY_KEY" == ssh-rsa\ * ]]; then
  fail "PUBLIC_KEY_AS_PRIVATE" "MARCOSA_SSH_KEY contains a public key. It must contain the private key, not a .pub file."
fi
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -m 700 "$TMP/ssh"
printf '%s\n' "$DEPLOY_KEY" | sed 's/\r$//' > "$TMP/ssh/id_deploy"
chmod 600 "$TMP/ssh/id_deploy"
if ! ssh-keygen -y -P '' -f "$TMP/ssh/id_deploy" >/dev/null 2>&1; then
  fail "INVALID_PRIVATE_KEY" "Private key is invalid or encrypted with a passphrase. Check MARCOSA_SSH_KEY."
fi
PIN="$DEPLOY_HOST"
if [[ "$DEPLOY_PORT" != "22" ]]; then PIN="[$DEPLOY_HOST]:$DEPLOY_PORT"; fi
PIN_INPUT="$(printf '%s\n' "$KNOWN_HOSTS" | sed 's/\r$//' | sed '/^[[:space:]]*$/d')"
PIN_FORMAT="full_known_hosts"

if [[ "$PIN_INPUT" =~ ^ssh-ed25519[[:space:]]+[A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
  # A standalone SSH *host public key* from ssh_host_ed25519_key.pub is
  # equivalent to a known_hosts entry once bound to this specific host.
  PIN_FORMAT="host_public_key"
  printf '%s %s\n' "$PIN" "$PIN_INPUT" > "$TMP/ssh/known_hosts"
elif [[ "$PIN_INPUT" =~ ^SHA256:[A-Za-z0-9+/=]{40,60}$ ]]; then
  # A SHA256 host fingerprint can serve as a pin too, if it was independently
  # verified in the owner's Contabo console. Never trust an unchecked scan.
  PIN_FORMAT="pinned_sha256_fingerprint"
  if ! ssh-keyscan -T 12 -p "$DEPLOY_PORT" -t ed25519 "$DEPLOY_HOST" 2>/dev/null > "$TMP/ssh/scan"; then
    fail "HOST_KEY_SCAN_UNAVAILABLE" "Cannot obtain the ED25519 host key. Check SSH network/port; no host identity was accepted."
  fi
  if [[ ! -s "$TMP/ssh/scan" ]]; then
    fail "HOST_KEY_SCAN_UNAVAILABLE" "Remote server did not offer an ED25519 host key."
  fi
  ACTUAL="$(ssh-keygen -lf "$TMP/ssh/scan" -E sha256 2>/dev/null | awk 'NR==1 {print $2}')"
  [[ "$ACTUAL" == "$PIN_INPUT" ]] || fail "HOST_KEY_MISMATCH" "Live ED25519 key does not match the pinned fingerprint. Verify via Contabo; do not disable pinning."
  mv -- "$TMP/ssh/scan" "$TMP/ssh/known_hosts"
else
  printf '%s\n' "$PIN_INPUT" > "$TMP/ssh/known_hosts"
fi
chmod 600 "$TMP/ssh/known_hosts"
if ! ssh-keygen -lf "$TMP/ssh/known_hosts" >/dev/null 2>&1; then
  fail "INVALID_KNOWN_HOSTS" "Secret format unrecognized: provide a full known_hosts line, raw ssh-ed25519 host PUBLIC key, or verified SHA256: fingerprint. Never use the user's login key."
fi
if ! ssh-keygen -F "$PIN" -f "$TMP/ssh/known_hosts" >/dev/null 2>&1; then
  fail "HOST_NOT_PINNED" "Server key belongs to another host/port. Verify the correct VPS identity and re-pin without disabling StrictHostKeyChecking."
fi
printf 'HOST_PIN_FORMAT=%s\n' "$PIN_FORMAT"
printf 'SSH configuration: deploy_user=marcosa-deploy, port=%s, pinned_host=yes, private_key_format=valid\n' "$DEPLOY_PORT"
SSH=(-i "$TMP/ssh/id_deploy" -p "$DEPLOY_PORT"
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$TMP/ssh/known_hosts"
  -o ConnectTimeout=12 -o ServerAliveInterval=5 -o ServerAliveCountMax=2
  -o NumberOfPasswordPrompts=0)
set +e
ssh "${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" 'sh -s' -- >"$TMP/out" 2>"$TMP/error" <<'REMOTE'
set -eu
printf 'REMOTE_AUTH=PASS\n'
printf 'REMOTE_USER=%s\n' "$(id -un)"
printf 'REMOTE_HOST=%s\n' "$(hostname)"
if [ "$(id -un)" != "marcosa-deploy" ]; then
  echo 'REMOTE_READY=FAIL_USER'
  exit 31
fi
ROOT="$HOME/marcosa-staging"
if [ ! -d "$ROOT" ] || [ -L "$ROOT" ]; then
  echo 'REMOTE_READY=FAIL_STAGING_DIRECTORY'
  exit 32
fi
if [ ! -d "$ROOT/incoming" ] || [ ! -d "$ROOT/releases" ]; then
  echo 'REMOTE_READY=FAIL_RELEASE_DIRECTORIES'
  exit 33
fi
if [ ! -f "$ROOT/.staging-approved" ] || [ -L "$ROOT/.staging-approved" ]; then
  echo 'REMOTE_READY=FAIL_APPROVAL_MARKER'
  exit 34
fi
if [ "$(tr -d '\r\n' < "$ROOT/.staging-approved")" != 'MARCOSA-STAGING-APPROVED-v1' ]; then
  echo 'REMOTE_READY=FAIL_MARKER_CONTENT'
  exit 35
fi
if [ ! -w "$ROOT/incoming" ] || [ ! -w "$ROOT/releases" ]; then
  echo 'REMOTE_READY=FAIL_DIRECTORY_PERMISSIONS'
  exit 36
fi
echo 'REMOTE_READY=STAGING_READY'
REMOTE
STATUS=$?
set -e
if [[ -s "$TMP/out" ]]; then cat "$TMP/out"; fi
if (( STATUS != 0 )); then
  if grep -Eqi 'Permission denied|Authentication failed' "$TMP/error"; then
    fail "SSH_AUTH_DENIED" "Key was rejected by marcosa-deploy. Install the matching staging .pub key in /home/marcosa-deploy/.ssh/authorized_keys."
  elif grep -Eqi 'Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED' "$TMP/error"; then
    fail "HOST_KEY_MISMATCH" "Pinned host key mismatch; verify independently in the Contabo console, do not bypass verification."
  elif grep -Eqi 'Connection refused|Connection timed out|No route to host|Network is unreachable|Could not resolve hostname' "$TMP/error"; then
    fail "SSH_NETWORK" "VPS SSH endpoint is unreachable. Check host, port, Contabo firewall and sshd."
  elif ((STATUS >= 31 && STATUS <= 36)); then
    fail "STAGING_UNPREPARED" "SSH worked but dedicated staging directories/marker/permissions are not ready."
  else
    fail "SSH_OTHER" "Read-only SSH preflight failed. Check server-side SSH policy and the dedicated deployment shell."
  fi
fi
printf 'MARCOSA_DEPLOY_PREFLIGHT=PASS\n'
