#!/usr/bin/env bash
# R99: Continuous delivery of *only* audited static preview bytes to non-root VPS STAGING.
# Runs AFTER the build job from this exact main commit. Never writes /opt/marcosa
# and never alters live Nginx / production domain. Host pin is independently verified.
set -euo pipefail
[[ "${GITHUB_REPOSITORY:-}" == "osmanosmanov6880-bot/marcosa-fusion" ]] || {
  echo "::error::Not the approved MARCOSA source repo"; exit 2;
}
[[ "${GITHUB_REF:-}" == "refs/heads/main" ]] || { echo "::error::Not trusted main"; exit 2; }
case "${GITHUB_EVENT_NAME:-}" in
 push) [[ -z "${APPROVAL:-}" ]] || exit 2 ;;
 workflow_dispatch) [[ "${APPROVAL:-}" == "DEPLOY-MARCOSA-STAGING" ]] || exit 2 ;;
 *) echo "::error::Untrusted event"; exit 2 ;;
esac
[[ "${DEPLOY_HOST:-}" == "169.58.48.38" ]] || exit 2
[[ "${DEPLOY_USER:-}" == "marcosa-deploy" ]] || exit 2
set -euo pipefail
source ops/load-pinned-staging-host.sh
[[ "$DEPLOY_USER" == "marcosa-deploy" ]] || exit 2
: "${DEPLOY_KEY:?Missing SSH-only restricted deployment key}"
SOURCE_SHA="${GITHUB_SHA:?Missing trusted main commit SHA}"
# Both the archive and expected manifest must originate from this SAME successful build job.
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ -s "staging-expected-$SOURCE_SHA.json" && -s marcosa-site.tar.gz && -s marcosa-site.tar.gz.sha256 ]] || exit 2
sha256sum -c marcosa-site.tar.gz.sha256
test "$(stat -c '%s' marcosa-site.tar.gz)" -lt 200000000
EXPECTED_MANIFEST_SHA256="$(node -p "JSON.parse(require('node:fs').readFileSync('staging-expected-${SOURCE_SHA}.json','utf8')).buildManifestSha256")"
node --input-type=module - <<'NODE'
import {readFileSync} from 'node:fs';
const sha=process.env.GITHUB_SHA;
const att=JSON.parse(readFileSync('staging-expected-'+sha+'.json','utf8'));
if(att.format!=='MARCOSA-STAGING-READBACK-v1' || att.sourceSha!==sha ||
   att.productionAuthorized!==false || att.releaseKind!=='public_static_preview_only' ||
   !Number.isInteger(att.assetsCount) || att.assetsCount<3 ||
   !/^[a-f0-9]{64}$/.test(att.buildManifestSha256||'')) {
  throw Error('Invalid trusted same-run staging build attestation');
}
console.log('TRUSTED_SAME_RUN_BUILD=PASS '+sha);
NODE
[[ "$EXPECTED_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 2
umask 077
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$TMP/key"
printf '%s\n' "$KNOWN_HOSTS" > "$TMP/known_hosts"
chmod 600 "$TMP/key" "$TMP/known_hosts"
FP="$(ssh-keygen -y -P '' -f "$TMP/key" | ssh-keygen -lf - -E sha256 | awk '{print $2}')"
[[ "$FP" == "$EXPECTED_DEPLOY_KEY_FP" ]] || { echo "::error::Wrong SSH deploy key"; exit 2; }
node ops/verify-staging-host-key.mjs --hostname "$DEPLOY_HOST" --port "$DEPLOY_PORT" --known-hosts "$TMP/known_hosts" --expected "$DEPLOY_HOST_FINGERPRINT"
export DEPLOY_HOST DEPLOY_USER DEPLOY_KEY DEPLOY_PORT DEPLOY_HOST_FINGERPRINT KNOWN_HOSTS EXPECTED_STAGING_HOST=169.58.48.38 EXPECTED_DEPLOY_KEY_FP
bash scripts/diagnose-staging-ssh.sh
SSH_ARGS=(-i "$TMP/key" -p "$DEPLOY_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$TMP/known_hosts" -o BatchMode=yes -o ConnectTimeout=12)
SCP_ARGS=(-i "$TMP/key" -P "$DEPLOY_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$TMP/known_hosts" -o BatchMode=yes -o ConnectTimeout=12)
scp "${SCP_ARGS[@]}" marcosa-site.tar.gz "$DEPLOY_USER@$DEPLOY_HOST:marcosa-staging/incoming/$SOURCE_SHA.tar.gz"
DIGEST="$(sha256sum marcosa-site.tar.gz | awk '{print $1}')"
ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "bash -s -- $SOURCE_SHA $DIGEST" < scripts/activate-staging.sh
if ! ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "bash -s -- $SOURCE_SHA $EXPECTED_MANIFEST_SHA256" <<'REMOTE'
set -euo pipefail
SHA="$1"
MANIFEST_SHA="$2"
ROOT="$HOME/marcosa-staging"
[[ "$(id -un)" == "marcosa-deploy" ]] || exit 2
[[ "$(readlink "$ROOT/current")" == "releases/$SHA" ]] || exit 2
python3 - "$ROOT/current" "$SHA" "$MANIFEST_SHA" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
sha=sys.argv[2]
expected=sys.argv[3]
manifest_bytes=(root/"build-manifest.json").read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest()==expected,"Trusted manifest SHA mismatch"
proof=json.loads((root/"staging-release.json").read_text("utf8"))
manifest=json.loads(manifest_bytes)
assert proof["sourceSha"]==sha
assert proof["buildManifestSha256"]==expected
assert proof["productionAuthorized"] is False
assert proof["releaseKind"]=="public_static_preview_only"
assert manifest["release_kind"]=="public_static_preview_only"
files=manifest["files"]
assert isinstance(files,dict) and len(files)==proof["assetsCount"] and 3<=len(files)<=5000
for asset,digest in files.items():
    assert isinstance(asset,str) and ".." not in asset and not asset.startswith("/") and "\\" not in asset
    path=root/asset
    assert path.is_file() and not path.is_symlink(),asset
    assert hashlib.sha256(path.read_bytes()).hexdigest()==digest,asset
print("SSH_STAGING_ASSETS_VERIFIED="+str(len(files)))
print("SSH_STAGING_BYTES_VERIFIED=PASS")
print("SOURCE_SHA="+sha)
PY
echo "SSH_STAGING_CURRENT=$ROOT/current"
echo "PUBLIC_HTTPS_VERIFIED=NO"
echo "PRODUCTION_UNCHANGED=YES"
REMOTE
then
  echo "::error::SSH staging post-activation verification failed; attempting restricted staging rollback"
  ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" 'bash -s' < scripts/rollback-staging.sh || true
  exit 1
fi
{
  echo "### MARCOSA automatic SSH-only staging"
  echo "- SSH filesystem upload and source-pinned digest: PASS"
  echo "- VPS: 169.58.48.38, user marcosa-deploy"
  echo "- Isolated path: /home/marcosa-deploy/marcosa-staging/current"
  echo "- Source commit: \`$SOURCE_SHA\`"
  echo "- Public HTTPS: NOT VERIFIED; production marcosa.club unchanged"
} >> "$GITHUB_STEP_SUMMARY"
