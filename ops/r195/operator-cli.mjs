#!/usr/bin/env node
/**
 * R195 single-input CLI consumes R194 read-only combined evidence.json and
 * atomically creates offline mobile Audit Desk and six owner-specific packets.
 * No tokens, network access, persistent browser data or actual approvals.
 */
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {H40,H64,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {renderR195Dashboard} from './dashboard.mjs';
import {compareR194Evidence} from '../r194/evidence-delta.mjs';
import {compareR194Readiness} from '../r194/risk-trend.mjs';
import {verifyR194TaskLedger} from '../r194/task-ledger.mjs';
const filename=x=>typeof x==='string'&&/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,78}\.json$/.test(x)&&!x.includes('..');
const foldername=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,48}$/.test(x);
export async function runR195Cli({argv=process.argv.slice(2),
 clock=()=>Date.now(),output=console.log}={}){
 if(argv.length===1&&argv[0]==='--help'){
  output('node ops/r195/operator-cli.mjs --input r194-evidence.json --out r195-audit');
  output('Offline verified comparison; no access to GitHub, AWS or production.');
  return {help:true};
 }
 requireTrue(argv.length===4&&new Set([argv[0],argv[2]]).size===2&&
  [argv[0],argv[2]].every(x=>['--input','--out'].includes(x)),
  'R195 expects --input and --out');
 const cfg={};cfg[argv[0]]=argv[1];cfg[argv[2]]=argv[3];
 requireTrue(filename(cfg['--input'])&&foldername(cfg['--out']),
  'safe input JSON filename and output directory required');
 let buf;
 try{buf=await readFile(resolve(process.cwd(),cfg['--input']));}
 catch{throw Error('R195: previous R194 evidence.json not available');}
 requireTrue(buf.length>=2000&&buf.length<=200000,
  'bounded R194 evidence JSON required');
 let p;
 try{p=JSON.parse(buf.toString('utf8'));}
 catch{throw Error('R195: malformed R194 evidence JSON');}
 const required=['schemaVersion','sourceCommit','sourceBundleSha256',
  'beforeAssessment','afterAssessment','beforeIntake','afterIntake',
  'ledger','evidenceDelta','riskTrend','decision',
  'productionAuthorized','realPilotAuthorized'];
 requireTrue(p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).sort().join(',')===required.slice().sort().join(',')&&
  p.schemaVersion===1&&H40.test(p.sourceCommit||'')&&
  H64.test(p.sourceBundleSha256||'')&&
  p.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
  p.productionAuthorized===false&&p.realPilotAuthorized===false,
  'unexpected R194 source schema or false production authorization');
 const commit=p.sourceCommit,bundleSha256=p.sourceBundleSha256;
 for(const [x,kind] of [
  [p.beforeAssessment,'R193_ASSESSMENT'],
  [p.afterAssessment,'R193_ASSESSMENT'],
  [p.beforeIntake,'R193_INTAKE'],[p.afterIntake,'R193_INTAKE'],
  [p.ledger,'R194_TASK_LEDGER'],
  [p.evidenceDelta,'R194_EVIDENCE_DELTA'],
  [p.riskTrend,'R194_RISK_TREND']
 ])verifyReceipt(x,kind,commit,bundleSha256);
 const at=clock();
 requireTrue(Number.isSafeInteger(at)&&
  at>=p.afterAssessment.observedAtMs&&
  at<=p.afterAssessment.expiresAtMs,
  'current source evidence expired; request new R193 snapshots');
 requireTrue(p.beforeAssessment.intakeEvidenceSha256===p.beforeIntake.evidenceSha256&&
  p.afterAssessment.intakeEvidenceSha256===p.afterIntake.evidenceSha256,
  'assessment does not bind actual source intake');
 const evidenceDelta=compareR194Evidence({commit,bundleSha256,
  before:p.beforeIntake,after:p.afterIntake,clock:()=>p.evidenceDelta.observedAtMs});
 const riskTrend=compareR194Readiness({commit,bundleSha256,
  before:p.beforeAssessment,after:p.afterAssessment,clock:()=>p.riskTrend.observedAtMs});
 requireTrue(JSON.stringify(evidenceDelta)===JSON.stringify(p.evidenceDelta)&&
  JSON.stringify(riskTrend)===JSON.stringify(p.riskTrend),
  'R194 comparison changed since original source');
 verifyR194TaskLedger({ledger:p.ledger,assessment:p.afterAssessment,
  commit,bundleSha256});
 const result=renderR195Dashboard({commit,bundleSha256,
  assessment:p.afterAssessment,ledger:p.ledger,
  evidenceDelta,riskTrend});
 const root=process.cwd();
 const out=resolve(root,cfg['--out']);
 const staging=resolve(root,'.'+cfg['--out']+'-partial-'+process.pid);
 await mkdir(staging,{recursive:false,mode:0o700});
 try{
  await mkdir(join(staging,'handoffs'),{mode:0o700});
  const entries=[
   ['index.html',result.html],['report.md',result.markdown],
   ['handoffs/manifest.json',JSON.stringify({
     ...result.handoffs.manifest,
     manifestSha256:result.handoffManifestSha256
   },null,2)+'\n']
  ];
  for(const handoff of result.handoffs.byOwner){
   entries.push(['handoffs/'+handoff.owner+'.md',handoff.markdown]);
   entries.push(['handoffs/'+handoff.owner+'.csv','\ufeff'+handoff.csv]);
  }
  for(const [path,contents] of entries)
   await writeFile(join(staging,path),contents,{flag:'wx',mode:0o600});
  await rename(staging,out);
 }catch(err){
  await rm(staging,{recursive:true,force:true});
  throw err;
 }
 output('R195 interactive mobile Audit Desk: '+cfg['--out']+'/index.html');
 output('Owner handoffs: '+cfg['--out']+'/handoffs/');
 output('Release status remains NO-GO; no production or real pilot clearance.');
 return Object.freeze({path:out,decision:'NO_GO',
  reportSha256:result.htmlSha256,productionAuthorized:false});
}
if(import.meta.url==='file://'+process.argv[1]){
 try{await runR195Cli();}
 catch(e){console.error('R195 CLI refused: '+String(e.message||e));process.exitCode=1;}
}
