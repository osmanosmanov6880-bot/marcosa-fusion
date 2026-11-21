/** Synthetic only: fixtures for genuine cryptographic verification.
 * No external provider calls, no private key retained after scenario. */
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign,X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectR191GithubReviews} from './review-chronology.mjs';
import {inspectR191TlsCertificate} from './tls-certificate.mjs';
import {verifyR191PinnedReviewers} from './trusted-reviewers.mjs';
import {inspectR191AwsDenials} from './aws-denial-audit.mjs';
import {createR191PortableEvidence} from './portable-evidence.mjs';
import {r190ReviewMessage} from '../r190/human-signatures.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const roles=['SECURITY','OPERATIONS','PRIVACY'];
const users=[201,301,401];
export function createR191PublicCert(){
 const dir=mkdtempSync(join(tmpdir(),'r191-disposable-tls-'));
 try{
  const path=join(dir,'leaf.pem'),privateKey=join(dir,'private.key');
  execFileSync('openssl',['req','-x509','-newkey','ed25519','-nodes',
   '-days','2','-keyout',privateKey,'-out',path,
   '-subj','/CN=staging.example.com',
   '-addext','subjectAltName=DNS:staging.example.com'],
   {stdio:'ignore',timeout:15000});
  return new X509Certificate(readFileSync(path)).raw;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
export function reviewFixture({commit,now,changeHead=false,oldReview=false,
 unapproved=false,requestChanges=false,badAuthor=false}={}){
 let seenHead=0;
 const reviewerIds=Object.fromEntries(roles.map((role,i)=>[role,users[i]]));
 const reviewers=roles.map((role,i)=>({
  id:i+10,user:{id:users[i],login:'user'+users[i],type:'User'},
  state:unapproved&&i===0?'COMMENTED':'APPROVED',
  commit_id:oldReview&&i===0?'e'.repeat(40):commit,
  submitted_at:new Date(now-5000).toISOString()
 }));
 if(requestChanges)reviewers.push({id:50,user:{id:999,login:'otheruser',type:'User'},
  state:'CHANGES_REQUESTED',commit_id:commit,
  submitted_at:new Date(now-1000).toISOString()});
 const baseUrl='https://api.github.com/repos/'+REPO;
 const f=async url=>{
  let result;
  if(url===baseUrl+'/pulls/168'){
   seenHead++;
   result={number:168,state:'open',draft:false,
    head:{sha:changeHead&&seenHead>1?'f'.repeat(40):commit,
     ref:BRANCH,repo:{full_name:REPO}},
    base:{ref:BASE,repo:{full_name:REPO}},
    user:{id:badAuthor?201:100,type:'User'}};
  }else if(url===baseUrl+'/commits/'+commit)
   result={sha:commit,commit:{committer:{
    date:new Date(now-10000).toISOString()},verification:{verified:true}}};
  else if(url.includes('/reviews?'))result=reviewers;
  else throw Error('unexpected GitHub fixture URL');
  return {status:200,redirected:false,url,
   headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(result)};
 };
 return{fetchImpl:f,reviewerIds};
}
export function awsFixtureConfig(){
 const make=(id,profile,bucket)=>({
  accountId:id,profile,region:'eu-west-1',
  roleArn:'arn:aws:iam::'+id+':role/marcosa-r178-readonly-auditor',
  kmsKeyArn:'arn:aws:kms:eu-west-1:'+id+
   ':key/00000000-0000-0000-0000-000000000001',
  s3ObjectArn:'arn:aws:s3:::'+bucket+'/r191-proof.json'
 });
 return{source:make('111111111111','r191_source_mock','r191-source-disposable'),
  offsite:make('222222222222','r191_offsite_mock','r191-offsite-disposable')};
}
export function awsFixtureExecutor({allowAction=null,foreignCaller=false,
 truncate=false}={}){
 return async({profile,service,operation,params})=>{
  const id=profile==='r191_source_mock'?'111111111111':'222222222222';
  if(service==='sts'&&operation==='get-caller-identity')return{json:{
   Account:foreignCaller?'333333333333':id,
   Arn:'arn:aws:sts::'+id+
    ':assumed-role/marcosa-r178-readonly-auditor/disposable-fixture'}};
  if(service==='iam'&&operation==='simulate-principal-policy')return{json:{
   IsTruncated:truncate,
   EvaluationResults:params.ActionNames.map(name=>({
    EvalActionName:name,
    EvalDecision:name===allowAction?'allowed':'explicitDeny'
   }))
  }};
  throw Error('unexpected AWS mutation or endpoint');
 };
}
export async function buildR191Fixture({
 commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 now=Date.now(),certDer=createR191PublicCert()
}={}){
 const clock=()=>now;
 const {fetchImpl,reviewerIds}=reviewFixture({commit,now});
 const github=await inspectR191GithubReviews({
  commit,bundleSha256,reviewerIds,fetchImpl,
  sourceMode:'CI_FIXTURE',allowNetwork:true,clock
 });
 const tls=await inspectR191TlsCertificate({
  commit,bundleSha256,hostname:'staging.example.com',
  expectedLeafFingerprintSha256:sha(certDer),
  resolveAddresses:async()=>[{family:4,address:'8.8.8.8'}],
  dial:async()=>({authorized:true,peerCertificate:{raw:certDer}}),
  sourceMode:'CI_FIXTURE',allowNetwork:true,clock
 });
 const packet={sourceCommit:commit,bundleSha256,
  githubEvidenceSha256:github.evidenceSha256,
  tlsEvidenceSha256:tls.evidenceSha256,
  nonce:sha('r191-fixture:'+commit+':'+now).slice(0,32),
  issuedAtMs:now-1000,expiresAtMs:now+60000};
 const keys=[],registryReviewers=[],signatures=[];
 for(let i=0;i<3;i++){
  const role=roles[i],pair=generateKeyPairSync('ed25519');
  const der=pair.publicKey.export({format:'der',type:'spki'});
  const signerId='person_'+(i+1)+'_fixture';
  keys.push(pair);
  registryReviewers.push({
   role,githubUserId:users[i],githubLogin:'user'+users[i],signerId,
   publicKeySpkiBase64:der.toString('base64'),
   keyFingerprintSha256:sha(der)
  });
  signatures.push({role,signerId,
   signatureBase64url:sign(null,r190ReviewMessage(packet),
    pair.privateKey).toString('base64url')});
 }
 const registryBytes=Buffer.from(JSON.stringify({
  schemaVersion:1,repository:REPO,pullRequest:168,sourceCommit:commit,
  issuedAtMs:now-2000,expiresAtMs:now+60000,reviewers:registryReviewers
 })+'\n');
 const registrySha256=sha(registryBytes);
 const identities=verifyR191PinnedReviewers({registryBytes,
  expectedRegistrySha256:registrySha256,github,packet,signatures,
  bundleSha256,commit,clock});
 const {source,offsite}=awsFixtureConfig();
 const aws=await inspectR191AwsDenials({
  commit,bundleSha256,source,offsite,
  executeAws:awsFixtureExecutor(),clock,allowNetwork:true,
  sourceMode:'CI_FIXTURE'
 });
 const portable=createR191PortableEvidence({commit,bundleSha256,
  github,identities,tls,aws,clock});
 return Object.freeze({github,tls,identities,aws,packet,signatures,
  registryBytes,registrySha256,certDer,portable,commit,bundleSha256,now});
}
