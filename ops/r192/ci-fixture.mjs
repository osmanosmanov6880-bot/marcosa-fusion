/** Disposable data: true Ed25519 signatures on simulated reviewer/AWS receipts.
 * Keys are never serialized; all evidence remains CI-only and NO-GO. */
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {sealReceipt} from '../r190/common.mjs';
import {assessR192ReviewDecision} from './review-decision.mjs';
import {r192RotationMessage,verifyR192KeyRotation} from './key-rotation.mjs';
import {assessR192AwsRisk} from './aws-risk.mjs';
import {assessR192Release} from './release-verdict.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const roles=['SECURITY','OPERATIONS','PRIVACY'];
export const PARENT_R191='534b65791b21b514b96894014def478352ba8a70';
export function buildR192Fixture({
 commit='a'.repeat(40),bundleSha256='b'.repeat(64),now=Date.now(),
 missingReview=null,awsAllowed=null
}={}){
 const clock=()=>now;
 const github=sealReceipt({
  schemaVersion:1,kind:'R191_PR',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE',repository:'osmanosmanov6880-bot/marcosa-fusion',
  pullRequest:168,reviewPagesComplete:true,
  commitSignatureVerifiedByGithub:true,unresolvedChangesOnHead:0,
  reviewChecks:roles.map((role,i)=>({
   role,githubUserId:200+i,approved:role!==missingReview
  })),
  allRequiredReviewEventsObserved:missingReview===null,
  observedAtMs:now-1000,expiresAtMs:now+60000,
  realPilotAuthorized:false,productionAuthorized:false
 });
 const accounts=['111111111111','222222222222'].map(accountId=>({
  accountId,operationsSimulated:12,destructiveActionsDenied:awsAllowed?11:12,
  unexpectedAllows:awsAllowed?[awsAllowed]:[]
 }));
 const iam=sealReceipt({
  schemaVersion:1,kind:'R191_AWS',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE',source:accounts[0],offsite:accounts[1],
  stsSessionAccountAndRoleShapeChecked:true,
  realPermissionsProvenBySimulation:false,
  kmsKeyPolicyAndEffectiveRightsVerified:false,
  organizationsScpIndependentlyVerified:false,
  all24DangerousActionsDenied:awsAllowed===null,
  observedAtMs:now-1000,expiresAtMs:now+60000,
  realPilotAuthorized:false,productionAuthorized:false
 });
 const review=assessR192ReviewDecision({commit,bundleSha256,github,clock});
 const iamRisk=assessR192AwsRisk({commit,bundleSha256,iam,clock});
 const oldPairs=roles.map(()=>generateKeyPairSync('ed25519'));
 const newPair=generateKeyPairSync('ed25519');
 const identity=(pair,role,i)=>{
  const der=pair.publicKey.export({type:'spki',format:'der'});
  return {role,signerId:'r192_person_'+i,githubUserId:200+i,
   publicKeySpkiBase64:der.toString('base64'),
   keyFingerprintSha256:sha(der)};
 };
 const oldDoc={schemaVersion:1,sourceCommit:commit,generation:8,
  reviewers:roles.map((role,i)=>identity(oldPairs[i],role,i))};
 const newDoc={schemaVersion:1,sourceCommit:commit,generation:9,
  reviewers:roles.map((role,i)=>identity(
   i===2?newPair:oldPairs[i],role,i))};
 const oldBytes=Buffer.from(JSON.stringify(oldDoc)+'\n','utf8');
 const newBytes=Buffer.from(JSON.stringify(newDoc)+'\n','utf8');
 const oldRegistrySha256=sha(oldBytes);
 const challenge={
  sourceCommit:commit,bundleSha256,
  oldRegistrySha256,newRegistrySha256:sha(newBytes),
  nonce:sha('r192-disposable:'+commit+':'+now).slice(0,32),
  issuedAtMs:now-1000,expiresAtMs:now+45000
 };
 const message=r192RotationMessage(challenge);
 const signatures=roles.map((role,i)=>({
  role,signerId:'r192_person_'+i,
  signatureBase64url:sign(null,message,oldPairs[i].privateKey).toString('base64url')
 }));
 const rotation=verifyR192KeyRotation({
  oldBytes,newBytes,expectedOldSha256:oldRegistrySha256,
  bundleSha256,challenge,signatures,clock
 });
 const release=assessR192Release({
  commit,bundleSha256,parentR191Commit:PARENT_R191,
  review,rotation,iamRisk,clock
 });
 const packageDoc={
  schemaVersion:1,sourceMode:'CI_DISPOSABLE',sourceCommit:commit,
  sourceBundleSha256:bundleSha256,parentR191Commit:PARENT_R191,
  github,iam,review,iamRisk,rotation,release,
  oldRegistryBase64:oldBytes.toString('base64'),
  newRegistryBase64:newBytes.toString('base64'),
  oldRegistrySha256,challenge,signatures
 };
 const bytes=Buffer.from(JSON.stringify(packageDoc)+'\n','utf8');
 return Object.freeze({github,iam,review,iamRisk,rotation,release,
  oldBytes,newBytes,oldRegistrySha256,challenge,signatures,
  packageDoc,bytes,fileSha256:sha(bytes)});
}
