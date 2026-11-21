/**
 * R170 manual-only, READ-ONLY staging evidence gate.
 * OIDC STS session -> actual AWS-shaped preflight/posture -> IAM
 * simulation -> immutable ciphertext version readback -> durable nonce.
 * No S3 Put, KMS Decrypt, pg_restore, Supabase or deployment.
 * It CANNOT convert canary simulation into live AWS authorization.
 */
import {createHash} from 'node:crypto';
import {assertR169IsolatedRunner} from '../r169/aws-runtime.mjs';
import {verifyR169IamPlan} from '../r169/iam-plan.mjs';
import {verifyR169CloudPosture} from '../r169/cloud-posture.mjs';
import {verifyR168Readiness} from '../r168/aws-preflight.mjs';
import {verifyR164DualReview} from '../r164/change-quorum.mjs';
import {verifyR170IamSimulation} from './iam-simulator.mjs';
import {verifyR170S3RetentionWitness} from './s3-retention.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R170 read-only stage: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(x).digest('hex');
export function r170StageTargetDigest({commit,bundleSha256,
 roleArn,reference,inventorySha256}={}){
 check(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  /^arn:aws:iam::[0-9]{12}:role\/marcosa-staging-backup-role$/.test(roleArn||'')&&
  H64.test(inventorySha256||'')&&
  reference&&H64.test(reference.sha256||'')&&
  /^[A-Za-z0-9_.-]{1,128}$/.test(reference.versionId||'')&&
  H40.test(reference.commit||'')&&H64.test(reference.bundleSha256||'')&&
  ID.test(reference.archiveId||'')&&
  H64.test(reference.contextSha256||'')&&
  reference.commit===commit&&reference.bundleSha256===bundleSha256,
  'only exact source, version, archive and role may be signed');
 return hash(Buffer.from(JSON.stringify({
  schema:1,scope:'read-only-staging-only',commit,bundleSha256,
  roleArn,inventorySha256,reference:{
   sha256:reference.sha256,versionId:reference.versionId,
   archiveId:reference.archiveId,contextSha256:reference.contextSha256
  },productionAuthorized:false
 })));
}
export function createR170ReadOnlyStage({
 oidcExchange,iamPlan,iamExpected,
 runtimeFactory,quarantine,durableQuorum,
 env=process.env,clock=()=>Date.now()
}={}){
 check(oidcExchange&&typeof oidcExchange.exchange==='function'&&
  iamPlan&&iamExpected&&
  typeof runtimeFactory==='function'&&quarantine&&
  typeof quarantine.status==='function'&&durableQuorum&&
  typeof durableQuorum.consume==='function'&&typeof clock==='function',
  'trusted source-bound cloud and SQL control chain required');
 const scope={accountId:iamPlan.accountId,
  region:iamPlan.region,bucket:iamPlan.bucketName,
  kmsKeyArn:iamPlan.kmsKeyArn};
 async function verify({idToken,commit,bundleSha256,
  reference,inventorySha256,packet,approvals,pinnedReviewerFingerprints}={}){
  assertR169IsolatedRunner({env,clock});
  verifyR169IamPlan(iamPlan,iamExpected);
  check(oidcExchange.roleArn===iamPlan.AWS_ROLE_ARN,
   'OIDC role does not match reviewed IAM plan');
  const digest=r170StageTargetDigest({
   commit,bundleSha256,roleArn:iamPlan.AWS_ROLE_ARN,
   reference,inventorySha256
  });
  const signed=verifyR164DualReview({
   packet,approvals,pinnedReviewerFingerprints,
   commit,targetDigest:digest,clock
  });
  check(signed.signatureCount===2&&signed.synthetic===true&&
   signed.productionAuthorized===false,
   'two independent keys for synthetic-only rehearsal required');
  const start=await quarantine.status();
  check(start.closed===true&&Number.isSafeInteger(start.generation)&&
   start.generation>=3,'durable SQL quarantine not closed');
  const identity=await oidcExchange.exchange({idToken,commit});
  check(identity.awsStsResponseAccepted===true&&
   identity.roleArn===iamPlan.AWS_ROLE_ARN&&
   identity.productionAuthorized===false&&
   identity.credentials?.expiration instanceof Date,
   'AWS STS identity not established');
  let runtime;
  try{
   runtime=await runtimeFactory({
    credentials:identity.credentials,roleArn:identity.roleArn,
    accountId:scope.accountId,region:scope.region,
    bucket:scope.bucket,kmsKeyArn:scope.kmsKeyArn
   });
   check(runtime&&
    ['preflight','posture','iam','retention'].every(
     k=>runtime[k]&&typeof runtime[k].inspect==='function')&&
    typeof runtime.close==='function',
    'fresh STS-bound read-only clients required');
   const pre=await runtime.preflight.inspect();
   verifyR168Readiness(pre,{...scope,clock});
   check(pre.identityArn===identity.sessionArn,
    'different session performed AWS service checks');
   const posture=await runtime.posture.inspect();
   verifyR169CloudPosture(posture,{...scope,clock});
   const iam=await runtime.iam.inspect();
   verifyR170IamSimulation(iam,{...scope,
    archiveSha256:reference.sha256,clock});
   const storage=await runtime.retention.inspect({
    sha256:reference.sha256,versionId:reference.versionId,
    commit,bundleSha256,archiveId:reference.archiveId,
    contextSha256:reference.contextSha256
   });
   verifyR170S3RetentionWitness(storage,{...scope,
    sha256:reference.sha256,versionId:reference.versionId,clock});
   // Read-only checks cannot authorize actual writes or recovery.
   const grant=await durableQuorum.consume({
    packet,approvals,pinnedReviewerFingerprints,
    commit,targetDigest:digest
   });
   check(grant?.rehearsalLeaseRecorded===true&&
    grant.durablePostgresFence===true&&
    grant.nonce===packet.nonce&&grant.productionAuthorized===false,
    'one-time SQL nonce not durably recorded');
   const end=await quarantine.status();
   check(end.closed===true&&end.generation===start.generation,
    'durable quarantine changed during read-only inspection');
   return Object.freeze({
    verified:true,commit,sourceBundleSha256:bundleSha256,
    archiveSha256:reference.sha256,archiveVersionId:reference.versionId,
    sessionArn:identity.sessionArn,
    sourceInventorySha256:inventorySha256,reviewNonce:packet.nonce,
    twoDistinctReviewerKeysVerified:true,
    realHumanSeparationVerified:false,
    iamCanariesPassed:iam.checks,fullCiphertextReadbackVerified:true,
    cloudIamEffectivePermissionsEstablished:false,
    externalStagingAccountIndependentlyAudited:false,
    realOffsiteConfidentialityVerified:false,
    liveSupabaseConnected:false,productionAuthorized:false
   });
  }catch{fail('read-only staging prerequisite failed; no production authority');}
  finally{
   if(runtime)try{await runtime.close();}catch{}
  }
 }
 return Object.freeze({verify,publicStatus:()=>Object.freeze({
  readOnly:true,requiresOneTimeNonce:true,productionAuthorized:false
 })});
}
