/**
 * R172 independent STS session identity and IAM OIDC provider registry check.
 * Caller identity uses STS credentials from R170; IAM provider inspection
 * uses separately supplied READ-ONLY auditor credentials, not role mutation.
 * This is a real SDK-shaped API contract; CI uses injected fake responses.
 */
const fail=m=>{throw Error('R172 AWS identity: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const ACCOUNT=/^[0-9]{12}$/,ROLEID=/^AROA[A-Z0-9]{16}$/;
const RUN=/^[0-9]{5,20}$/;
export function createR172AwsIdentityAudit({
 stsClient,iamAuditorClient,commands,accountId,
 runId,sourceRoleId,expectedSessionArn,
 clock=()=>Date.now(),allowExternalCalls=false
}={}){
 ok(ACCOUNT.test(accountId||'')&&RUN.test(runId||'')&&
  ROLEID.test(sourceRoleId||'')&&
  expectedSessionArn==='arn:aws:sts::'+accountId+
   ':assumed-role/marcosa-staging-backup-role/marcosa-r170-'+runId&&
  stsClient&&iamAuditorClient&&
  typeof stsClient.send==='function'&&
  typeof iamAuditorClient.send==='function'&&commands&&
  typeof commands.GetCallerIdentityCommand==='function'&&
  typeof commands.GetOpenIDConnectProviderCommand==='function'&&
  typeof clock==='function',
  'exact source STS session and separate IAM read-only provider required');
 const oidcProviderArn='arn:aws:iam::'+accountId+
  ':oidc-provider/token.actions.githubusercontent.com';
 const roleSession='marcosa-r170-'+runId;
 async function inspect(){
  ok(allowExternalCalls===true,'real AWS STS/IAM inspection disabled without staging opt-in');
  let identity,provider;
  try{
   [identity,provider]=await Promise.all([
    stsClient.send(new commands.GetCallerIdentityCommand({}),{
     abortSignal:AbortSignal.timeout(7000)}),
    iamAuditorClient.send(new commands.GetOpenIDConnectProviderCommand({
     OpenIDConnectProviderArn:oidcProviderArn
    }),{abortSignal:AbortSignal.timeout(7000)})
   ]);
  }catch{fail('AWS identity/provider read-only request denied');}
  ok(identity?.Account===accountId&&
   identity.Arn===expectedSessionArn&&
   identity.UserId===sourceRoleId+':'+roleSession,
   'session identity/account mismatched or replaced after STS');
  ok(provider?.Url==='token.actions.githubusercontent.com'&&
   Array.isArray(provider.ClientIDList)&&
   provider.ClientIDList.length===1&&
   provider.ClientIDList[0]==='sts.amazonaws.com'&&
   Array.isArray(provider.ThumbprintList)&&
   provider.ThumbprintList.length<=5&&
   provider.ThumbprintList.every(x=>/^[a-f0-9]{40}$/i.test(x)),
   'OIDC provider issuer, audience or trust-store thumbprint configuration drift');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted time required');
  return Object.freeze({
   verified:true,accountId,oidcProviderArn,
   sourceRoleId,sessionArn:identity.Arn,stsUserId:identity.UserId,
   trustedOidcIssuerObserved:true,
   exactSingleStsAudienceObserved:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   independentlyVerifiedAuditorPrincipal:false,
   awsIamEffectiveRightsProven:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,networkEnabled:allowExternalCalls,
  independentIamAuditorRequired:true,productionAuthorized:false
 })});
}
export function verifyR172AwsIdentityAudit(proof,{accountId,runId,
 sourceRoleId,expectedSessionArn,clock=()=>Date.now()}={}){
 const now=clock();
 ok(proof?.verified===true&&proof.accountId===accountId&&
  proof.sourceRoleId===sourceRoleId&&
  proof.sessionArn===expectedSessionArn&&
  proof.stsUserId===sourceRoleId+':marcosa-r170-'+runId&&
  proof.oidcProviderArn==='arn:aws:iam::'+accountId+
   ':oidc-provider/token.actions.githubusercontent.com'&&
  proof.trustedOidcIssuerObserved===true&&
  proof.exactSingleStsAudienceObserved===true&&
  proof.independentlyVerifiedAuditorPrincipal===false&&
  proof.awsIamEffectiveRightsProven===false&&
  proof.productionAuthorized===false&&
  Number.isSafeInteger(now)&&
  now>=proof.checkedAtMs&&now<=proof.expiresAtMs&&
  proof.expiresAtMs-proof.checkedAtMs<=60000,
  'AWS STS/provider proof missing, stale or elevated');
 return Object.freeze({sessionBoundToExactRole:true,
  effectiveAwsRightsStillUnproven:true,productionAuthorized:false});
}
