/**
 * R178: separately injected STS read-only clients in distinct AWS accounts.
 * Return proof of exact SDK responses, not proof of real humans, AWS tenants,
 * effective IAM rights or production readiness. Network OFF by default.
 */
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 ACCOUNT=/^[0-9]{12}$/,ROLE=/^AROA[A-Z0-9]{16}$/,
 RUN=/^[0-9]{5,20}$/;
const fail=m=>{throw Error('R178 identity audit: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const role='marcosa-r178-readonly-auditor';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valid=c=>c&&ACCOUNT.test(c.accountId||'')&&
 ROLE.test(c.roleId||'')&&typeof c.client?.send==='function';
export function createR178DualIdentityAudit({source,offsite,
 commands,runId,commit,bundleSha256,clock=()=>Date.now(),
 allowExternalCalls=false}={}){
 ok(valid(source)&&valid(offsite)&&
  source.accountId!==offsite.accountId&&source.roleId!==offsite.roleId&&
  source.client!==offsite.client&&
  RUN.test(runId||'')&&H40.test(commit||'')&&
  H64.test(bundleSha256||'')&&
  commands&&typeof commands.GetCallerIdentityCommand==='function'&&
  typeof clock==='function','two independent pinned STS accounts and source checkout required');
 const session='marcosa-r178-'+runId;
 const expected=c=>({
  Account:c.accountId,
  Arn:'arn:aws:sts::'+c.accountId+':assumed-role/'+role+'/'+session,
  UserId:c.roleId+':'+session
 });
 async function inspect(){
  ok(allowExternalCalls===true,'STS network disabled until explicit isolated opt-in');
  const started=clock();
  ok(Number.isSafeInteger(started)&&started>0,'positive audit clock required');
  let responses;
  try{
   responses=await Promise.all([source,offsite].map(x=>
    x.client.send(new commands.GetCallerIdentityCommand({}),{
     abortSignal:AbortSignal.timeout(8500)})));
  }catch{fail('source or offsite STS read-only response unavailable');}
  for(let i=0;i<2;i++){
   const x=responses[i],want=expected(i===0?source:offsite);
   ok(x&&x.Account===want.Account&&
    x.Arn===want.Arn&&x.UserId===want.UserId,
    'one STS principal, account or session was replaced');
  }
  const checkedAtMs=clock();
  ok(Number.isSafeInteger(checkedAtMs)&&checkedAtMs>=started&&
   checkedAtMs-started<=60000,'STS proofs expired during dual inspection');
  const data={
   schemaVersion:1,commit,bundleSha256,runId,
   sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
   sourceRoleId:source.roleId,offsiteRoleId:offsite.roleId,
   sourceSessionArn:responses[0].Arn,offsiteSessionArn:responses[1].Arn,
   checkedAtMs,expiresAtMs:checkedAtMs+60000,
   distinctAwsAccountIdsInResponse:true,
   independentlyAuthenticatedProvider:false,
   effectiveIamRightsProven:false,realHumanIdentityProven:false,
   productionAuthorized:false
  };
  return Object.freeze({...data,verified:true,
   evidenceSha256:sha(data)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  networkEnabled:allowExternalCalls,readOnly:true,
  productionAuthorized:false})});
}
export function verifyR178IdentityProof(p,{commit,bundleSha256,
 sourceAccountId,offsiteAccountId,clock=()=>Date.now()}={}){
 ok(p?.verified===true&&p.schemaVersion===1&&
  p.commit===commit&&p.bundleSha256===bundleSha256&&
  p.sourceAccountId===sourceAccountId&&
  p.offsiteAccountId===offsiteAccountId&&
  ACCOUNT.test(p.sourceAccountId||'')&&
  ACCOUNT.test(p.offsiteAccountId||'')&&
  p.sourceAccountId!==p.offsiteAccountId&&
  ROLE.test(p.sourceRoleId||'')&&ROLE.test(p.offsiteRoleId||'')&&
  p.sourceRoleId!==p.offsiteRoleId&&
  RUN.test(p.runId||'')&&
  p.sourceSessionArn==='arn:aws:sts::'+sourceAccountId+
   ':assumed-role/'+role+'/marcosa-r178-'+p.runId&&
  p.offsiteSessionArn==='arn:aws:sts::'+offsiteAccountId+
   ':assumed-role/'+role+'/marcosa-r178-'+p.runId&&
  p.distinctAwsAccountIdsInResponse===true&&
  p.independentlyAuthenticatedProvider===false&&
  p.effectiveIamRightsProven===false&&
  p.realHumanIdentityProven===false&&
  p.productionAuthorized===false&&
  Number.isSafeInteger(p.checkedAtMs)&&
  Number.isSafeInteger(p.expiresAtMs)&&
  p.expiresAtMs-p.checkedAtMs===60000&&
  clock()>=p.checkedAtMs&&clock()<=p.expiresAtMs,
  'source/offsite identity evidence untrusted, stale or overclaimed');
 const {verified,evidenceSha256,...source}=p;
 ok(H64.test(evidenceSha256||'')&&evidenceSha256===sha(source),
  'STS identity evidence digest tampered');
 return Object.freeze({verified:true,evidenceSha256,
  productionAuthorized:false});
}
