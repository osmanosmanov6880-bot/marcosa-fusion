/**
 * R172 read-only cross-account replication and two-KMS-key configuration.
 * This is a CONFIGURATION check, NOT proof of delivered replica or RPO.
 * Both KMS read-only clients are separately injected, no role assumption.
 */
const fail=m=>{throw Error('R172 cross-account resilience: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const ACCOUNT=/^[0-9]{12}$/;
export function createR172ReplicationAudit({
 sourceS3,sourceKms,offsiteKms,commands,clock=()=>Date.now(),
 sourceAccountId,sourceRegion,sourceBucket,sourceKmsArn,
 offsiteAccountId,offsiteRegion,offsiteBucket,offsiteKmsArn,
 allowExternalCalls=false
}={}){
 const a=ARN.exec(sourceKmsArn||''),z=ARN.exec(offsiteKmsArn||'');
 ok(a&&z&&ACCOUNT.test(sourceAccountId||'')&&
  ACCOUNT.test(offsiteAccountId||'')&&
  a[1]===sourceRegion&&a[2]===sourceAccountId&&
  z[1]===offsiteRegion&&z[2]===offsiteAccountId&&
  sourceRegion!==offsiteRegion&&sourceAccountId!==offsiteAccountId&&
  sourceKmsArn!==offsiteKmsArn&&
  typeof sourceBucket==='string'&&typeof offsiteBucket==='string'&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(sourceBucket)&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(offsiteBucket)&&
  sourceBucket!==offsiteBucket&&
  sourceS3&&sourceKms&&offsiteKms&&
  [sourceS3,sourceKms,offsiteKms].every(c=>typeof c.send==='function')&&
  commands&&
  ['GetBucketReplicationCommand','GetKeyRotationStatusCommand',
   'DescribeKeyCommand'].every(k=>typeof commands[k]==='function')&&
  typeof clock==='function',
  'two distinct AWS accounts/regions/KMS keys and read-only clients required');
 async function send(client,name,input){
  ok(allowExternalCalls===true,'external AWS read-only calls disabled');
  try{
   return await client.send(new commands[name+'Command'](input),{
    abortSignal:AbortSignal.timeout(8500)
   });
  }catch{fail('AWS read-only provider unavailable: '+name);}
 }
 async function inspect(){
  ok(allowExternalCalls===true,'external AWS staging disabled');
  const [configuration,sourceKey,sourceRotation,replicaKey,replicaRotation]=
   await Promise.all([
    send(sourceS3,'GetBucketReplication',{
     Bucket:sourceBucket,ExpectedBucketOwner:sourceAccountId}),
    send(sourceKms,'DescribeKey',{KeyId:sourceKmsArn}),
    send(sourceKms,'GetKeyRotationStatus',{KeyId:sourceKmsArn}),
    send(offsiteKms,'DescribeKey',{KeyId:offsiteKmsArn}),
    send(offsiteKms,'GetKeyRotationStatus',{KeyId:offsiteKmsArn})
   ]);
  const ruleSet=configuration?.ReplicationConfiguration;
  ok(ruleSet&&
   ruleSet.Role==='arn:aws:iam::'+sourceAccountId+
    ':role/marcosa-staging-cross-account-replication'&&
   Array.isArray(ruleSet.Rules)&&ruleSet.Rules.length===1,
   'exact staging-only S3 replication IAM role and single rule required');
  const rule=ruleSet.Rules[0],destination=rule.Destination;
  ok(rule.Status==='Enabled'&&rule.ID==='marcosa-r172-offsite-immutable'&&
   rule.Priority===1&&
   rule.DeleteMarkerReplication?.Status==='Disabled'&&
   rule.Filter?.Prefix==='marcosa/isolated/r168/'&&
   rule.SourceSelectionCriteria?.SseKmsEncryptedObjects?.Status==='Enabled'&&
   destination?.Bucket==='arn:aws:s3:::'+offsiteBucket&&
   destination.Account===offsiteAccountId&&
   destination.EncryptionConfiguration?.ReplicaKmsKeyID===offsiteKmsArn,
   'replication missing, delete marker propagation enabled or offsite route changed');
  const keys=[
   [sourceKey?.KeyMetadata,sourceKmsArn,sourceAccountId],
   [replicaKey?.KeyMetadata,offsiteKmsArn,offsiteAccountId]
  ];
  for(const [key,arn,accountId] of keys){
   ok(key?.Arn===arn&&key.AWSAccountId===accountId&&
    key.Enabled===true&&key.KeyState==='Enabled'&&
    key.KeyUsage==='ENCRYPT_DECRYPT'&&
    key.KeySpec==='SYMMETRIC_DEFAULT',
    'disabled/non-symmetric or substituted source/offsite KMS key');
  }
  ok(sourceRotation?.KeyRotationEnabled===true&&
   replicaRotation?.KeyRotationEnabled===true,
   'KMS automatic rotation not enabled in both accounts');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted timestamp required');
  return Object.freeze({
   inspected:true,sourceAccountId,sourceRegion,sourceBucket,
   offsiteAccountId,offsiteRegion,offsiteBucket,
   sourceKmsArn,offsiteKmsArn,
   sourceAndOffsiteAccountDistinct:true,sourceAndOffsiteRegionDistinct:true,
   replicationTargetPinned:true,deleteMarkerReplicationDisabled:true,
   sseKmsReplicationConfigured:true,bothKmsKeysEnabledAndRotating:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   replicaDeliveryConfirmed:false,offsiteBucketObjectLockIndependentlyAudited:false,
   actualCrossAccountDecryptRestored:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  sourceBucket,offsiteBucket,readOnly:true,
  networkEnabled:allowExternalCalls,productionAuthorized:false
 })});
}
export function verifyR172ReplicationAudit(proof,{sourceAccountId,
 sourceBucket,offsiteAccountId,offsiteBucket,clock=()=>Date.now()}={}){
 const now=clock();
 ok(proof?.inspected===true&&proof.sourceAccountId===sourceAccountId&&
  proof.sourceBucket===sourceBucket&&
  proof.offsiteAccountId===offsiteAccountId&&
  proof.offsiteBucket===offsiteBucket&&
  proof.sourceAndOffsiteAccountDistinct===true&&
  proof.sourceAndOffsiteRegionDistinct===true&&
  proof.replicationTargetPinned===true&&
  proof.deleteMarkerReplicationDisabled===true&&
  proof.sseKmsReplicationConfigured===true&&
  proof.bothKmsKeysEnabledAndRotating===true&&
  proof.replicaDeliveryConfirmed===false&&
  proof.offsiteBucketObjectLockIndependentlyAudited===false&&
  proof.actualCrossAccountDecryptRestored===false&&
  proof.productionAuthorized===false&&
  Number.isSafeInteger(now)&&now>=proof.checkedAtMs&&
  now<=proof.expiresAtMs&&proof.expiresAtMs-proof.checkedAtMs<=60000,
  'replication policy stale, unverified or wrongly elevated');
 return Object.freeze({configurationAccepted:true,
  replicaDataNotYetProven:true,productionAuthorized:false});
}
