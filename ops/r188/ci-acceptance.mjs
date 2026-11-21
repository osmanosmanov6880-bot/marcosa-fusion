/** R188 actual disposable PG17 plus independent cryptographic transcript. */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {r187AttestationMessage,createR187DualAttestation}
 from '../r187/dual-attestation.mjs';
import {createR188SignedTranscript,verifyR188SignedTranscript}
 from './signed-transcript.mjs';
import {createR188RetentionIntegrity} from './retention-integrity.mjs';
import {createR188StagingGate} from './staging-gate.mjs';
import {createR188ObservationLedger} from './observation-ledger.mjs';
const e=process.env;
const fail=m=>{throw Error('R188 native CI: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>sha(Buffer.from(JSON.stringify(x)));
const A='r188-signed-retention-no-go-report.json';
const T='r188-public-ed25519-transcript.json';
const H=/^[a-f0-9]{64}$/;
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'no provider/OIDC secrets in CI');
const commit=e.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(e.R188_SECOND_RUNNER==='true'){
 ok(!e.PGHOST&&!e.PGPASSWORD&&!e.R188_PG_CONTAINER,
  'independent verifier must have no database credentials');
 const dir=join(e.RUNNER_TEMP,'r188-second');
 const r=JSON.parse(await readFile(join(dir,A),'utf8'));
 ok(r.commit===commit&&r.sourceBundleSha256===bundle.sha256&&
  r.productionAuthorized===false&&r.realPilotAuthorized===false&&
  r.realHumanIdentityVerified===false&&
  r.realAwsEffectiveRightsVerified===false&&
  r.realPrivacyComplianceVerified===false&&
  r.nativePostgres17DualReadback===true&&
  r.nativePostgres17RestoreAndReplayDenied===true&&
  r.ephemeralSignerKeysOnly===true,
  'separate runner rejects actual staging/production attestation claims');
 const prior=r.r187Report.finalHold;
 const{evidenceSha256:priorSha,...priorRaw}=prior;
 ok(H.test(priorSha)&&hash(priorRaw)===priorSha&&
  prior.sourceCommit===commit&&
  prior.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  prior.productionAuthorized===false,
  'R187 native ancestor is tampered');
 const retention=r.retentionProof;
 const{evidenceSha256:retSha,...retRaw}=retention;
 ok(H.test(retSha)&&hash(retRaw)===retSha&&
  retention.r187EvidenceSha256===priorSha&&
  retention.sourceRows===8&&retention.restoredRows===8&&
  retention.expiredRowsMissing===4&&
  retention.nativeForceRlsOnBothCopies===true&&
  retention.publicSelectDeniedOnBothCopies===true&&
  retention.realRetentionComplianceVerified===false,
  'native PG17 retention full row check invalid');
 const bytes=await readFile(join(dir,T));
 const verified=verifyR188SignedTranscript({
  bytes,commit,bundleSha256:bundle.sha256,
  expectedFileSha256:r.transcriptFileSha256});
 const transcript=JSON.parse(bytes.toString('utf8'));
 ok(verified.verified===true&&verified.signerCount===2&&
  transcript.transcriptSha256===r.transcriptSha256&&
  transcript.packet.githubEvidenceSha256===
   r.r187Report.r186Report.githubProof.evidenceSha256&&
  transcript.packet.httpsEvidenceSha256===
   r.r187Report.tlsProof.httpsEvidenceSha256,
  'independent real Ed25519 verification or source binding failed');
 const hold=r.finalHold,{evidenceSha256:hSha,...raw}=hold;
 ok(H.test(hSha)&&hash(raw)===hSha&&r.holdEvidenceSha256===hSha&&
  hold.sourceCommit===commit&&
  hold.r187EvidenceSha256===priorSha&&
  hold.retentionEvidenceSha256===retSha&&
  hold.transcriptSha256===r.transcriptSha256&&
  hold.transcriptFileSha256===r.transcriptFileSha256&&
  hold.decision==='NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING'&&
  hold.productionAuthorized===false&&hold.realPilotAuthorized===false,
  'final signed NO-GO hash chain mismatched');
 console.log('R188_SECOND_RUNNER_INDEPENDENT_ED25519_AND_PG17_SHA=PASS');
 console.log('R188_REAL_STAGING_HUMANS_AWS_PRIVACY_RPO_RTO=NO_GO');
}else{
 ok(e.PGHOST==='127.0.0.1'&&e.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(e.R188_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(e.GITHUB_RUN_ID||''),
  'isolated native PostgreSQL17 mandatory');
 const runId=Number(e.GITHUB_RUN_ID),clock=()=>Date.now();
 const command=(app,args,{input}={})=>{
  const res=spawnSync(app,args,{input,encoding:null,
   timeout:120000,maxBuffer:48*1024*1024});
  ok(!res.error&&res.status===0,'native PG17 command failed');
  return res.stdout;
 };
 const sql=(db,q)=>command('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const r187Report=JSON.parse(await readFile(join(e.RUNNER_TEMP,
  'r187-dns-dual-attestation-retention-no-go.json'),'utf8'));
 const ancestor=r187Report.finalHold;
 ok(r187Report.commit===commit&&r187Report.sourceBundleSha256===bundle.sha256&&
  ancestor.runId===runId&&
  ancestor.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  r187Report.realPg17HoldAndAuditRestored===true&&
  r187Report.realPg17ReplayDenied===true&&
  r187Report.syntheticEd25519Identities===true&&
  r187Report.realHumanIdentityVerified===false&&
  r187Report.productionAuthorized===false,
  'R187 native source and synthetic-only provenance required');
 const holdRead=async db=>{
  ok(['postgres','marcosa_r187_restored'].includes(db),
   'only two disposable PG databases may be read');
  const row=sql(db,
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.source_commit||'|'||h.evidence_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text FROM r187_ci.observation_holds h "+
   "JOIN r187_ci.observation_audit a ON a.id=h.id "+
   "AND a.evidence_sha256=h.evidence_sha256 WHERE h.id=1").split('|');
  ok(row.length===7&&row[4]===ancestor.evidenceSha256,
   'real R187 row/audit missing');
  return{runId:Number(row[0]),sequence:Number(row[1]),nonce:row[2],
   sourceCommit:row[3],r187EvidenceSha256:row[4],
   decision:row[5],productionAuthorized:row[6]==='true'};
 };
 const quarantine={status:async()=>{
  const row=sql('postgres',
   "SELECT closed::text||'|'||generation::text FROM "+
   "r167_ci.r167_quarantine WHERE id=1").split('|');
  return{closed:row[0]==='true',generation:Number(row[1])};
 }};
 const readRows=async db=>{
  ok(['postgres','marcosa_r187_restored'].includes(db),
   'only disposable PG17 row sets allowed');
  const text=sql(db,
   "SELECT ordinal::text||'|'||kind||'|'||event_sha256||'|'||"+
   "(expires_at<statement_timestamp())::text "+
   "FROM r187_ci.synthetic_retention ORDER BY ordinal");
  return text.split(/\r?\n/).filter(Boolean).map(line=>{
   const p=line.split('|');
   ok(p.length===4&&H.test(p[2]),'native privacy row corrupted');
   return{ordinal:Number(p[0]),kind:p[1],
    sha256:p[2],expired:p[3]==='true'};
  });
 };
 const rls=async db=>{
  const p=sql(db,
   "SELECT (relrowsecurity AND relforcerowsecurity)::text||'|'||"+
   "has_table_privilege('authenticated',"+
   "'r187_ci.synthetic_retention','SELECT')::text "+
   "FROM pg_class WHERE oid='r187_ci.synthetic_retention'::regclass")
   .split('|');
  return{forced:p[0]==='true',publicSelect:p[1]==='true'};
 };
 const retention=await createR188RetentionIntegrity({
  readR187Hold:holdRead,readRows,readRlsState:rls,
  readQuarantine:quarantine.status,clock,allowInspect:true
 }).inspect({commit,bundleSha256:bundle.sha256,runId,
  r187Proof:r187Report.retentionProof});
 const keys=[
  {role:'PR_REVIEW',signerId:2002,...generateKeyPairSync('ed25519')},
  {role:'SECURITY_REVIEW',signerId:3003,...generateKeyPairSync('ed25519')}
 ];
 const publicKeys=keys.map(k=>({
  role:k.role,signerId:k.signerId,
  publicKeySpkiBase64:k.publicKey.export({
   format:'der',type:'spki'}).toString('base64')
 }));
 const packet={
  audience:'R187_READONLY_REVIEW_NOT_DEPLOY',sourceCommit:commit,
  bundleSha256:bundle.sha256,runId,
  nonce:sha(Buffer.from('r188:'+commit+':'+runId)).slice(0,32),
  githubEvidenceSha256:r187Report.r186Report.githubProof.evidenceSha256,
  httpsEvidenceSha256:r187Report.tlsProof.httpsEvidenceSha256,
  issuedAtMs:clock()-1000
 };
 const msg=r187AttestationMessage(packet);
 const signatures=keys.map(k=>({
  role:k.role,signerId:k.signerId,
  signatureBase64url:sign(null,msg,k.privateKey).toString('base64url')
 }));
 const dualProof=createR187DualAttestation({
  expectedSigners:publicKeys,clock,allowVerify:true
 }).inspect({packet,signatures});
 const transcript=createR188SignedTranscript({packet,signatures,
  publicKeys,dualProof,commit,bundleSha256:bundle.sha256,runId});
 const hold=await createR188StagingGate({
  readR187Hold:()=>holdRead('postgres'),quarantine,clock,allowInspect:true
 }).inspect({commit,bundleSha256:bundle.sha256,
  r187Report,retentionProof:retention,
  transcriptBytes:transcript.bytes,
  transcriptFileSha256:transcript.fileSha256});
 const ledger=createR188ObservationLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(hold)).recorded===true,
  'native signed NO-GO append/audit rejected');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r188_ci.attested_holds)::text||'|'||"+
  "(SELECT count(*) FROM r188_ci.attested_audit)::text||'|'||"+
  "(SELECT count(*) FROM r187_ci.synthetic_retention)::text");
 const flags=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r188_ci.attested_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r188_ci.attested_audit'::regclass)::text");
 ok(counts('postgres')==='1|1|8'&&flags('postgres')==='true|true',
  'native PG17 R188 audit/retention/RLS mismatch');
 let replay=false;
 try{await ledger.record(hold);}catch{replay=true;}
 ok(replay,'native PG17 allowed replay');
 const archive=command('docker',['exec','-u','postgres',e.R188_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(archive.length>=512&&archive.subarray(0,5).toString('utf8')==='PGDMP',
  'native PG17 archive missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r188_restored TEMPLATE template0');
  command('docker',['exec','-u','postgres','-i',e.R188_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r188_restored',
   '--no-owner','--exit-on-error'],{input:archive});
 }finally{archive.fill(0);}
 ok(counts('marcosa_r188_restored')==='1|1|8'&&
  flags('marcosa_r188_restored')==='true|true'&&
  sql('marcosa_r188_restored',
   "SELECT decision FROM r188_ci.attested_holds WHERE id=1")===
   'NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING'&&
  sql('marcosa_r188_restored',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'restored PG17 lost NO-GO, RLS or quarantine');
 replay=false;
 try{await createR188ObservationLedger({
  executeSql:async q=>sql('marcosa_r188_restored',q)
 }).record(hold);}catch{replay=true;}
 ok(replay,'restored native PG17 admitted replay');
 await writeFile(join(e.RUNNER_TEMP,T),transcript.bytes,
  {flag:'wx',mode:0o600});
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r187Report,retentionProof:retention,
  transcriptSha256:transcript.transcript.transcriptSha256,
  transcriptFileSha256:transcript.fileSha256,
  finalHold:hold,holdEvidenceSha256:hold.evidenceSha256,
  nativePostgres17DualReadback:true,
  nativePostgres17RestoreAndReplayDenied:true,
  ephemeralSignerKeysOnly:true,realHumanIdentityVerified:false,
  realAwsEffectiveRightsVerified:false,
  realPrivacyComplianceVerified:false,
  realStagingRpoRtoVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 await writeFile(join(e.RUNNER_TEMP,A),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R188_NATIVE_PG17_SIGNED_HOLD_RESTORE_AND_REPLAY=PASS');
 console.log('R188_EPHEMERAL_TWO_ED25519_TRANSCRIPT_CHECK=PASS');
 console.log('R188_REAL_STAGING_HUMANS_AWS_PRIVACY_PRODUCTION=NO_GO');
}
