import test from 'node:test';
import assert from 'node:assert/strict';
import {createR169IamPlan,r169GitHubOidcSubject,verifyR169IamPlan} from '../r169/iam-plan.mjs';
const vals={accountId:'111122223333',region:'eu-west-1',
 bucketName:'marcosa-ci-locked',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
const args=()=>({...vals,expectedOidcSubject:r169GitHubOidcSubject(vals)});
test('R169 exact branch-only OIDC legacy subject and least-privilege policies',()=>{
 const p=createR169IamPlan(args());
 assert.equal(p.trustPolicy.Statement[0].Condition.StringEquals[
  'token.actions.githubusercontent.com:sub'],p.subject);
 assert.equal(p.subject,'repo:osmanosmanov6880-bot/marcosa-fusion:ref:refs/heads/feature/marcosa-r150-growth-economics');
 assert.equal(p.policyApplied,false);
 assert.equal(verifyR169IamPlan(p,args()).matched,true);
 const entries=p.permissionsPolicy.Statement;
 assert.ok(entries.every(x=>x.Resource!=='*'&&x.Action.every(a=>!a.includes('*'))));
 assert.ok(entries.some(x=>x.Effect==='Deny'&&x.Action.includes('s3:BypassGovernanceRetention')));
 assert.ok(entries.some(x=>x.Effect==='Allow'&&x.Action.includes('kms:GenerateDataKey')&&
  x.Condition.StringEquals['kms:EncryptionContext:marcosa-scope']==='isolated-staging-only'));
});
test('R169 GitHub OIDC immutable numeric-ID subject available only with explicit choice',()=>{
 const immutable={...vals,subjectMode:'immutable'};
 const sub=r169GitHubOidcSubject(immutable);
 assert.equal(sub,'repo:osmanosmanov6880-bot@340648536/marcosa-fusion@1430301644:ref:refs/heads/feature/marcosa-r150-growth-economics');
 assert.equal(createR169IamPlan({...immutable,expectedOidcSubject:sub}).subject,sub);
});
test('R169 IAM refuses production ref, wildcard principal, different sub, other account and modified policies',()=>{
 for(const patch of [
  {expectedOidcSubject:'repo:other/repo:ref:refs/heads/main'},
  {ownerId:0},{repoId:-1},{accountId:'111122223334'},
  {kmsKeyArn:vals.kmsKeyArn.replace('eu-west-1','us-east-1')},
  {bucketName:'*'},
  {subjectMode:'immutable',expectedOidcSubject:r169GitHubOidcSubject(vals)}
 ])assert.throws(()=>createR169IamPlan({...args(),...patch}),/R169 IAM plan/);
 assert.throws(()=>r169GitHubOidcSubject({...vals,ref:'refs/heads/main'}),/exact feature/);
 const plan=createR169IamPlan(args());
 plan.permissionsPolicy.Statement[0].Resource='*';
 assert.throws(()=>verifyR169IamPlan(plan,args()),/policy body/);
});
