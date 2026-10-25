#!/usr/bin/env node
/**
 * MARCOSA R48: read-only release evidence checker.
 * A passing result is NEVER authorization to deploy.
 * No network calls, no secrets, no SSH, no production database writes.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPOSITORY='osmanosmanov6880-bot/marcosa-fusion';
export const STAGING=[
 'ssh_host_key_verified_out_of_band',
 'https_tls',
 'staging_isolation',
 'least_privilege_deploy',
 'rollback_drill',
 'restore_drill'
];
export const BETA=[
 ...STAGING,
 'existing_supabase_project',
 'auth_verified_email_and_recovery',
 'rls_real_jwt_isolation',
 'moderation_appeal_privacy',
 'data_export_deletion',
 'invite_closed_beta',
 'privacy_consent',
 'incident_response'
];
export const PUBLIC=[
 ...BETA,
 'mobile_accessibility_audit',
 'load_and_resilience_test',
 'legal_privacy_terms_review',
 'advertiser_legal_verification',
 'verified_ad_delivery',
 'payment_refunds_and_ledger',
 'real_beta_cohort_evidence',
 'independent_security_review'
];
export const PROFILES=Object.freeze({staging:STAGING,beta:BETA,public:PUBLIC});
const forbiddenKey=/^(password|secret|service_?role|api_?key|private_?key|access_?token|refresh_?token|authorization|cookie|ssh_?private|credentials)$/i;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exactKeys=(o,keys)=>plain(o)&&Object.keys(o).every(k=>keys.includes(k));
const err=(message)=>({ok:false,message});
const good=()=>({ok:true});
const shaRe=/^[0-9a-f]{40}$/i;
function inspectForSecrets(value,path=''){
 if(Array.isArray(value))return value.map((v,i)=>inspectForSecrets(v,path+'/'+i)).flat();
 if(!plain(value))return [];
 return Object.entries(value).flatMap(([key,val])=>[
  ...(forbiddenKey.test(key)?[path+'/'+key]:[]),
  ...inspectForSecrets(val,path+'/'+key)
 ]);
}
function isSafeArtifact(uri){
 if(typeof uri!=='string'||uri.length<15||uri.length>400)return false;
 try{
  const u=new URL(uri);
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return false;
  if(!/^[a-z0-9.-]+$/.test(host)||!host.includes('.'))return false;
  if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal'))return false;
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)||host==='0.0.0.0')return false;
  if(u.pathname.length<2)return false;
  return true;
 }catch{return false;}
}
function checkProof(value,nowMs,ttlDays){
 if(!exactKeys(value,['status','artifact','checkedAt','reviewer']))return err('invalid proof fields');
 if(value.status!=='verified')return err('not verified');
 if(!isSafeArtifact(value.artifact))return err('unsafe or missing https artifact');
 if(typeof value.reviewer!=='string'||!/^.{3,80}$/.test(value.reviewer.trim()))return err('missing reviewer');
 if(typeof value.checkedAt!=='string'||!/\d{4}-\d\d-\d\dT/.test(value.checkedAt))return err('missing ISO review timestamp');
 const t=Date.parse(value.checkedAt);
 if(!Number.isFinite(t)||t>nowMs+300000)return err('future or invalid review timestamp');
 if(t<nowMs-ttlDays*86400000)return err('evidence expired; reverify before launch');
 return good();
}
export function evaluate(evidence,{profile='staging',sha,now=Date.now()}={}){
 const required=PROFILES[profile];
 if(!required)return {decision:'BLOCKED',profile,errors:['unknown release profile'],passed:[],missing:[]};
 const errors=[];
 if(!plain(evidence))return{decision:'BLOCKED',profile,errors:['evidence must be an object'],passed:[],missing:[...required]};
 if(!exactKeys(evidence,['schemaVersion','repository','commit','proofs','approval']))
  errors.push('unexpected top-level evidence fields');
 if(evidence.schemaVersion!==1)errors.push('unsupported evidence schema');
 if(evidence.repository!==REPOSITORY)errors.push('wrong repository');
 if(!shaRe.test(evidence.commit||''))errors.push('evidence SHA must be a full commit');
 if(sha!==undefined&&evidence.commit!==sha)errors.push('evidence SHA does not match selected release commit');
 if(!plain(evidence.proofs))errors.push('proofs must be an object');
 const secrets=inspectForSecrets(evidence);
 if(secrets.length)errors.push('sensitive fields forbidden in evidence JSON: '+secrets.join(', '));
 const passed=[],missing=[];
 for(const id of required){
  const proof=plain(evidence.proofs)?evidence.proofs[id]:undefined;
  const result=checkProof(proof,now,id==='ssh_host_key_verified_out_of_band'||id==='https_tls'?30:90);
  if(result.ok)passed.push(id);else missing.push({id,reason:result.message});
 }
 // A separate human signoff is required no matter how many machine-readable
 // links were entered: the tool cannot independently authenticate reviewers.
 const approval=plain(evidence.approval)?evidence.approval:{};
 if(approval.status==='approved')errors.push('self-declared approval is not a deployment authorization');
 if(approval.status!=='pending')errors.push('approval must stay pending; a human release owner must sign off outside this checker');
 return {
  decision:errors.length||missing.length?'BLOCKED':'READY_FOR_INDEPENDENT_REVIEW',
  profile,repository:REPOSITORY,commit:evidence.commit||null,
  passingProofs:passed.length,requiredProofs:required.length,
  passed,missing,errors,
  productionAuthorized:false,
  disclaimer:'Links and names are self-attested. The validator never authenticates evidence or authorizes deployment.'
 };
}
function parseArgs(argv){
 const parsed={profile:'staging',evidence:'ops/release-evidence.json'};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(!['--profile','--evidence','--sha'].includes(arg)||!argv[i+1])throw Error('Invalid flag '+arg);
  parsed[arg.slice(2)]=argv[++i];
 }
 return parsed;
}
const current=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(current){
 try{
  const args=parseArgs(process.argv.slice(2));
  const input=JSON.parse(readFileSync(resolve(args.evidence),'utf8'));
  const report=evaluate(input,{profile:args.profile,sha:args.sha});
  console.log(JSON.stringify(report,null,2));
  if(report.decision==='BLOCKED')process.exitCode=2;
 }catch(error){
  console.error(JSON.stringify({decision:'BLOCKED',productionAuthorized:false,error:String(error.message||error)}));
  process.exitCode=2;
 }
}
