/**
 * R169 deterministic IAM planning for a dedicated staging AWS account.
 * Produces REVIEW-ONLY trust and least-privilege policies, never deploys them.
 * GitHub 2026 immutable OIDC subject requires explicit opt-in and actual
 * repository/owner numeric IDs; do not assume the provider has migrated.
 */
const ACCOUNT=/^\d{12}$/,BUCKET=/^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?!-)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ROLE=/^[a-zA-Z0-9+=,.@_-]{6,60}$/,REGION=/^[a-z]{2}(?:-[a-z]+)+-\d$/;
const KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):key\/([a-f0-9-]{36})$/;
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const DEFAULT_REF='refs/heads/feature/marcosa-r150-growth-economics';
const fail=m=>{throw Error('R169 IAM plan: '+m);};
const guard=(x,m)=>{if(!x)fail(m);};
const identity=x=>({ownerId:x.ownerId,repoId:x.repoId});
export function r169GitHubOidcSubject({ownerId,repoId,subjectMode='legacy',
 ref=DEFAULT_REF}={}){
 guard(Number.isSafeInteger(ownerId)&&ownerId>0&&Number.isSafeInteger(repoId)&&
  repoId>0&&ref===DEFAULT_REF&&['legacy','immutable'].includes(subjectMode),
  'explicit owner/repo numeric IDs, exact feature branch and subject mode required');
 const legacy='repo:'+REPO+':ref:'+ref;
 return subjectMode==='legacy'?legacy:
  'repo:osmanosmanov6880-bot@'+ownerId+'/marcosa-fusion@'+repoId+':ref:'+ref;
}
const object=p=>'arn:aws:s3:::'+p+'/marcosa/isolated/r168/*';
const bucket=p=>'arn:aws:s3:::'+p;
const allow=(sid,actions,resource,condition)=>({
 Sid:sid,Effect:'Allow',Action:actions,Resource:resource,
 ...(condition?{Condition:condition}:{})
});
const deny=(sid,actions,resource)=>({Sid:sid,Effect:'Deny',Action:actions,Resource:resource});
export function createR169IamPlan({
 accountId,region,bucketName,kmsKeyArn,ownerId,repoId,
 subjectMode,expectedOidcSubject,roleName='marcosa-staging-backup-role'
}={}){
 const arn=typeof kmsKeyArn==='string'?KMS.exec(kmsKeyArn):null;
 guard(ACCOUNT.test(accountId||'')&&REGION.test(region||'')&&
  BUCKET.test(bucketName||'')&&arn&&arn[1]===region&&arn[2]===accountId&&
  ROLE.test(roleName||''),
  'account, AWS region, immutable bucket and exact key ARN required');
 const subject=r169GitHubOidcSubject({ownerId,repoId,subjectMode});
 guard(subject===expectedOidcSubject&&subject.length<256,
  'actual OIDC sub claim must be explicitly pinned');
 const trust={
  Version:'2012-10-17',
  Statement:[{
   Sid:'OnlyExactGitHubBranch',
   Effect:'Allow',
   Principal:{Federated:'arn:aws:iam::'+accountId+
    ':oidc-provider/token.actions.githubusercontent.com'},
   Action:'sts:AssumeRoleWithWebIdentity',
   Condition:{StringEquals:{
    'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
    'token.actions.githubusercontent.com:sub':subject
   }}
  }]
 };
 const keyConditions={StringEquals:{
  'kms:EncryptionContext:marcosa-project':'marcosa-fusion',
  'kms:EncryptionContext:marcosa-scope':'isolated-staging-only',
  'kms:EncryptionContext:marcosa-version':'r168'
 }};
 const bucketArn=bucket(bucketName),objectArn=object(bucketName);
 const policy={
  Version:'2012-10-17',
  Statement:[
   allow('ReadStagingBucketControls',
    ['s3:GetBucketLocation','s3:GetBucketVersioning',
     's3:GetBucketObjectLockConfiguration','s3:GetBucketPublicAccessBlock',
     's3:GetBucketPolicy','s3:GetEncryptionConfiguration',
     's3:GetBucketOwnershipControls'],bucketArn),
   allow('WriteOnlyIsolatedEncryptedArchive',
    ['s3:PutObject','s3:PutObjectRetention','s3:GetObject',
     's3:GetObjectVersion','s3:GetObjectRetention',
     's3:GetObjectVersionAttributes'],objectArn),
   allow('ReadKmsDescription',['kms:DescribeKey','kms:GetKeyPolicy'],kmsKeyArn),
   allow('KmsEncryptDecryptOnlySourceContext',
    ['kms:GenerateDataKey','kms:Decrypt'],kmsKeyArn,keyConditions),
   deny('NeverDeleteOrOverrideLockedBackup',
    ['s3:DeleteObject','s3:DeleteObjectVersion',
     's3:BypassGovernanceRetention','s3:PutObjectLegalHold'],objectArn),
   deny('NeverChangeBucketSecurity',
    ['s3:PutBucketPolicy','s3:DeleteBucketPolicy',
     's3:PutBucketAcl','s3:PutBucketVersioning',
     's3:PutBucketPublicAccessBlock','s3:PutBucketObjectLockConfiguration',
     's3:DeleteBucket'],bucketArn),
   deny('NeverDisableOrDestroyKms',
    ['kms:DisableKey','kms:ScheduleKeyDeletion','kms:PutKeyPolicy',
     'kms:CreateGrant','kms:RevokeGrant'],kmsKeyArn)
  ]
 };
 const all=policy.Statement;
 guard(all.every(s=>s.Resource!=='*'&&s.Resource!=='arn:aws:s3:::*')&&
  all.every(s=>Array.isArray(s.Action)&&s.Action.every(a=>!a.includes('*'))),
  'wildcard IAM resources or actions forbidden');
 return Object.freeze({trustPolicy:trust,permissionsPolicy:policy,
  accountId,region,bucketName,kmsKeyArn,subject,roleName,
  policyApplied:false,githubEnvironmentProtectionVerified:false,
  AWS_ROLE_ARN:'arn:aws:iam::'+accountId+':role/'+roleName,
  productionAuthorized:false});
}
export function verifyR169IamPlan(plan,expected){
 guard(plan&&plan.policyApplied===false&&plan.productionAuthorized===false,
  'plan is not an actual authorization decision');
 const made=createR169IamPlan(expected);
 guard(JSON.stringify(plan.trustPolicy)===JSON.stringify(made.trustPolicy)&&
  JSON.stringify(plan.permissionsPolicy)===JSON.stringify(made.permissionsPolicy)&&
  plan.subject===made.subject,'policy body or GitHub OIDC sub modified');
 return Object.freeze({matched:true,needsIndependentIamReview:true,
  liveRoleEstablished:false,productionAuthorized:false});
}
