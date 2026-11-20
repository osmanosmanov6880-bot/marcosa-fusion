/**
 * R188 portable two-key Ed25519 transcript for an independent offline runner.
 * Can re-check REAL cryptography with zero database / AWS credentials.
 * The two CI private keys are ephemeral: key ownership is NOT a person.
 * The transcript never contains a private key or a deployment authorization.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {createR187DualAttestation} from '../r187/dual-attestation.mjs';
const fail=m=>{throw Error('R188 signed transcript: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const keys=x=>Object.keys(x||{}).sort().join(',');
const checkProof=x=>{
 ok(x&&Object.getPrototypeOf(x)===Object.prototype,'plain JSON receipt required');
 const {evidenceSha256,...rest}=x;
 ok(H64.test(evidenceSha256||'')&&
  timingSafeEqual(Buffer.from(hash(rest),'hex'),
   Buffer.from(evidenceSha256,'hex')),
  'evidence receipt hash invalid');
};
export function createR188SignedTranscript({packet,signatures,publicKeys,
 dualProof,commit,bundleSha256,runId}={}){
 ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  packet?.sourceCommit===commit&&
  packet.bundleSha256===bundleSha256&&packet.runId===runId&&
  dualProof?.sourceCommit===commit&&
  dualProof.bundleSha256===bundleSha256&&dualProof.runId===runId,
  'exact reviewed source and generated R187 signature receipt required');
 checkProof(dualProof);
 ok(Array.isArray(signatures)&&signatures.length===2&&
  Array.isArray(publicKeys)&&publicKeys.length===2,
  'exactly two public keys and signatures must be preserved');
 const verifier=createR187DualAttestation({
  expectedSigners:publicKeys,clock:()=>dualProof.observedAtMs,
  allowVerify:true
 });
 const independentlyVerified=verifier.inspect({packet,signatures});
 const{observedAtMs:ot,evidenceSha256:oh,...original}=dualProof;
 const{observedAtMs:vt,evidenceSha256:vh,...verified}=independentlyVerified;
 ok(JSON.stringify(original)===JSON.stringify(verified)&&
  independentlyVerified.cryptographicSignaturesValid===true&&
  dualProof.independentHumanIdentityEstablished===false&&
  dualProof.externalKeyRegistryAttested===false&&
  dualProof.realPilotAuthorized===false&&
  dualProof.productionAuthorized===false,
  'mismatched signer fingerprints, signed packet or unsupported human identity');
 const record={
  schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
  runId,scope:'ephemeral-ci-ed25519-portable-no-go',
  publicKeys:publicKeys.map(x=>({...x})),
  signatures:signatures.map(x=>({...x})),
  packet:{...packet},dualProof:{...dualProof},
  independentSignatureVerificationPerformed:true,
  independentlyVerifiedHumanIdentity:false,
  externalKeyRegistryVerified:false,stagingDeploymentApproved:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 const evidence={...record,transcriptSha256:hash(record)};
 const serialized=Buffer.from(JSON.stringify(evidence)+'\n','utf8');
 ok(serialized.length>=1024&&serialized.length<=16000,
  'canonical nonsecret transcript size invalid');
 return Object.freeze({transcript:evidence,bytes:serialized,
  fileSha256:createHash('sha256').update(serialized).digest('hex'),
  productionAuthorized:false});
}
export function verifyR188SignedTranscript({bytes,commit,bundleSha256,
 expectedFileSha256}={}){
 ok(Buffer.isBuffer(bytes)&&bytes.length>=1024&&bytes.length<=16000&&
  H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  H64.test(expectedFileSha256||''),
  'canonical transcript and immutable source checksum required');
 const bHash=createHash('sha256').update(bytes).digest('hex');
 ok(timingSafeEqual(Buffer.from(bHash,'hex'),
  Buffer.from(expectedFileSha256,'hex')),
  'portable artifact bytes differ from independently pinned checksum');
 let x;
 try{x=JSON.parse(bytes.toString('utf8'));}
 catch{fail('invalid signed transcript JSON');}
 ok(x&&Object.getPrototypeOf(x)===Object.prototype&&
  keys(x)==='dualProof,externalKeyRegistryVerified,independentSignatureVerificationPerformed,independentlyVerifiedHumanIdentity,packet,productionAuthorized,publicKeys,realPilotAuthorized,runId,schemaVersion,scope,signatures,sourceBundleSha256,sourceCommit,stagingDeploymentApproved,transcriptSha256'&&
  x.schemaVersion===1&&x.sourceCommit===commit&&
  x.sourceBundleSha256===bundleSha256&&
  x.scope==='ephemeral-ci-ed25519-portable-no-go'&&
  x.independentSignatureVerificationPerformed===true&&
  x.independentlyVerifiedHumanIdentity===false&&
  x.externalKeyRegistryVerified===false&&
  x.stagingDeploymentApproved===false&&
  x.realPilotAuthorized===false&&x.productionAuthorized===false&&
  x.packet?.sourceCommit===commit&&x.packet.bundleSha256===bundleSha256&&
  x.packet.runId===x.runId,
  'portable transcript source, scope, NO-GO or fields corrupted');
 const{transcriptSha256,...stable}=x;
 ok(H64.test(transcriptSha256||'')&&
  timingSafeEqual(Buffer.from(hash(stable),'hex'),
   Buffer.from(transcriptSha256,'hex'))&&
  bytes.equals(Buffer.from(JSON.stringify(x)+'\n','utf8')),
  'portable transcript not canonical or integrity proof mismatch');
 checkProof(x.dualProof);
 const verifier=createR187DualAttestation({
  expectedSigners:x.publicKeys,
  clock:()=>x.dualProof.observedAtMs,allowVerify:true
 });
 const actual=verifier.inspect({packet:x.packet,signatures:x.signatures});
 const{observedAtMs:origTime,evidenceSha256:origSha,...orig}=x.dualProof;
 const{observedAtMs:nowTime,evidenceSha256:nowSha,...fresh}=actual;
 ok(JSON.stringify(orig)===JSON.stringify(fresh)&&
  actual.cryptographicSignaturesValid===true,
  'independent runner rejected Ed25519 cryptographic evidence');
 return Object.freeze({verified:true,transcriptSha256,
  sourceCommit:commit,runId:x.runId,
  signerCount:2,realPilotAuthorized:false,productionAuthorized:false});
}
