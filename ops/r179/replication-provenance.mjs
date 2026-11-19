/**
 * R179 source/offsite S3 replication STATUS + bucket policy readback.
 * The earlier R178 full-ciphertext SHA proof is necessary but insufficient:
 * a copied object with matching bytes is not by itself evidence of delivery
 * via configured replication. This module verifies matching metadata and
 * replication status for exact versions in both accounts, fail-closed.
 * CI injected S3 outputs CANNOT prove real external delivery.
 */
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 V=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R179 replication provenance: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function valid(s){return s&&/^\d{12}$/.test(s.accountId||'')&&
 /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(s.bucket||'')&&
 typeof s.client?.send==='function';}
export function createR179ReplicationProvenance({
 source,offsite,commands,clock=()=>Date.now(),
 allowExternalCalls=false
}={}){
 ok(valid(source)&&valid(offsite)&&source.accountId!==offsite.accountId&&
  source.bucket!==offsite.bucket&&source.client!==offsite.client&&
  commands&&typeof commands.GetBucketReplicationCommand==='function'&&
  typeof commands.HeadObjectCommand==='function'&&
  typeof clock==='function',
  'independent AWS source/offsite accounts and strictly read-only SDK required');
 async function get(s,Cmd,input){
  ok(allowExternalCalls===true,'real S3 account audit disabled by default');
  try{return await s.client.send(new Cmd({
   ...input,Bucket:s.bucket,ExpectedBucketOwner:s.accountId
  }),{abortSignal:AbortSignal.timeout(9000)});}
  catch{fail('AWS read-only S3 replication API request failed');}
 }
 async function inspect({r178Proof,commit,bundleSha256,
  historyRootSha256,sha256,sourceVersionId,offsiteVersionId}={}){
  ok(allowExternalCalls===true&&H40.test(commit||'')&&
   [bundleSha256,historyRootSha256,sha256].every(x=>H64.test(x||''))&&
   V.test(sourceVersionId||'')&&V.test(offsiteVersionId||'')&&
   r178Proof?.verified===true&&r178Proof.commit===commit&&
   r178Proof.bundleSha256===bundleSha256&&
   r178Proof.historyRootSha256===historyRootSha256&&
   r178Proof.archiveSha256===sha256&&
   r178Proof.sourceAccountId===source.accountId&&
   r178Proof.offsiteAccountId===offsite.accountId&&
   r178Proof.sourceVersionId===sourceVersionId&&
   r178Proof.offsiteVersionId===offsiteVersionId&&
   r178Proof.bothFullCiphertextSha256Verified===true&&
   r178Proof.productionAuthorized===false,
   'R178 complete source/offsite ciphertext proof missing or changed');
  const key='marcosa/isolated/r178/archive/'+sha256+'.bin';
  const [configuration,src,dst]=await Promise.all([
   get(source,commands.GetBucketReplicationCommand,{}),
   get(source,commands.HeadObjectCommand,{Key:key,VersionId:sourceVersionId}),
   get(offsite,commands.HeadObjectCommand,{Key:key,VersionId:offsiteVersionId})
  ]);
  const rules=configuration?.ReplicationConfiguration;
  const match=rules?.Rules?.[0],destination=match?.Destination;
  ok(rules&&Array.isArray(rules.Rules)&&rules.Rules.length===1&&
   rules.Role==='arn:aws:iam::'+source.accountId+
    ':role/marcosa-staging-cross-account-replication'&&
   match.Status==='Enabled'&&
   match.Filter?.Prefix==='marcosa/isolated/r178/archive/'&&
   match.DeleteMarkerReplication?.Status==='Disabled'&&
   destination?.Bucket==='arn:aws:s3:::'+offsite.bucket&&
   destination.Account===offsite.accountId,
   'S3 replication source, prefix, IAM role or destination drifted');
  const expected=Buffer.from(sha256,'hex').toString('base64');
  for(const [head,version,status] of [
   [src,sourceVersionId,'COMPLETED'],[dst,offsiteVersionId,'REPLICA']
  ]){
   ok(head?.VersionId===version&&head.ReplicationStatus===status&&
    head.ChecksumSHA256===expected&&
    head.Metadata?.['marcosa-commit']===commit&&
    head.Metadata?.['marcosa-bundle-sha256']===bundleSha256&&
    head.Metadata?.['marcosa-history-root-sha256']===historyRootSha256&&
    head.ContentLength===r178Proof.encryptedBytes&&
    head.ObjectLockMode==='COMPLIANCE',
    'S3 version-specific replication state or content metadata not authentic');
  }
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted independent read time');
  const receipt={
   schemaVersion:1,commit,bundleSha256,historyRootSha256,sha256,
   sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
   sourceVersionId,offsiteVersionId,
   sourceReplicationStatus:'COMPLETED',offsiteReplicationStatus:'REPLICA',
   sourceBucket:source.bucket,offsiteBucket:offsite.bucket,
   checkedAtMs:now,expiresAtMs:now+60000,
   statusAndBucketRuleObserved:true,
   independentExternalProviderVerified:false,
   actualCrossAccountDeliveryIndependentlyVerified:false,
   productionAuthorized:false
  };
  return Object.freeze({...receipt,verified:true,
   evidenceSha256:digest(receipt)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,networkEnabled:allowExternalCalls,
  productionAuthorized:false})});
}
export function verifyR179ReplicationProof(p,{commit,bundleSha256,
 historyRootSha256,sourceAccountId,offsiteAccountId,
 clock=()=>Date.now()}={}){
 const {verified,evidenceSha256,...raw}=p||{};
 const now=clock();
 ok(verified===true&&p.schemaVersion===1&&
  p.commit===commit&&p.bundleSha256===bundleSha256&&
  p.historyRootSha256===historyRootSha256&&
  p.sourceAccountId===sourceAccountId&&
  p.offsiteAccountId===offsiteAccountId&&
  sourceAccountId!==offsiteAccountId&&
  p.sourceReplicationStatus==='COMPLETED'&&
  p.offsiteReplicationStatus==='REPLICA'&&
  p.statusAndBucketRuleObserved===true&&
  p.independentExternalProviderVerified===false&&
  p.actualCrossAccountDeliveryIndependentlyVerified===false&&
  p.productionAuthorized===false&&
  Number.isSafeInteger(p.checkedAtMs)&&
  now>=p.checkedAtMs&&now<=p.expiresAtMs&&
  p.expiresAtMs-p.checkedAtMs===60000&&
  H64.test(evidenceSha256||'')&&evidenceSha256===digest(raw),
  'replication status receipt expired, forged or falsely promoted');
 return Object.freeze({verified:true,evidenceSha256,
  productionAuthorized:false});
}
