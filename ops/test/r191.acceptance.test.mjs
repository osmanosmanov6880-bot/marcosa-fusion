import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {inspectR191GithubReviews} from '../r191/review-chronology.mjs';
import {verifyR191PinnedReviewers} from '../r191/trusted-reviewers.mjs';
import {inspectR191TlsCertificate} from '../r191/tls-certificate.mjs';
import {inspectR191AwsDenials} from '../r191/aws-denial-audit.mjs';
import {createR191PortableEvidence,verifyR191PortableEvidence}
 from '../r191/portable-evidence.mjs';
import {buildR191Fixture,reviewFixture,awsFixtureConfig,
 awsFixtureExecutor,createR191PublicCert} from '../r191/ci-fixture.mjs';
import {sealReceipt} from '../r190/common.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const certDer=createR191PublicCert(),now=Date.now(),clock=()=>now;
const source={commit,bundleSha256,clock};
test('R191 GitHub source: reviews, current head and TOCTOU denial',async()=>{
 const {fetchImpl,reviewerIds}=reviewFixture({commit,now});
 const valid=await inspectR191GithubReviews({...source,reviewerIds,
  fetchImpl,allowNetwork:true});
 assert.equal(valid.allRequiredReviewEventsObserved,true);
 assert.equal(valid.commitSignatureVerifiedByGithub,true);
 assert.equal(valid.independentHumanIdentityVerified,false);
 for(const mutation of [
  {changeHead:true},{unapproved:true},{oldReview:true},
  {requestChanges:true},{badAuthor:true}
 ]){
  const{fetchImpl:f,reviewerIds:r}=reviewFixture({commit,now,...mutation});
  const future=inspectR191GithubReviews({...source,reviewerIds:r,
   fetchImpl:f,allowNetwork:true});
  if(mutation.changeHead||mutation.badAuthor)
   await assert.rejects(future,/PR|author|head/);
  else assert.equal((await future).allRequiredReviewEventsObserved,false);
 }
 await assert.rejects(inspectR191GithubReviews({...source,
  reviewerIds,fetchImpl}),/opt-in/);
 await assert.rejects(inspectR191GithubReviews({...source,
  reviewerIds:{...reviewerIds,OPERATIONS:reviewerIds.SECURITY},
  fetchImpl,allowNetwork:true}),/distinct/);
});
test('R191 Ed25519: external SHA, three independent keys, expiry and swapped registry',async()=>{
 const f=await buildR191Fixture({commit,bundleSha256,now,certDer});
 const args={registryBytes:f.registryBytes,expectedRegistrySha256:f.registrySha256,
  github:f.github,packet:f.packet,signatures:f.signatures,
  commit,bundleSha256,clock};
 assert.equal(f.identities.verifiedCryptographicKeys,3);
 assert.equal(f.identities.naturalHumanIdentitiesIndependentlyEstablished,false);
 assert.equal(verifyR191PinnedReviewers(args).evidenceSha256,f.identities.evidenceSha256);
 assert.throws(()=>verifyR191PinnedReviewers({...args,
  expectedRegistrySha256:'f'.repeat(64)}),/external operator pin/);
 assert.throws(()=>verifyR191PinnedReviewers({...args,
  clock:()=>now+86400001}),/expired/);
 const corrupt=f.signatures.map(x=>({...x}));
 corrupt[1].signatureBase64url='A'.repeat(86);
 assert.throws(()=>verifyR191PinnedReviewers({...args,signatures:corrupt}),/signature/);
 const registry=JSON.parse(f.registryBytes.toString('utf8'));
 registry.reviewers[1].githubUserId=registry.reviewers[0].githubUserId;
 const bytes=Buffer.from(JSON.stringify(registry)+'\n');
 assert.throws(()=>verifyR191PinnedReviewers({...args,registryBytes:bytes,
  expectedRegistrySha256:sha(bytes)}),/role|numeric/);
});
test('R191 TLS: X509 hostname, expiry, DNS pin and unauthorized certificate denied',async()=>{
 const cert=new X509Certificate(certDer);
 assert.equal(cert.checkHost('staging.example.com'),'staging.example.com');
 const args={...source,hostname:'staging.example.com',
  expectedLeafFingerprintSha256:sha(certDer),
  resolveAddresses:async()=>[{family:4,address:'8.8.8.8'}],
  dial:async()=>({authorized:true,peerCertificate:{raw:certDer}}),
  allowNetwork:true,sourceMode:'CI_FIXTURE'};
 const actual=await inspectR191TlsCertificate(args);
 assert.equal(actual.leafHostnameAndValidityVerified,true);
 assert.equal(actual.externalHostControlIndependentlyVerified,false);
 await assert.rejects(inspectR191TlsCertificate({...args,
  expectedLeafFingerprintSha256:'f'.repeat(64)}),/fingerprint/);
 await assert.rejects(inspectR191TlsCertificate({...args,
  resolveAddresses:async()=>[{family:4,address:'127.0.0.1'}]}),/DNS/);
 await assert.rejects(inspectR191TlsCertificate({...args,
  dial:async()=>({authorized:false,peerCertificate:{raw:certDer}})}),/chain/);
 await assert.rejects(inspectR191TlsCertificate({...args,
  hostname:'staging.otherdomain.com'}),/leaf certificate/);
});
test('R191 AWS: two STS accounts, 24 deny actions and failures',async()=>{
 const {source:primary,offsite}=awsFixtureConfig();
 const args={...source,source:primary,offsite,allowNetwork:true,
  sourceMode:'CI_FIXTURE'};
 const good=await inspectR191AwsDenials({...args,
  executeAws:awsFixtureExecutor()});
 assert.equal(good.source.destructiveActionsDenied,12);
 assert.equal(good.offsite.destructiveActionsDenied,12);
 assert.equal(good.all24DangerousActionsDenied,true);
 assert.equal(good.realPermissionsProvenBySimulation,false);
 const weak=await inspectR191AwsDenials({...args,
  executeAws:awsFixtureExecutor({allowAction:'s3:DeleteObject'})});
 assert.equal(weak.all24DangerousActionsDenied,false);
 await assert.rejects(inspectR191AwsDenials({...args,
  executeAws:awsFixtureExecutor({foreignCaller:true})}),/role/);
 await assert.rejects(inspectR191AwsDenials({...args,
  executeAws:awsFixtureExecutor({truncate:true})}),/incomplete/);
 await assert.rejects(inspectR191AwsDenials({...args,allowNetwork:false,
  executeAws:awsFixtureExecutor()}),/explicit/);
});
test('R191 cross-source portable bundle: no GO, tamper, source and staleness attacks',async()=>{
 const f=await buildR191Fixture({commit,bundleSha256,now,certDer});
 const p=f.portable;
 assert.equal(p.payload.productionAuthorized,false);
 assert.equal(p.payload.decision,'NO_GO_EXTERNAL_STAGING_AUTHORITY_PENDING');
 const args={bytes:p.bytes,expectedFileSha256:p.sha256,
  expectedRegistrySha256:f.registrySha256,commit,bundleSha256,clock};
 const r=verifyR191PortableEvidence(args);
 assert.equal(r.verified,true);
 assert.equal(r.proofCount,4);
 const altered=Buffer.from(p.bytes);altered[250]^=1;
 assert.throws(()=>verifyR191PortableEvidence({...args,bytes:altered}),/changed/);
 assert.throws(()=>verifyR191PortableEvidence({...args,
  expectedRegistrySha256:'f'.repeat(64)}),/registry pin/);
 assert.throws(()=>verifyR191PortableEvidence({...args,
  clock:()=>now+3600001}),/stale/);
 const {evidenceSha256,...raw}=f.tls;
 const weak=sealReceipt({...raw,leafHostnameAndValidityVerified:false});
 assert.throws(()=>createR191PortableEvidence({...source,github:f.github,
  identities:f.identities,tls:weak,aws:f.aws}),/provenance/);
});
