/**
 * R187 two-runner real disposable PostgreSQL17 accept/reject acceptance:
 * - real inherited R186 immutable PG17/quarantine, no real cloud credentials
 * - DNS-pinned HTTPS exercised with fake DNS/network, not external staging
 * - 2 ephemeral Ed25519 keys really sign & verify exact source evidence
 * - 4 expired PG17 synthetic rows deleted under FORCE RLS, 8 retained
 * - one-use SERIALIZABLE NO-GO hold and second native pg_dump/restore
 * - independent no-DB/no-cloud runner rehashes source and all evidence.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR187PinnedHttpsTransport} from './pinned-https.mjs';
import {createR186HttpsPreflight} from '../r186/https-preflight.mjs';
import {createR187TlsProof} from './tls-proof.mjs';
import {createR187DualAttestation,r187AttestationMessage}
 from './dual-attestation.mjs';
import {createR187PrivacyRetention,r187SyntheticRetentionRows}
 from './privacy-retention.mjs';
import {createR187StagingGate} from './staging-gate.mjs';
import {createR187ObservationLedger} from './observation-ledger.mjs';
const env=process.env,REPO='osmanosmanov6880-bot/marcosa-fusion';
const fail=m=>{throw Error('R187 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const FILE='r187-dns-dual-attestation-retention-no-go.json';
ok(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO&&
 H40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'no real AWS, CI OIDC or customer credentials permitted');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R187_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R187_PG_CONTAINER,
  'independent runner must not have PostgreSQL or AWS access');
 const report=JSON.parse(await readFile(join(
  env.RUNNER_TEMP,'r187-second',FILE),'utf8'));
 const keys=['schemaVersion','commit','sourceBundleSha256',
  'r186Report','tlsProof','dualAttestationProof',
  'retentionProof','finalHold','finalHoldEvidenceSha256',
  'realPg17RetentionDeletedFour','realPg17EightActiveRetained',
  'realPg17HoldAndAuditRestored','realPg17ReplayDenied',
  'syntheticDnsAndHttps','syntheticEd25519Identities',
  'realHumanIdentityVerified','realTlsIdentityAttested',
  'realAwsEffectiveRightsVerified','realPrivacyComplianceVerified',
  'realPilotAuthorized','productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===keys&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256,
  'full R187 independent source and report schema');
 const prev=report.r186Report?.assessment;
 const {evidenceSha256:prSha,...pr}=prev||{};
 ok(report.r186Report?.commit===commit&&
  report.r186Report.sourceBundleSha256===bundle.sha256&&
  prev?.sourceMode==='CI_SYNTHETIC'&&
  prev.decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
  prev.realPilotAuthorized===false&&prev.productionAuthorized===false&&
  H64.test(prSha||'')&&sha(pr)===prSha,
  'R186 source-bound immutable predecessor changed');
 const tls=report.tlsProof,{evidenceSha256:tlsSha,...t}=tls||{};
 ok(tls?.sourceCommit===commit&&
  tls.sourceBundleSha256===bundle.sha256&&
  tls.sourceMode==='CI_SYNTHETIC'&&
  tls.readOnlyPinnedRequests===3&&
  tls.acceptedGlobalIpv4Addresses>=1&&
  tls.httpsEvidenceSha256!==undefined&&
  tls.dnssecVerified===false&&
  tls.externalTlsIdentityIndependentlyAttested===false&&
  tls.productionAuthorized===false&&
  H64.test(tlsSha||'')&&sha(t)===tlsSha,
  'independent pinned synthetic HTTPS receipt invalid');
 const dual=report.dualAttestationProof;
 const {evidenceSha256:dualSha,...d}=dual||{};
 ok(dual?.sourceCommit===commit&&dual.bundleSha256===bundle.sha256&&
  dual.githubEvidenceSha256===report.r186Report.githubProof?.evidenceSha256&&
  dual.httpsEvidenceSha256===tls.httpsEvidenceSha256&&
  dual.cryptographicSignaturesValid===true&&
  dual.signers?.length===2&&
  dual.signers[0].role==='PR_REVIEW'&&
  dual.signers[1].role==='SECURITY_REVIEW'&&
  dual.signers[0].publicKeyFingerprintSha256!==
   dual.signers[1].publicKeyFingerprintSha256&&
  dual.independentHumanIdentityEstablished===false&&
  dual.externalKeyRegistryAttested===false&&
  dual.realPilotAuthorized===false&&dual.productionAuthorized===false&&
  H64.test(dualSha||'')&&sha(d)===dualSha,
  'ephemeral synthetic Ed25519 receipts or false identity promotion');
 const retention=report.retentionProof;
 const {evidenceSha256:retSha,...r}=retention||{};
 ok(retention?.sourceCommit===commit&&
  retention.sourceBundleSha256===bundle.sha256&&
  retention.r186EvidenceSha256===prSha&&
  retention.syntheticRowsBefore===12&&
  retention.syntheticExpiredRowsDeleted===4&&
  retention.syntheticActiveRowsRemaining===8&&
  retention.rawCustomerDataProcessed===false&&
  retention.liveRetentionPolicyEnforced===false&&
  retention.realPrivacyComplianceAttested===false&&
  retention.productionAuthorized===false&&
  H64.test(retSha||'')&&sha(r)===retSha,
  'independent source-bound real disposable retention evidence wrong');
 const hold=report.finalHold,{evidenceSha256:hSha,...h}=hold||{};
 ok(hold?.sourceCommit===commit&&
  hold.sourceBundleSha256===bundle.sha256&&
  hold.r186EvidenceSha256===prSha&&
  hold.retentionEvidenceSha256===retSha&&
  hold.dualAttestationEvidenceSha256===dualSha&&
  hold.tlsPinEvidenceSha256===tlsSha&&
  hold.syntheticExpiredRowsDeleted===4&&
  hold.syntheticActiveRowsRemaining===8&&
  hold.verifiedSyntheticSignatures===2&&
  hold.humanIdentitiesIndependentlyVerified===false&&
  hold.tlsIdentityIndependentlyVerified===false&&
  hold.awsEffectiveRightsVerified===false&&
  hold.productionPrivacyVerified===false&&
  hold.realStagingRpoRtoVerified===false&&
  hold.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  hold.realPilotAuthorized===false&&hold.productionAuthorized===false&&
  H64.test(hSha||'')&&sha(h)===hSha&&
  report.finalHoldEvidenceSha256===hSha,
  'independent synthetic R187 immutable final NO-GO evidence altered');
 for(const name of ['realPg17RetentionDeletedFour',
  'realPg17EightActiveRetained','realPg17HoldAndAuditRestored',
  'realPg17ReplayDenied','syntheticDnsAndHttps',
  'syntheticEd25519Identities'])
  ok(report[name]===true,'missing technical CI evidence: '+name);
 for(const name of ['realHumanIdentityVerified','realTlsIdentityAttested',
  'realAwsEffectiveRightsVerified','realPrivacyComplianceVerified',
  'realPilotAuthorized','productionAuthorized'])
  ok(report[name]===false,'synthetic technical CI cannot permit staging GO');
 console.log('R187_SECOND_RUNNER_SOURCE_HASH_AND_NO_GO_RECALCULATED=PASS');
 console.log('R187_REAL_IDENTITIES_TLS_AWS_PRIVACY_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R187_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'exact real disposable PostgreSQL17 container and run required');
 const runId=Number(env.GITHUB_RUN_ID);
 const cmd=(app,args,{input}={})=>{
  const p=spawnSync(app,args,{input,encoding:null,
   timeout:120000,maxBuffer:48*1024*1024});
  ok(!p.error&&p.status===0,'native disposable PG17 command failed');
  return p.stdout;
 };
 const sql=(db,statement)=>cmd('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',statement])
  .toString('utf8').trim();
 const prev=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r186-staging-preflight-no-go-report.json'),'utf8'));
 const prior=prev.assessment;
 ok(prev.schemaVersion===1&&prev.commit===commit&&
  prev.sourceBundleSha256===bundle.sha256&&
  prior?.runId===runId&&prior.sourceCommit===commit&&
  prior.decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
  prior.realPilotAuthorized===false&&prior.productionAuthorized===false&&
  prev.realPg17RestoreRlsAndAudit===true&&
  prev.realPg17ReplayDenied===true&&
  prev.syntheticGithubApiOnly===true&&
  prev.syntheticHttpsTransportOnly===true&&
  prev.realGithubHumanApprovalsVerified===false&&
  prev.realHttpsTlsIndependentlyAttested===false&&
  prev.realAwsEffectiveRightsVerified===false&&
  prev.realPilotAuthorized===false&&prev.productionAuthorized===false,
  'R186 native immutable NO-GO and synthetic provenance prerequisite');
 const clock=()=>Date.now();
 const readHold=async()=>{
  const a=sql('postgres',
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.commit_sha||'|'||h.evidence_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text FROM r186_ci.staging_observation_holds h "+
   "JOIN r186_ci.staging_observation_audit a ON a.id=h.id "+
   "AND a.evidence_sha256=h.evidence_sha256 WHERE h.id=1").split('|');
  ok(a.length===7&&a[4]===prior.evidenceSha256,
   'real native R186 source/audit integrity changed');
  return{runId:Number(a[0]),sequence:Number(a[1]),
   nonce:a[2],sourceCommit:a[3],r186EvidenceSha256:a[4],
   decision:a[5],productionAuthorized:a[6]==='true'};
 };
 const quarantine={status:async()=>{
  const a=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(a.length===2,'native source quarantine not readable');
  return{closed:a[0]==='true',generation:Number(a[1])};
 }};
 const fixtures=r187SyntheticRetentionRows({commit,runId});
 const values=fixtures.map(r=>{
  ok(Number.isSafeInteger(r.ordinal)&&r.ordinal>=1&&r.ordinal<=12&&
   ['PAGE_VIEW','PUBLIC_EVENT','CHECKOUT_INTENT'].includes(r.kind)&&
   H64.test(r.sha256),'bounded synthetic fixture metadata only');
  const expiry=r.expired?
   "statement_timestamp()-interval '48 hours'":
   "statement_timestamp()+interval '48 hours'";
  return '('+r.ordinal+",'"+r.kind+"','"+r.sha256+
   "','"+commit+"',"+runId+','+expiry+')';
 }).join(',');
 const inserted=sql('postgres',
  "WITH written AS (INSERT INTO r187_ci.synthetic_retention("+
  "ordinal,kind,event_sha256,source_commit,run_id,expires_at) VALUES "+
  values+" RETURNING ordinal) SELECT count(*)::text FROM written");
 ok(inserted==='12','real PostgreSQL17 did not persist exactly 12 rows');
 const readRows=async()=>{
  const text=sql('postgres',
   "SELECT ordinal::text||'|'||kind||'|'||event_sha256||'|'||"+
   "(expires_at<statement_timestamp())::text "+
   "FROM r187_ci.synthetic_retention ORDER BY ordinal");
  return text.split(/\r?\n/).filter(Boolean).map(line=>{
   const fields=line.split('|');
   ok(fields.length===4&&H64.test(fields[2]),
    'native PG17 privacy row corrupted');
   return{ordinal:Number(fields[0]),kind:fields[1],
    sha256:fields[2],expired:fields[3]==='true'};
  });
 };
 const roleDelete=query=>{
  const result=sql('postgres',
   "BEGIN;\nSET LOCAL ROLE marcosa_r187_retention_worker;\n"+
   "WITH removed AS (DELETE FROM r187_ci.synthetic_retention "+
   query+" RETURNING ordinal) "+
   "SELECT count(*)::text FROM removed;\nCOMMIT;");
  const rows=result.split(/\r?\n/).map(x=>x.trim())
   .filter(x=>/^\d{1,2}$/.test(x));
  ok(rows.length===1,'bounded PostgreSQL retention SELECT count missing');
  return rows[0];
 };
 ok(roleDelete('WHERE ordinal=5')==='0',
  'FORCE RLS mistakenly permitted active synthetic record deletion');
 const retention=await createR187PrivacyRetention({
  readR186Hold:readHold,quarantine,readRows,
  deleteExpired:async()=>{
   const n=roleDelete('WHERE expires_at < statement_timestamp()');
   return Number(n);
  },clock,allowDisposableWrite:true
 }).inspect({commit,bundleSha256:bundle.sha256,runId});
 ok(retention.syntheticExpiredRowsDeleted===4&&
  retention.syntheticActiveRowsRemaining===8&&
  retention.rawCustomerDataProcessed===false,
  'real PG17 retention purge / R186 NO-GO failed');
 const host='staging.marcosa.example.com';
 let requests=0;
 const fakeTls=(url,options,handler)=>{
  requests++;
  ok(url.startsWith('https://'+host+'/')&&
   options.port===443&&options.servername===host&&
   options.rejectUnauthorized===true&&
   ['GET','HEAD'].includes(options.method)&&
   !options.headers.authorization&&!options.headers.cookie,
   'mock pinned read-only HTTPS must not mutate or expose cookies');
  options.lookup(host,{},(err,ip,family)=>{
   ok(!err&&ip==='93.184.216.34'&&family===4,
    'HTTPS TLS transport used non-pinned DNS');
  });
  const req=new EventEmitter();
  req.destroy=()=>req.emit('error',new Error('blocked'));
  req.end=()=>queueMicrotask(()=>{
   const response=new PassThrough();
   response.statusCode=200;
   response.headers={
    'content-type':'application/json',
    'x-content-type-options':'nosniff',
    'cache-control':'private, no-store',
    'strict-transport-security':'max-age=63072000; includeSubDomains'
   };
   handler(response);
   response.end(options.method==='HEAD'?'':JSON.stringify({
    status:url.endsWith('/health')?'ok':'ready'
   }));
  });
  return req;
 };
 const pinned=createR187PinnedHttpsTransport({
  hostname:host,resolveAddresses:async()=>[
   {address:'93.184.216.34',family:4}
  ],httpsRequest:fakeTls,clock,allowNetwork:true
 });
 await pinned.initialize();
 const pinnedHttps=await createR186HttpsPreflight({
  hostname:host,fetcher:pinned.fetcher,clock,
  sourceMode:'CI_SYNTHETIC',allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256});
 ok(requests===3&&pinnedHttps.healthAndSecurityPassed===true,
  'three source-bound simulated pinned TLS health probes failed');
 const tlsProof=createR187TlsProof({
  transportStatus:pinned.publicStatus(),httpsProof:pinnedHttps,
  commit,bundleSha256:bundle.sha256,runId,clock,
  sourceMode:'CI_SYNTHETIC'
 });
 const keys=[
  {role:'PR_REVIEW',signerId:2002,...generateKeyPairSync('ed25519')},
  {role:'SECURITY_REVIEW',signerId:3003,...generateKeyPairSync('ed25519')}
 ];
 const registry=keys.map(x=>({
  role:x.role,signerId:x.signerId,
  publicKeySpkiBase64:x.publicKey.export({format:'der',type:'spki'})
   .toString('base64')
 }));
 const signedPacket={
  audience:'R187_READONLY_REVIEW_NOT_DEPLOY',
  sourceCommit:commit,bundleSha256:bundle.sha256,
  runId,nonce:digest('r187-review:'+commit+':'+runId).slice(0,32),
  githubEvidenceSha256:prev.githubProof.evidenceSha256,
  httpsEvidenceSha256:tlsProof.httpsEvidenceSha256,
  issuedAtMs:clock()-1000
 };
 const message=r187AttestationMessage(signedPacket);
 const signatures=keys.map(x=>({
  role:x.role,signerId:x.signerId,
  signatureBase64url:sign(null,message,x.privateKey).toString('base64url')
 }));
 const verifier=createR187DualAttestation({
  expectedSigners:registry,clock,allowVerify:true
 });
 const dualProof=verifier.inspect({packet:signedPacket,signatures});
 ok(dualProof.cryptographicSignaturesValid===true&&
  dualProof.independentHumanIdentityEstablished===false,
  'ephemeral CI keys never establish real human reviewer identity');
 const hold=await createR187StagingGate({
  readR186Hold:readHold,quarantine,clock,
  verifyDualAttestation:x=>verifier.inspect(x),allowInspect:true
 }).inspect({commit,bundleSha256:bundle.sha256,r186Report:prev,
  retentionProof:retention,dualAttestationProof:dualProof,
  dualPacket:signedPacket,dualSignatures:signatures,tlsProof});
 ok(hold.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  hold.realPilotAuthorized===false&&hold.productionAuthorized===false,
  'verified ephemeral signatures cannot become a staging GO');
 const ledger=createR187ObservationLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(hold)).recorded===true,
  'native PG17 immutable source-bound NO-GO not written');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r187_ci.observation_holds)::text||'|'||"+
  "(SELECT count(*) FROM r187_ci.observation_audit)::text||'|'||"+
  "(SELECT count(*) FROM r187_ci.synthetic_retention)::text||'|'||"+
  "(SELECT count(*) FROM r186_ci.staging_observation_holds)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r187_ci.observation_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r187_ci.observation_audit'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r187_ci.synthetic_retention'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r187_ci.observation_holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r187_hold_writer','r187_ci.synthetic_retention','DELETE'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r187_retention_worker','r187_ci.observation_holds','INSERT'))::text");
 ok(counts('postgres')==='1|1|8|1'&&
  roles('postgres')==='true|true|true|true|true|true',
  'native PG17 retention, FORCE RLS and source audit counts wrong');
 let duplicate=false;
 try{await createR187ObservationLedger({
  executeSql:async q=>sql('postgres',q)}).record(hold);
 }catch{duplicate=true;}
 ok(duplicate,'R187 native PG17 accepted replay of signed NO-GO');
 const archive=cmd('docker',['exec','-u','postgres',env.R187_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(archive.length>512&&archive.subarray(0,5).toString('utf8')==='PGDMP',
  'native PG17 custom archive absent');
 try{
  sql('postgres','CREATE DATABASE marcosa_r187_restored TEMPLATE template0');
  cmd('docker',['exec','-u','postgres','-i',env.R187_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r187_restored',
   '--no-owner','--exit-on-error'],{input:archive});
 }finally{archive.fill(0);}
 ok(counts('marcosa_r187_restored')==='1|1|8|1'&&
  roles('marcosa_r187_restored')==='true|true|true|true|true|true'&&
  sql('marcosa_r187_restored',
   "SELECT decision FROM r187_ci.observation_holds WHERE id=1")===
    'NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  sql('marcosa_r187_restored',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'native PostgreSQL17 restored privacy, quarantine or NO-GO corrupted');
 duplicate=false;
 try{await createR187ObservationLedger({
  executeSql:async q=>sql('marcosa_r187_restored',q)
 }).record(hold);}catch{duplicate=true;}
 ok(duplicate,'restored PG17 accepted repeated R187 NO-GO');
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r186Report:prev,tlsProof,dualAttestationProof:dualProof,
  retentionProof:retention,finalHold:hold,
  finalHoldEvidenceSha256:hold.evidenceSha256,
  realPg17RetentionDeletedFour:true,
  realPg17EightActiveRetained:true,
  realPg17HoldAndAuditRestored:true,
  realPg17ReplayDenied:true,
  syntheticDnsAndHttps:true,
  syntheticEd25519Identities:true,
  realHumanIdentityVerified:false,
  realTlsIdentityAttested:false,
  realAwsEffectiveRightsVerified:false,
  realPrivacyComplianceVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,FILE),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R187_NATIVE_PG17_RETENTION_RESTORED_FORCE_RLS_NO_GO=PASS');
 console.log('R187_TWO_EPHEMERAL_ED25519_DNS_PINNED_TLS_SIMULATIONS=PASS');
 console.log('R187_REAL_PEOPLE_TLS_AWS_PRIVACY_AND_PRODUCTION=NO_GO');
}
