/**
 * R187 dual Ed25519 attestation verifier for exact source and evidence.
 *
 * TWO distinct explicitly trusted Ed25519 SPKI public keys, TWO roles,
 * TWO separate signatures over domain-separated, short-lived identical
 * source/evidence packet. This provides cryptographic integrity against
 * key substitution/replay, NOT proof of real human identity or AWS rights.
 * No private-key material is accepted or produced here, and no GO path.
 *
 * Operators must independently pin trusted public keys and bind their
 * owners' identity outside this package before manual use.
 */
import {createHash,createPublicKey,verify as verifyEd25519,
 timingSafeEqual} from 'node:crypto';
const fail=m=>{throw Error('R187 attestation: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 NONCE=/^[a-f0-9]{32}$/;
const roles=Object.freeze(['PR_REVIEW','SECURITY_REVIEW']);
const domain='MARCOSA/R187/STAGING-REVIEW-NO-GO/v1\n';
const sha=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);
const fields=x=>Object.keys(x||{}).sort().join(',');
const expectedPacketFields=['audience','bundleSha256',
 'githubEvidenceSha256','httpsEvidenceSha256',
 'issuedAtMs','nonce','runId','sourceCommit'];
const expectedSignerFields=['role','signerId','signatureBase64url'];
const expectedKeyFields=['publicKeySpkiBase64','role','signerId'];
function decode(x,size,name){
 ok(typeof x==='string'&&x.length>0&&x.length<=1024&&
  /^[A-Za-z0-9_-]+$/.test(x),'invalid '+name+' base64url format');
 const b=Buffer.from(x,'base64url');
 ok(b.length===size&&b.toString('base64url')===x,
  'invalid '+name+' canonical encoding/length');
 return b;
}
function trustedPub(x){
 ok(x&&Object.getPrototypeOf(x)===Object.prototype&&
  fields(x)===expectedKeyFields.slice().sort().join(',')&&
  Number.isSafeInteger(x.signerId)&&x.signerId>0&&
  roles.includes(x.role)&&
  typeof x.publicKeySpkiBase64==='string'&&
  /^[A-Za-z0-9+/]+={0,2}$/.test(x.publicKeySpkiBase64)&&
  x.publicKeySpkiBase64.length<=128,
  'reviewer public key, role and identity registry invalid');
 const der=Buffer.from(x.publicKeySpkiBase64,'base64');
 ok(der.length===44&&der.toString('base64')===x.publicKeySpkiBase64,
  'public-key DER must be exact Ed25519 SPKI');
 let key;
 try{key=createPublicKey({key:der,format:'der',type:'spki'});}
 catch{fail('invalid Ed25519 public key');}
 ok(key.asymmetricKeyType==='ed25519'&&
  equal(key.export({format:'der',type:'spki'}),der),
  'non-Ed25519 or noncanonical SPKI key');
 return{key,keyFingerprintSha256:sha(der),role:x.role,signerId:x.signerId};
}
export function r187AttestationMessage(packet){
 ok(packet&&Object.getPrototypeOf(packet)===Object.prototype&&
  fields(packet)===expectedPacketFields.slice().sort().join(',')&&
  packet.audience==='R187_READONLY_REVIEW_NOT_DEPLOY'&&
  H40.test(packet.sourceCommit||'')&&
  [packet.bundleSha256,packet.githubEvidenceSha256,
   packet.httpsEvidenceSha256].every(x=>H64.test(x||''))&&
  NONCE.test(packet.nonce||'')&&
  Number.isSafeInteger(packet.runId)&&packet.runId>=10000&&
  Number.isSafeInteger(packet.issuedAtMs)&&packet.issuedAtMs>0,
  'source-bound read-only review packet malformed');
 return Buffer.from(domain+JSON.stringify(packet),'utf8');
}
export function createR187DualAttestation({
 expectedSigners,clock=()=>Date.now(),allowVerify=false
}={}){
 ok(Array.isArray(expectedSigners)&&expectedSigners.length===2&&
  typeof clock==='function','two distinct pinned signer registry keys required');
 const [first,second]=expectedSigners.map(trustedPub);
 ok(first.role!==second.role&&
  first.signerId!==second.signerId&&
  first.keyFingerprintSha256!==second.keyFingerprintSha256&&
  roles.every(r=>[first.role,second.role].includes(r)),
  'review and security must be distinct keys and signer identities');
 const registry=new Map([[first.role,first],[second.role,second]]);
 function inspect({packet,signatures}={}){
  ok(allowVerify===true,'two-person review check not explicitly enabled');
  const bytes=r187AttestationMessage(packet);
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>=packet.issuedAtMs&&
   now-packet.issuedAtMs<=60000,
   'stale/future source review or expired anti-replay challenge');
  ok(Array.isArray(signatures)&&signatures.length===2,
   'both independent signatures required');
  const seen=new Set(),verified=[];
  for(const row of signatures){
   ok(row&&Object.getPrototypeOf(row)===Object.prototype&&
    fields(row)===expectedSignerFields.slice().sort().join(',')&&
    roles.includes(row.role)&&!seen.has(row.role),
    'duplicated or unknown reviewer role');
   seen.add(row.role);
   const trust=registry.get(row.role);
   ok(trust&&row.signerId===trust.signerId,
    'wrong pre-pinned signer id or role substitution');
   const signature=decode(row.signatureBase64url,64,'signature');
   ok(verifyEd25519(null,bytes,trust.key,signature)===true,
    'Ed25519 source-bound signature rejected');
   verified.push({role:row.role,
    signerId:row.signerId,
    publicKeyFingerprintSha256:trust.keyFingerprintSha256});
  }
  verified.sort((a,b)=>roles.indexOf(a.role)-roles.indexOf(b.role));
  const evidence={
   schemaVersion:1,scope:'two-distinct-ed25519-keys-no-go',
   sourceCommit:packet.sourceCommit,bundleSha256:packet.bundleSha256,
   githubEvidenceSha256:packet.githubEvidenceSha256,
   httpsEvidenceSha256:packet.httpsEvidenceSha256,
   runId:packet.runId,nonce:packet.nonce,
   challengeSha256:sha(bytes),signers:verified,
   cryptographicSignaturesValid:true,
   independentHumanIdentityEstablished:false,
   githubEnvironmentAuthorizationVerified:false,
   externalKeyRegistryAttested:false,
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:now,
   decision:'NO_GO_MANUAL_IDENTITY_ATTESTATION_PENDING'
  };
  return Object.freeze({...evidence,evidenceSha256:
   sha(Buffer.from(JSON.stringify(evidence)))});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowVerify,requiresTwoDistinctKeys:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
