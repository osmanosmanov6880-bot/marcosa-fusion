/**
 * R170 strictly scoped GitHub OIDC -> AWS STS token exchange.
 * The local token decode is NOT authentication: AWS STS must validate
 * the JWT signature and IAM OIDC trust policy before any credentials pass.
 * No token, secret or credentials are logged/persisted.
 */
import {createHash} from 'node:crypto';
import {assertR169IsolatedRunner,validateR169TemporaryCredentials} from '../r169/aws-runtime.mjs';
import {r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='refs/heads/feature/marcosa-r150-growth-economics';
const H40=/^[a-f0-9]{40}$/;
const fail=m=>{throw Error('R170 OIDC: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function decode(part,limit){
 ok(typeof part==='string'&&part.length>=2&&part.length<=limit&&
  /^[A-Za-z0-9_-]+$/.test(part),'bounded JWT encoding required');
 let x;
 try{
  const bytes=Buffer.from(part,'base64url');
  ok(bytes.toString('base64url')===part,'noncanonical JWT encoding');
  x=JSON.parse(bytes.toString('utf8'));
 }catch{fail('unusable JWT header/claims');}
 ok(x&&Object.getPrototypeOf(x)===Object.prototype,
  'JWT object required');
 return x;
}
export function inspectR170UnverifiedGitHubJwt({jwt,expectedSubject,
 ownerId,repoId,commit,clock=()=>Date.now()}={}){
 ok(typeof jwt==='string'&&jwt.length>=160&&jwt.length<=12000&&
  Number.isSafeInteger(ownerId)&&ownerId>0&&Number.isSafeInteger(repoId)&&repoId>0&&
  H40.test(commit||''),'exact GitHub JWT context required');
 const parts=jwt.split('.');
 ok(parts.length===3&&parts.every(s=>s.length>0)&&
  /^[A-Za-z0-9_-]{40,}$/.test(parts[2]),'three-part signed JWT required');
 const header=decode(parts[0],2000),payload=decode(parts[1],8000);
 ok(['RS256','ES256'].includes(header.alg)&&header.typ==='JWT'&&
  !Object.hasOwn(header,'jku')&&!Object.hasOwn(header,'x5u')&&
  !Object.hasOwn(header,'crit'),
  'only expected non-dynamic JWT signing family');
 const nowMs=clock(),now=Math.floor(nowMs/1000);
 ok(Number.isSafeInteger(nowMs)&&nowMs>0&&
  payload.iss==='https://token.actions.githubusercontent.com'&&
  payload.aud==='sts.amazonaws.com'&&
  payload.sub===expectedSubject&&
  payload.repository===REPO&&payload.ref===BRANCH&&
  payload.repository_id===String(repoId)&&
  payload.repository_owner_id===String(ownerId)&&
  payload.sha===commit&&
  Number.isSafeInteger(payload.iat)&&Number.isSafeInteger(payload.exp)&&
  payload.iat<=now+15&&payload.exp>now+60&&
  payload.exp-payload.iat<=600&&
  !Object.hasOwn(payload,'environment'),
  'OIDC claims did not match exact staging source/branch');
 return Object.freeze({
  locallyScoped:true,signatureVerifiedLocally:false,
  jwtSha256:createHash('sha256').update(jwt).digest('hex'),
  audience:payload.aud,subject:payload.sub,
  expiresAtMs:payload.exp*1000,productionAuthorized:false
 });
}
export function createR170OidcStsExchange({
 sts,commands,roleArn,region,ownerId,repoId,subjectMode='legacy',
 env=process.env,clock=()=>Date.now(),allowExternalCalls=false
}={}){
 const full='arn:aws:iam::';
 ok(typeof roleArn==='string'&&
  /^arn:aws:iam::[0-9]{12}:role\/marcosa-staging-backup-role$/.test(roleArn)&&
  /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region||'')&&
  sts&&typeof sts.send==='function'&&commands&&
  typeof commands.AssumeRoleWithWebIdentityCommand==='function'&&
  typeof clock==='function','pinned AWS STS OIDC role and command required');
 const expectedSubject=r169GitHubOidcSubject({ownerId,repoId,subjectMode});
 async function exchange({idToken,commit}={}){
  ok(allowExternalCalls===true,'network disabled without explicit staging opt-in');
  assertR169IsolatedRunner({env,clock});
  ok(env.GITHUB_SHA===commit&&H40.test(commit||''),
   'manual staging checkout commit does not match');
  const probe=inspectR170UnverifiedGitHubJwt({
   jwt:idToken,expectedSubject,ownerId,repoId,commit,clock
  });
  const sessionName='marcosa-r170-'+env.GITHUB_RUN_ID;
  let result;
  try{
   result=await sts.send(new commands.AssumeRoleWithWebIdentityCommand({
    RoleArn:roleArn,RoleSessionName:sessionName,
    WebIdentityToken:idToken,DurationSeconds:900
   }),{abortSignal:AbortSignal.timeout(10000)});
  }catch{fail('AWS STS rejected OIDC token or provider unavailable');}
  // AWS STS, NOT the local unsigned JWT inspection, is the authority.
  const sessionArn='arn:aws:sts::'+roleArn.slice(full.length,full.length+12)+
   ':assumed-role/marcosa-staging-backup-role/'+sessionName;
  ok(result&&result.Audience==='sts.amazonaws.com'&&
   result.SubjectFromWebIdentityToken===expectedSubject&&
   result.AssumedRoleUser?.Arn===sessionArn&&
   result.Provider==='token.actions.githubusercontent.com'&&
   result.Credentials&&result.Credentials.Expiration instanceof Date,
   'STS identity, audience or assumed role did not match pinned OIDC');
  const tmp=result.Credentials;
  let credentials;
  try{
   credentials=validateR169TemporaryCredentials({
    credentials:{
     accessKeyId:tmp.AccessKeyId,
     secretAccessKey:tmp.SecretAccessKey,
     sessionToken:tmp.SessionToken,
     expiration:tmp.Expiration
    },clock
   });
  }catch{fail('STS returned invalid/long-lived temporary credentials');}
  ok(credentials.expiration.getTime()<=clock()+901000&&
   credentials.expiration.getTime()<=probe.expiresAtMs+900000,
   'STS session unexpectedly long-lived');
  return Object.freeze({credentials,sessionArn,roleArn,region,expectedSubject,
   oidcJwtSha256:probe.jwtSha256,awsStsResponseAccepted:true,
   independentlyAuditedAwsRole:false,productionAuthorized:false});
 }
 return Object.freeze({exchange,expectedSubject,roleArn,region,
  publicStatus:()=>Object.freeze({stagingOnly:true,networkEnabled:allowExternalCalls,
   manualGitHubRunRequired:true,productionAuthorized:false})});
}
