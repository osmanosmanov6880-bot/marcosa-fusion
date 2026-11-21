/**
 * R164 composite rehearsal ties a real disposable PG17 restore, a real
 * staging-loopback runtime shutdown, two ephemeral keys, R163 CI evidence.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {r163SpkiFingerprint} from '../r163/staging-readback.mjs';
import {createR164StagingTarget,verifyR164StagingTarget} from './staging-target.mjs';
import {createR164DrillChallenge,verifyR164DualReview,createR164NonceFence,
 r164CanonicalChallengeBytes,r164ReviewerFingerprint} from './change-quorum.mjs';
import {verifyR164RestoreWitness} from './restore-witness.mjs';
import {createR164EmergencyRollback} from './emergency-rollback.mjs';
import {evaluateR164OperationsAudit} from './operations-audit.mjs';
import {createR162IncidentLedger} from '../r162/incident-ledger.mjs';
import {createR160StagingService} from '../r160/staging-service.mjs';

const repo='osmanosmanov6880-bot/marcosa-fusion',commit=process.env.GITHUB_SHA;
const check=(v,m)=>{if(!v)throw Error('R164 CI operations: '+m);};
check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY===repo&&
 process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='postgres'&&
 typeof process.env.RUNNER_TEMP==='string'&&/^[a-f0-9]{40}$/.test(commit||''),
 'isolated CI PostgreSQL required');
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const caPem=await readFile(process.env.R164_CA_FILE,'utf8');
const digest=s=>createHash('sha256').update(s).digest('hex');
const configFp=digest('synthetic-r164-sealed-secret-identity').slice(0,20);
const plan={schemaVersion:1,repository:repo,stage:'isolated-staging',
 commit,bundleSha256:bundle.sha256,projectRef:'abcdefghijklmnopqrst',
 stagingOrigin:'https://staging.example.invalid',
 databaseHost:'db-stage.example.invalid',dbCaSha256:digest(caPem),
 tlsSpkiSha256:r163SpkiFingerprint(caPem),
 secretConfigFingerprint:configFp,listenHost:'127.0.0.1',
 synthetic:true,automatedDeploy:false,externalDelivery:false,
 paymentsEnabled:false,payoutsEnabled:false};
const target=createR164StagingTarget(plan);
check(verifyR164StagingTarget(plan,{commit,bundleSha256:bundle.sha256,
 secretConfigFingerprint:configFp,digest:target.digest}).verifiedAgainstExpectedIdentity,
 'stage source or CA mismatch');
const keys=['operator','independent-reviewer'].map(role=>{
 const pair=generateKeyPairSync('ed25519');
 return{role,...pair,pem:pair.publicKey.export({format:'pem',type:'spki'})};
});
const packet=createR164DrillChallenge({commit,targetDigest:target.digest});
const approvals=keys.map(k=>({role:k.role,publicKeyPem:k.pem,
 signature:sign(null,r164CanonicalChallengeBytes(packet),k.privateKey)
  .toString('base64url')}));
const pins=Object.fromEntries(keys.map(k=>[k.role,r164ReviewerFingerprint(k.pem)]));
const quorum=verifyR164DualReview({packet,approvals,
 pinnedReviewerFingerprints:pins,commit,targetDigest:target.digest});
const fence=createR164NonceFence();
check(fence.consume(quorum).rehearsalPermitted,'signed rehearsal lease not accepted');
let replayRejected=false;
try{fence.consume(quorum);}catch{replayRejected=true;}
check(replayRejected,'signed nonce replay not rejected');
const restore=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,
 'r164-restored-witness.json'),'utf8'));
check(verifyR164RestoreWitness(restore,{commit,bundleSha256:bundle.sha256,
 witnessDigest:restore.witnessDigest}).matched,'measured PG17 restore missing');
const prior=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,
 'r163-artifact','ci-report.json'),'utf8'));
check(prior.commit===commit&&prior.bundleSha256===bundle.sha256&&
 prior.decision==='CI_SIMULATION_COMPLETE'&&prior.productionAuthorized===false&&
 prior.independentlyReviewed===false,'actual R163 CI evidence missing');
const pgConfig={host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,
 database:'postgres',user:'marcosa_r160_ci',
 password:process.env.R164_APP_PASSWORD,caPem,maxConnections:2};
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'r164-ci-key',alg:'ES256',use:'sig'};
const runtime=createR160StagingService({pgConfig,ciLoopback:true,
 settings:{stage:'staging',projectRef:plan.projectRef,
  allowedOrigins:[plan.stagingOrigin],maxPreflightAgeMs:15000},
 jwksFetch:async(url,opts)=>{
  check(url==='https://'+plan.projectRef+'.supabase.co/auth/v1/.well-known/jwks.json'&&
   opts.redirect==='error','unexpected JWT issuer');
  return{ok:true,status:200,text:async()=>JSON.stringify({keys:[jwk]})};
 }});
let closed=false,started=false,rollback;
const ledger=createR162IncidentLedger();
try{
 const launched=await runtime.listen({host:'127.0.0.1',port:0});
 check(launched.status.ready,'actual PG17 TLS/Auth preflight failed');
 started=true;
 const lifecycle={async stop(){await runtime.stop();closed=true;},
  status(){return{state:closed?'stopped':'ready'};}};
 const emergency=createR164EmergencyRollback({runtime,lifecycle,ledger,timeoutMs:5000});
 rollback=await emergency.trigger({reason:'canary_degraded',incidentNonce:packet.nonce});
 check(rollback.shutdownVerified&&rollback.mutationReady===false&&
  runtime.status().ready===false,
  'PG17 staging remained ready after emergency');
}finally{if(started&&!closed)await runtime.stop();}
const priorReleaseGate={decision:prior.decision,commit,
 productionAuthorized:false,manualOperatorReviewRequired:true,
 syntheticEvidence:true};
const audit=evaluateR164OperationsAudit({commit,bundleSha256:bundle.sha256,
 target,quorum,restore,rollback,priorReleaseGate,now:Date.now()});
check(audit.decision==='CI_REHEARSAL_COMPLETE'&&
 audit.productionAuthorized===false&&audit.externalDeploymentAllowed===false,
 'CI rehearsal cannot authorize deployment');
const report={schemaVersion:1,repository:repo,commit,
 bundleSha256:bundle.sha256,targetDigest:target.digest,
 archiveSha256:restore.archiveSha256,restoreWitnessDigest:restore.witnessDigest,
 quorumSignatures:quorum.signatureCount,replayRejected,
 realPg17RollbackVerified:rollback.shutdownVerified,
 incidentEvents:ledger.snapshot().entries.length,
 decision:audit.decision,syntheticCi:true,productionAuthorized:false,
 externalDeploymentAllowed:false,realSupabaseUsed:false};
await writeFile(join(process.env.RUNNER_TEMP,'r164-operations-report.json'),
 JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('R164_SYNTHETIC_SIGNED_QUORUM_AND_NONCE_FENCE=PASS');
console.log('R164_REAL_PG17_IMMEDIATE_WRITE_QUARANTINE=PASS');
console.log('R164_RECOVERY_AND_R163_REPRODUCIBLE_EVIDENCE_BOUND=PASS');
console.log('R164_COMPOSITE_GATE_CI_REHEARSAL_ONLY=PASS');
