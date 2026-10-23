#!/usr/bin/env bash
# One-time *local VPS console* setup for the restricted MARCOSA staging account.
# Run only as root on a VPS you independently confirmed is intended for MARCOSA.
# Usage: bash scripts/bootstrap-staging.sh /root/marcosa_staging.pub
# No SSH daemon, production webroots, Docker, DNS, Nginx or users other than
# marcosa-deploy are modified. No private key is ever accepted or stored.
set -Eeuo pipefail
umask 077

fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == "0" ]] || fail "Run as root in the VPS console."
[[ "$#" -eq 1 && -f "$1" && ! -L "$1" ]] || fail "Supply the existing staging PUBLIC key as a regular file."
PUB_FILE="$1"
[[ "$(wc -c < "$PUB_FILE")" -lt 3000 ]] || fail "Unexpectedly long public-key file."
PUB="$(tr -d '\r' < "$PUB_FILE" | sed '/^[[:space:]]*$/d')"
[[ "$(printf '%s\n' "$PUB" | wc -l)" -eq 1 ]] || fail "Use one complete public key line."
[[ "$PUB" == ssh-ed25519\ * ]] || fail "Expected an ssh-ed25519 public key (not private key)."
ssh-keygen -lf "$PUB_FILE" >/dev/null 2>&1 || fail "OpenSSH cannot parse the supplied public key."

USER="marcosa-deploy"
ROOT="/home/$USER/marcosa-staging"
if ! id "$USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$USER"
fi
HOME_DIR="$(getent passwd "$USER" | cut -d: -f6)"
[[ "$HOME_DIR" == "/home/$USER" ]] || fail "Unexpected existing deploy account home directory: $HOME_DIR"

for privileged_group in sudo docker adm root lxd; do
  if id -nG "$USER" | tr ' ' '\n' | grep -Fxq "$privileged_group"; then
    fail "Deploy user is in privileged group '$privileged_group'. Remove elevated permissions before using this account."
  fi
done

for path in "$HOME_DIR" "$HOME_DIR/.ssh" "$HOME_DIR/.ssh/authorized_keys" "$ROOT" "$ROOT/incoming" "$ROOT/releases" "$ROOT/.staging-approved"; do
  [[ ! -L "$path" ]] || fail "Refusing a symlink in staging path: $path"
done

install -d -m 700 -o "$USER" -g "$USER" "$HOME_DIR/.ssh"
KEYS="$HOME_DIR/.ssh/authorized_keys"
if [[ ! -e "$KEYS" ]]; then
  install -m 600 -o "$USER" -g "$USER" /dev/null "$KEYS"
fi
[[ -f "$KEYS" ]] || fail "Authorized keys must be a regular file."
chown "$USER:$USER" "$KEYS"
chmod 600 "$KEYS"
if ! grep -Fxq -- "$PUB" "$KEYS"; then
  printf '%s\n' "$PUB" >> "$KEYS"
fi

install -d -m 750 -o "$USER" -g "$USER" "$ROOT"
install -d -m 750 -o "$USER" -g "$USER" "$ROOT/incoming" "$ROOT/releases"
MARKER="$ROOT/.staging-approved"
if [[ -e "$MARKER" ]]; then
  [[ -f "$MARKER" && "$(tr -d '\r\n' < "$MARKER")" == "MARCOSA-STAGING-APPROVED-v1" ]] ||
    fail "An existing approval marker is invalid; refuse to overwrite it."
else
  printf 'MARCOSA-STAGING-APPROVED-v1\n' > "$MARKER"
fi
chown "$USER:$USER" "$MARKER"
chmod 600 "$MARKER"

printf 'STAGING_BOOTSTRAP=OK\n'
printf 'DEPLOY_USER=%s\n' "$USER"
printf 'STAGING_ROOT=%s\n' "$ROOT"
printf 'PUBLIC_KEY_FINGERPRINT='
ssh-keygen -lf "$PUB_FILE" | awk '{print $2}'
echo 'No production services, reverse proxy configuration, databases or Docker containers were changed.'
