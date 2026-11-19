import test from 'node:test';
import assert from 'node:assert/strict';
import {createR170OidcStsExchange,inspectR170UnverifiedGitHubJwt} from '../r170/oidc-sts.mjs';
import {r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
const now=1800000000000,clock=()=>now,commit='a'.repeat(40);
const ownerId=340648536,repoId=1430301644,subjectMode='legacy';
const expectedSubject=r169GitHubOidcSubject({ownerId,repoId,subjectMode});
const roleArn='arn:aws:iam::111122223333:role/marcosa-staging-backup-role';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_SHA:commit,GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_RUN_ID:'44555512345',MARCOSA_STAGING_ONLY:'true',
 MARCOSA_REAL_AWS_OPT_IN:'true',AWS_EC2_METADATA_DISABLED:'true'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function token(patch={},headerPatch={}){
 const header={alg:'RS256',typ:'JWT',...headerPatch};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',
  sub:expectedSubject,repository:'osmanosmanov6880-bot/marcosa-fusion',
  ref:env.GITHUB_REF,sha:commit,repository_id:String(repoId),
  repository_owner_id:String(ownerId),iat:Math.floor(now/1000)-10,
  exp:Math.floor(now/1000)+300,...patch};
 return b64(header)+'.'+b64(claims)+'.'+'A'.repeat(86);
}
class AssumeRoleWithWebIdentityCommand{constructor(input){this.input=input;}}
function setup(responseChange={}){
 const observed=[];
 const sts={send:async cmd=>{
  observed.push(cmd.input);
  return{Audience:'sts.amazonaws.com',Provider:'token.actions.githubusercontent.com',
   SubjectFromWebIdentityToken:expectedSubject,
   AssumedRoleUser:{Arn:'arn:aws:sts::111122223333:assumed-role/marcosa-staging-backup-role/marcosa-r170-44555512345'},
   Credentials:{AccessKeyId:'ASIA'+'A'.repeat(16),SecretAccessKey:'B'.repeat(40),
    SessionToken:'test-only-'+ 'x'.repeat(45),Expiration:new Date(now+900000)},
   ...responseChange};
 }};
 const x=createR170OidcStsExchange({sts,commands:{AssumeRoleWithWebIdentityCommand},
  roleArn,region:'eu-west-1',ownerId,repoId,subjectMode,env,clock,
  allowExternalCalls:true});
 return{x,observed};
}
test('R170 STS OIDC exchange validates signed JWT shape, exact source and 15min temporary STS identity',async()=>{
 const f=setup();
 const verified=await f.x.exchange({idToken:token(),commit});
 assert.equal(verified.awsStsResponseAccepted,true);
 assert.equal(verified.productionAuthorized,false);
 assert.equal(verified.credentials.expiration.getTime(),now+900000);
 assert.equal(f.observed[0].DurationSeconds,900);
 assert.equal(f.observed[0].RoleArn,roleArn);
 assert.equal('idToken' in verified,false);
 assert.equal(verified.oidcJwtSha256.length,64);
});
test('R170 rejects wrong ref, audience, repository IDs, SHA, unsigned algorithms, expired JWT BEFORE AWS',async()=>{
 const invalid=[token({aud:'fake'}),token({sha:'b'.repeat(40)}),
  token({repository_id:'234'}),token({ref:'refs/heads/main'}),
  token({exp:Math.floor(now/1000)-5}),
  token({}, {alg:'none'}),token({}, {jku:'https://evil.example'})];
 for(const idToken of invalid){
  const f=setup();
  await assert.rejects(f.x.exchange({idToken,commit}),/R170 OIDC/);
  assert.equal(f.observed.length,0);
 }
 assert.equal(inspectR170UnverifiedGitHubJwt({
  jwt:token(),expectedSubject,ownerId,repoId,commit,clock
 }).signatureVerifiedLocally,false);
});
test('R170 rejects forged AWS response, long credentials and nonmanual invocation',async()=>{
 for(const change of [{Audience:'evil'},
  {SubjectFromWebIdentityToken:'repo:evil'},
  {AssumedRoleUser:{Arn:'arn:aws:sts::111122223333:assumed-role/evil/run'}},
  {Credentials:{AccessKeyId:'ASIA'+'A'.repeat(16),
   SecretAccessKey:'B'.repeat(40),SessionToken:'x'.repeat(60),
   Expiration:new Date(now+4000000)}}]){
  await assert.rejects(setup(change).x.exchange({idToken:token(),commit}),/R170 OIDC/);
 }
 const f=createR170OidcStsExchange({
  sts:{send:async()=>{throw Error('network should not run');}},
  commands:{AssumeRoleWithWebIdentityCommand},roleArn,region:'eu-west-1',
  ownerId,repoId,env,clock});
 await assert.rejects(f.exchange({idToken:token(),commit}),/network disabled/);
});
