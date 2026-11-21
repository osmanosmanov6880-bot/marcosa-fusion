/**
 * R164 immutable, zero-secret staging target binding. No DNS queries, DB,
 * SSH, Docker, deployment or network action is performed by this module.
 * A matching digest is not proof of domain/project ownership.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const REPOSITORY='osmanosmanov6880-bot/marcosa-fusion';
const fields=['schemaVersion','repository','stage','commit','bundleSha256',
 'projectRef','stagingOrigin','databaseHost','dbCaSha256','tlsSpkiSha256',
 'secretConfigFingerprint','listenHost','synthetic','automatedDeploy',
 'externalDelivery','paymentsEnabled','payoutsEnabled'].sort();
const HEX64=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const fail=s=>{throw Error('R164 target: '+s);};
const ensure=(v,msg)=>{if(!v)fail(msg);};
const canonical=s=>Buffer.from(JSON.stringify({
 schemaVersion:1,repository:REPOSITORY,stage:'isolated-staging',
 commit:s.commit,bundleSha256:s.bundleSha256,projectRef:s.projectRef,
 stagingOrigin:s.stagingOrigin,databaseHost:s.databaseHost,
 dbCaSha256:s.dbCaSha256,tlsSpkiSha256:s.tlsSpkiSha256,
 secretConfigFingerprint:s.secretConfigFingerprint,
 listenHost:'127.0.0.1',synthetic:s.synthetic,
 automatedDeploy:false,externalDelivery:false,paymentsEnabled:false,
 payoutsEnabled:false
}));
export function createR164StagingTarget(input){
 ensure(input&&Object.getPrototypeOf(input)===Object.prototype&&
  Object.keys(input).sort().join(',')===fields.join(','),
  'exact nonsecret descriptor required');
 const x=input;
 ensure(x.schemaVersion===1&&x.repository===REPOSITORY&&
  x.stage==='isolated-staging'&&SHA.test(x.commit||'')&&
  HEX64.test(x.bundleSha256||''),'pinned source SHA and stage required');
 ensure(typeof x.projectRef==='string'&&/^[a-z0-9]{20,32}$/.test(x.projectRef),
  'pinned Supabase project ref required');
 ensure(typeof x.stagingOrigin==='string'&&x.stagingOrigin.length<240,
  'bounded staging origin required');
 let u;
 try{u=new URL(x.stagingOrigin);}catch{fail('invalid HTTPS origin');}
 ensure(u.protocol==='https:'&&u.origin===x.stagingOrigin&&
  u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&!u.port,
  'exact HTTPS origin with no alternate port/path required');
 const host=u.hostname;
 ensure(/^[a-z0-9][a-z0-9.-]{5,190}$/.test(host)&&
  !host.includes('..')&&!/^(?:localhost|127\.|10\.|0\.|192\.168\.|169\.254\.)/.test(host)&&
  /^(?:stage|staging|preview)[.-]/.test(host),
  'explicit staging-only public DNS name required');
 ensure(typeof x.databaseHost==='string'&&
  /^[a-z0-9][a-z0-9.-]{5,190}$/.test(x.databaseHost)&&
  !x.databaseHost.includes('..')&&x.databaseHost!==host&&
  !/^(?:localhost|127\.|10\.|0\.|192\.168\.|169\.254\.)/.test(x.databaseHost),
  'separate pinned remote database name required');
 ensure(HEX64.test(x.dbCaSha256||'')&&HEX64.test(x.tlsSpkiSha256||'')&&
  typeof x.secretConfigFingerprint==='string'&&
  /^[a-f0-9]{20}$/.test(x.secretConfigFingerprint),
  'pinned X509 and sealed-config fingerprint required');
 ensure(x.listenHost==='127.0.0.1'&&typeof x.synthetic==='boolean'&&
  x.automatedDeploy===false&&x.externalDelivery===false&&
  x.paymentsEnabled===false&&x.payoutsEnabled===false,
  'loopback/no-commercial-side-effects enforced');
 if(x.synthetic)ensure(host.endsWith('.example.invalid')&&
  x.databaseHost.endsWith('.example.invalid'),
  'synthetic fixtures must use invalid DNS names');
 else ensure(!host.endsWith('.example.invalid')&&
  !x.databaseHost.endsWith('.example.invalid'),
  'real staging must have non-fixture DNS identifiers');
 const bytes=canonical(x);
 const digest=createHash('sha256').update(bytes).digest('hex');
 return Object.freeze({schemaVersion:1,commit:x.commit,
  bundleSha256:x.bundleSha256,projectRef:x.projectRef,
  origin:x.stagingOrigin,databaseHost:x.databaseHost,
  digest,synthetic:x.synthetic,productionAuthorized:false,
  externalDeploymentVerified:false,liveSupabaseConnected:false,
  approvedForOperatorReview:false});
}
export function verifyR164StagingTarget(input,{commit,bundleSha256,
 secretConfigFingerprint,digest}={}){
 const proof=createR164StagingTarget(input);
 ensure(proof.commit===commit&&proof.bundleSha256===bundleSha256&&
  secretConfigFingerprint===input.secretConfigFingerprint,
  'source or sealed configuration changed');
 ensure(typeof digest==='string'&&HEX64.test(digest)&&
  timingSafeEqual(Buffer.from(proof.digest,'hex'),Buffer.from(digest,'hex')),
  'target descriptor was modified');
 return Object.freeze({...proof,verifiedAgainstExpectedIdentity:true,
  productionAuthorized:false});
}
