/** Canonical portable R191 NO-GO bundle for a second credential-free runner.
 * Source, role, TLS, AWS and external registry pin must match. All receipts
 * stay untrusted until independently checked; this never proves live GO. */
import {createHash,timingSafeEqual} from 'node:crypto';
import {H40,H64,plain,requireTrue,sealReceipt,verifyReceipt} from '../r190/common.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function checkReceipts({commit,bundleSha256,github,identities,tls,aws,now}){
 const g=verifyReceipt(github,'R191_PR',commit,bundleSha256);
 const i=verifyReceipt(identities,'R191_IDENTITIES',commit,bundleSha256);
 const t=verifyReceipt(tls,'R191_TLS',commit,bundleSha256);
 const a=verifyReceipt(aws,'R191_AWS',commit,bundleSha256);
 requireTrue(g.reviewPagesComplete===true&&
  i.githubEvidenceSha256===g.evidenceSha256&&
  i.verifiedCryptographicKeys===3&&i.verifiedGithubRoleBindings===3&&
  i.tlsEvidenceSha256===t.evidenceSha256&&
  t.leafHostnameAndValidityVerified===true&&
  t.pinnedPublicIpv4Dns===true&&
  a.source.accountId!==a.offsite.accountId&&
  a.stsSessionAccountAndRoleShapeChecked===true&&
  a.realPermissionsProvenBySimulation===false,
  'cross-source provenance, Ed25519/TLS or AWS evidence mismatch');
 for(const r of [g,i,t,a])
  requireTrue(Number.isSafeInteger(r.observedAtMs)&&
   Number.isSafeInteger(r.expiresAtMs)&&
   r.observedAtMs<=now&&r.expiresAtMs>=now,
   'R191 source receipt expired or from the future');
 return [g,i,t,a];
}
function buildPayload({commit,bundleSha256,github,identities,tls,aws,now}){
 const proofs=checkReceipts({commit,bundleSha256,github,identities,tls,aws,now});
 const blockers=[
  ...(!github.allRequiredReviewEventsObserved?['THREE_LIVE_GITHUB_APPROVALS_MISSING']:[]),
  ...(!github.commitSignatureVerifiedByGithub?['GITHUB_COMMIT_SIGNATURE_NOT_VERIFIED']:[]),
  ...(!aws.all24DangerousActionsDenied?['AWS_SIMULATION_REPORTS_UNEXPECTED_WRITES']:[]),
  'GITHUB_REVIEWER_REAL_IDENTITY_NOT_INDEPENDENTLY_ATTESTED',
  'TLS_PUBLIC_KEY_PIN_OWNER_NOT_VERIFIED',
  'AWS_SCP_KMS_EFFECTIVE_RIGHTS_UNPROVEN',
  'LIVE_STAGING_RESTORE_PRIVACY_LEGAL_APPROVAL_PENDING'
 ];
 return sealReceipt({schemaVersion:1,kind:'R191_BUNDLE',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE_OR_OPERATOR_READONLY_UNATTESTED',
  createdAtMs:now,blockers,
  proofs,
  registryPinSha256:identities.registrySha256,
  evidenceHashes:proofs.map(p=>p.evidenceSha256),
  decision:'NO_GO_EXTERNAL_STAGING_AUTHORITY_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
export function createR191PortableEvidence({
 commit,bundleSha256,github,identities,tls,aws,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','exact source SHA/bundle and clock required');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&now>0,'bounded evidence time required');
 const payload=buildPayload({commit,bundleSha256,github,identities,tls,aws,now});
 const bytes=Buffer.from(JSON.stringify(payload)+'\n','utf8');
 requireTrue(bytes.length>=2000&&bytes.length<=60000,
  'canonical public evidence bytes must be bounded');
 return Object.freeze({bytes,sha256:digest(bytes),payload});
}
export function verifyR191PortableEvidence({
 bytes,expectedFileSha256,commit,bundleSha256,
 expectedRegistrySha256,clock=()=>Date.now(),allowHistoricalCi=false
}={}){
 requireTrue(Buffer.isBuffer(bytes)&&bytes.length>=2000&&bytes.length<=60000&&
  H64.test(expectedFileSha256||'')&&H64.test(expectedRegistrySha256||'')&&
  H40.test(commit||'')&&H64.test(bundleSha256||''),
  'externally pinned public evidence is required');
 const observed=digest(bytes);
 requireTrue(timingSafeEqual(Buffer.from(observed,'hex'),
  Buffer.from(expectedFileSha256,'hex')),'artifact changed between runners');
 let x;
 try{x=JSON.parse(bytes.toString('utf8'));}
 catch{throw Error('R191: invalid portable evidence JSON');}
 requireTrue(plain(x)&&bytes.equals(Buffer.from(JSON.stringify(x)+'\n')),
  'noncanonical bundle refused');
 const signed=verifyReceipt(x,'R191_BUNDLE',commit,bundleSha256);
 requireTrue(signed.registryPinSha256===expectedRegistrySha256&&
  signed.decision==='NO_GO_EXTERNAL_STAGING_AUTHORITY_PENDING'&&
  signed.sourceMode==='CI_FIXTURE_OR_OPERATOR_READONLY_UNATTESTED'&&
  signed.realPilotAuthorized===false&&signed.productionAuthorized===false&&
  Array.isArray(signed.proofs)&&signed.proofs.length===4&&
  signed.evidenceHashes?.length===4&&
  signed.evidenceHashes.every((v,index)=>v===signed.proofs[index].evidenceSha256),
  'portable bundle registry pin, source or NO-GO fields corrupted');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&now>=signed.createdAtMs&&
  now-signed.createdAtMs<3600000,
  'stale replay of portable evidence refused');
 if(!allowHistoricalCi)
  checkReceipts({commit,bundleSha256,github:signed.proofs[0],
   identities:signed.proofs[1],tls:signed.proofs[2],aws:signed.proofs[3],now});
 else{
  requireTrue(signed.proofs.every(r=>r.sourceMode==='CI_FIXTURE')&&
   signed.createdAtMs>0,'historical validation available for CI fixtures only');
  checkReceipts({commit,bundleSha256,github:signed.proofs[0],
   identities:signed.proofs[1],tls:signed.proofs[2],
   aws:signed.proofs[3],now:signed.createdAtMs});
 }
 return Object.freeze({verified:true,decision:signed.decision,
  proofCount:4,sourceCommit:commit,registryPinSha256:signed.registryPinSha256,
  realPilotAuthorized:false,productionAuthorized:false});
}
