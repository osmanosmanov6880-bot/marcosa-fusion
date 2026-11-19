/**
 * R163 reproducible, read-only source bundle for independent offline inspection.
 * Not a deployable application container; no network or secrets required.
 * Comparing two isolated CI checkouts proves matching bytes, not reviewer approval.
 */
import {readFile,realpath,lstat,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {O_RDONLY,O_NOFOLLOW} from 'node:constants';
import {createHash,timingSafeEqual} from 'node:crypto';
import {buildR162Evidence,R162_REQUIRED_FILES} from '../r162/release-evidence.mjs';

const REPOSITORY='osmanosmanov6880-bot/marcosa-fusion';
export const R163_REQUIRED_SOURCES=Object.freeze([
 ...R162_REQUIRED_FILES,
 'ops/r162/incident-ledger.mjs',
 'ops/r163/repro-bundle.mjs',
 'ops/r163/review-attestation.mjs',
 'ops/r163/staging-readback.mjs',
 'ops/r163/slo-monitor.mjs',
 'ops/r163/release-gate.mjs',
 'ops/r164/staging-target.mjs',
 'ops/r164/change-quorum.mjs',
 'ops/r164/emergency-rollback.mjs',
 'ops/r164/restore-witness.mjs',
 'ops/r164/operations-audit.mjs',
 'ops/r164/ci-restore.mjs',
 'ops/r164/ci-ops-gate.mjs',
 'ops/r165/durable-quorum.mjs',
 'ops/r165/quarantine-gate.mjs',
 'ops/r165/encrypted-backup.mjs',
 'ops/r165/recovery-verifier.mjs',
 'ops/r165/ci-acceptance.mjs',
 'ops/r166/audit-chain.mjs',
 'ops/r166/signed-anchor.mjs',
 'ops/r166/evidence-vault.mjs',
 'ops/r166/restart-verifier.mjs',
 'ops/r166/ci-stage1.mjs',
 'ops/r166/ci-stage2.mjs',
 'ops/r167/key-envelope.mjs',
 'ops/r167/remote-object.mjs',
 'ops/r167/transfer-manifest.mjs',
 'ops/r167/pg-witness.mjs',
 'ops/r167/ci-source.mjs',
 'ops/r167/ci-target.mjs',
 'ops/r167/ci-remote-https.mjs',
 'ops/r168/aws-kms.mjs',
 'ops/r168/aws-s3.mjs',
 'ops/r168/aws-preflight.mjs',
 'ops/r168/backup-pipeline.mjs',
 'ops/r168/mock-aws.mjs',
 'ops/r168/ci-real-pg.mjs',
 'ops/r168/ci-verify-report.mjs',
 'ops/r169/iam-plan.mjs',
 'ops/r169/aws-runtime.mjs',
 'ops/r169/cloud-posture.mjs',
 'ops/r169/staging-rehearsal.mjs',
 'ops/r169/ci-acceptance.mjs',
 'ops/r169/ci-native-sdk.mjs',
 'ops/r169/ci-verify-report.mjs',
 'ops/r169/package.json',
 'ops/r169/package-lock.json.gz.b64',
 'ops/r170/oidc-sts.mjs',
 'ops/r170/iam-simulator.mjs',
 'ops/r170/s3-retention.mjs',
 'ops/r170/read-only-stage.mjs',
 'ops/r170/ci-acceptance.mjs',
 'ops/r170/package.json',
 'ops/r170/package-lock.json.gz.b64',
 'ops/r171/oidc-provider.mjs',
 'ops/r171/iam-role-audit.mjs',
 'ops/r171/s3-version-audit.mjs',
 'ops/r171/pg-fence.mjs',
 'ops/r171/ci-acceptance.mjs',
 'tests/postgres/174_r171_fence.sql',
 'ops/r172/github-environment.mjs',
 'ops/r172/aws-identity.mjs',
 'ops/r172/replication-audit.mjs',
 'ops/r172/recovery-budget.mjs',
 'ops/r172/ci-acceptance.mjs',
 'ops/r173/offsite-object.mjs',
 'ops/r173/offsite-kms.mjs',
 'ops/r173/offsite-escrow.mjs',
 'ops/r173/offsite-recovery.mjs',
 'ops/r173/ci-acceptance.mjs',
 'ops/r174/destination-kms.mjs',
 'ops/r174/archive-checkpoint.mjs',
 'ops/r174/recovery-admission.mjs',
 'ops/r174/offsite-circuit.mjs',
 'ops/r174/ci-acceptance.mjs',
 'tests/postgres/175_r174_checkpoint.sql',
 'ops/r175/dual-anchor.mjs',
 'ops/r175/anchor-store.mjs',
 'ops/r175/recovery-nonce.mjs',
 'ops/r175/recovery-supervisor.mjs',
 'ops/r175/ci-acceptance.mjs',
 'tests/postgres/176_r175_recovery_nonce.sql'
].slice().sort());
const fail=m=>{throw Error('R163 bundle: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hex=/^[a-f0-9]{64}$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
async function readSecure(root,path){
 // Path is drawn from a hard-coded registry; do not accept caller input.
 ok(R163_REQUIRED_SOURCES.includes(path),'source outside reviewed registry');
 const file=join(root,path);let dir=dirname(file);
 while(dir!==root){
  const st=await lstat(dir);
  ok(st.isDirectory()&&!st.isSymbolicLink(),'symlinked source directory');
  dir=dirname(dir);
 }
 const info=await lstat(file);
 ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&
  info.size>0&&info.size<=262144,'unsafe source type');
 const fd=await open(file,O_RDONLY|O_NOFOLLOW);
 try{
  const st=await fd.stat();
  ok(st.isFile()&&st.dev===info.dev&&st.ino===info.ino&&
   st.size===info.size&&st.nlink===1,'source changed during open');
  const bytes=await fd.readFile();
  ok(bytes.length===st.size,'source changed during read');
  return bytes;
 }finally{await fd.close();}
}
export async function buildR163Bundle({root,commit}={}){
 ok(typeof root==='string'&&resolve(root)===root,'absolute checkout required');
 ok((await realpath(root))===root,'canonical checkout required');
 ok(typeof commit==='string'&&/^[a-f0-9]{40}$/.test(commit),
  'exact full lowercase source commit required');
 const evidence=await buildR162Evidence({root,repo:REPOSITORY,commit,
  files:R163_REQUIRED_SOURCES});
 const parts=[];
 for(const entry of evidence.files){
  const bytes=await readSecure(root,entry.path);
  ok(bytes.length===entry.size&&digest(bytes)===entry.sha256,
   'file changed after checked hash');
  parts.push({path:entry.path,size:entry.size,
   sha256:entry.sha256,base64:bytes.toString('base64')});
 }
 const payload=Object.freeze({
  schemaVersion:1,repository:REPOSITORY,commit,stage:'isolated-staging',
  sourceManifestSha256:evidence.manifestSha256,
  sourceCount:parts.length,sources:parts,productionAuthorized:false
 });
 const bytes=Buffer.from(JSON.stringify(payload)+'\n','utf8');
 ok(bytes.length<1048576,'bounded bundle required');
 return Object.freeze({bytes,sha256:digest(bytes),sourceCount:parts.length,
  sourceManifestSha256:evidence.manifestSha256,productionAuthorized:false});
}
export async function verifyR163Bundle({root,commit,bytes,expectedSha256}={}){
 ok(Buffer.isBuffer(bytes)&&bytes.length>100&&bytes.length<1048576,
  'bounded bundle buffer required');
 ok(typeof expectedSha256==='string'&&hex.test(expectedSha256),
  'full independent expected SHA256 required');
 const actual=digest(bytes);
 ok(timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expectedSha256,'hex')),
  'bundle SHA256 mismatch');
 let payload;
 try{payload=JSON.parse(bytes.toString('utf8'));}
 catch{fail('invalid canonical bundle');}
 ok(payload&&payload.schemaVersion===1&&payload.repository===REPOSITORY&&
  payload.commit===commit&&payload.stage==='isolated-staging'&&
  payload.productionAuthorized===false&&
  payload.sourceCount===R163_REQUIRED_SOURCES.length&&
  Array.isArray(payload.sources)&&payload.sources.length===payload.sourceCount&&
  payload.sources.every((x,i)=>x.path===R163_REQUIRED_SOURCES[i]&&
   Number.isInteger(x.size)&&x.size>0&&x.size<=262144&&hex.test(x.sha256)&&
   typeof x.base64==='string'),'bundle schema or sources invalid');
 const regenerated=await buildR163Bundle({root,commit});
 ok(bytes.equals(regenerated.bytes),'source checkout or canonical bundle differs');
 return Object.freeze({verifiedAgainstCheckout:true,exactSourceBytes:true,
  sha256:actual,commit,sourceCount:payload.sourceCount,
  productionAuthorized:false,reviewerApproved:false});
}
