/**
 * R193 CI fixture. All GitHub responses are mocked; no tokens, user data or
 * real staging evidence. Cryptographic Ed25519 checks use ephemeral keys.
 */
import {createHash,generateKeyPairSync} from 'node:crypto';
import {observeR193Github} from './github-observer.mjs';
import {ingestR193Evidence} from './evidence-intake.mjs';
import {assessR193Readiness} from './assessment.mjs';
import {createR193SignedPackage} from './signed-package.mjs';
const SHA=x=>createHash('sha256').update(x).digest('hex');
export function r193FixtureFetch({
 commit,runId,now=Date.now(),headDrift=false,
 reviewed=false,failedRun=false,invalidContentType=false
}={}){
 const api='https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion';
 let prReads=0;
 const transport=async(url,options)=>{
  if(options.method!=='GET'||options.redirect!=='error')
   throw Error('fixture refuses non-read-only GitHub operations');
  let doc;
  if(url===api+'/pulls/168'){
   prReads++;
   doc={number:168,state:'open',draft:false,
    head:{sha:headDrift&&prReads===2?'f'.repeat(40):commit,
     ref:'feature/marcosa-r150-growth-economics',
     repo:{full_name:'osmanosmanov6880-bot/marcosa-fusion'}},
    base:{ref:'feature/series-pilot-r149',
     repo:{full_name:'osmanosmanov6880-bot/marcosa-fusion'}},
    user:{id:111,type:'User'}};
  }else if(url===api+'/commits/'+commit){
   doc={sha:commit,commit:{verification:{verified:true}}};
  }else if(url===api+'/actions/runs/'+runId){
   doc={id:runId,head_sha:commit,
    head_branch:'feature/marcosa-r150-growth-economics',
    repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
    status:failedRun?'completed':'completed',
    conclusion:failedRun?'failure':'success',
    created_at:new Date(now-1000).toISOString()};
  }else if(url.startsWith(api+'/pulls/168/reviews?per_page=100&page=')){
   doc=reviewed?[200,300,400].map((id,i)=>({
    id:i+1,user:{id,type:'User'},state:'APPROVED',
    commit_id:commit,
    submitted_at:new Date(now-1500).toISOString()
   })):[];
  }else throw Error('unapproved fixture URL');
  return {status:200,url,redirected:false,
   headers:{get:()=>invalidContentType?'text/html':'application/json'},
   text:async()=>JSON.stringify(doc)};
 };
 return transport;
}
export async function buildR193Fixture({
 commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 runId=944044,now=Date.now(),reviewed=false,
 evidenceRecords=null,failedRun=false
}={}){
 const clock=()=>now;
 const github=await observeR193Github({commit,bundleSha256,runId,
  reviewerIds:{SECURITY:200,OPERATIONS:300,PRIVACY:400},
  fetchImpl:r193FixtureFetch({commit,runId,now,reviewed,failedRun}),
  sourceMode:'CI_FIXTURE',allowNetwork:true,clock});
 const records=evidenceRecords??[
  {control:'TLS_ORIGIN',sourceCommit:commit,
   artifactSha256:SHA('fixture:tls'),authority:'CI_FIXTURE',
   claim:'PASS_CLAIM',observedAtMs:now-1000,expiresAtMs:now+30000},
  {control:'AWS_EFFECTIVE_RIGHTS',sourceCommit:commit,
   artifactSha256:SHA('fixture:aws'),authority:'CI_FIXTURE',
   claim:'FAIL_CLAIM',observedAtMs:now-1000,expiresAtMs:now+30000}
 ];
 const intake=ingestR193Evidence({commit,bundleSha256,
  records,sourceMode:'CI_FIXTURE',clock});
 const assessment=assessR193Readiness({commit,bundleSha256,
  github,intake,clock});
 const pair=generateKeyPairSync('ed25519');
 const publicKeyDer=pair.publicKey.export({format:'der',type:'spki'});
 const signed=createR193SignedPackage({commit,bundleSha256,
  github,intake,assessment,privateKey:pair.privateKey,
  publicKeyDer,clock});
 return Object.freeze({commit,bundleSha256,github,intake,
  assessment,signed,publicKeyDer,runId,now});
}
