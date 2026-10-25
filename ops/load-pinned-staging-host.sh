#!/usr/bin/env bash
# R96: Sourced by GitHub Actions after checkout. The SSH host public key
# and its INDEPENDENTLY CONFIRMED fingerprint are version-controlled.
# The pin was confirmed against the owner's Contabo SSH host-key readout
# and read-only GitHub observation run 40230935394.
# No ssh-keyscan, TOFU or network access is performed by this loader.
set -euo pipefail
: "${DEPLOY_HOST:?Missing staging host}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
if [[ "$DEPLOY_HOST" != "169.58.48.38" || "$DEPLOY_PORT" != "22" ]]; then
  echo "::error::Wrong MARCOSA VPS/SSH port; refusing SSH release" >&2
  return 2
fi
PIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$PWD" != "$PIN_ROOT" ]]; then
  echo "::error::Run from checked-out repository root" >&2
  return 2
fi
export KNOWN_HOSTS
KNOWN_HOSTS="$(cat "$PIN_ROOT/ops/ssh/marcosa-staging-known-hosts")"
export DEPLOY_HOST_FINGERPRINT="SHA256:3VwLDjaMbBL/0AkWPjvaJo0gF1wRk/6g+ZJze+5toZA"
node --input-type=module -e '
  import {verifyStagingHostPin} from "./ops/verify-staging-host-key.mjs";
  const v=verifyStagingHostPin({
    hostname:process.env.DEPLOY_HOST,
    port:Number(process.env.DEPLOY_PORT||22),
    knownHosts:process.env.KNOWN_HOSTS,
    expected:process.env.DEPLOY_HOST_FINGERPRINT
  });
  if(!v.localMatch)throw Error("Not the approved MARCOSA server");
  console.log("R96 PINNED_HOST_KEY=PASS; verified public ED25519 "+v.fingerprint);
'
