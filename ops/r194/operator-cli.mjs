#!/usr/bin/env node
/**
 * Offline operator CLI. Uses previously collected R193 evidence.json files.
 * Creates an interactive HTML and Markdown comparison, without network or
 * provider secrets. NEVER grants live staging or production authorization.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {requireTrue,H40,H64,verifyReceipt} from '../r190/common.mjs';
import {createR194TaskLedger} from './task-ledger.mjs';
import {compareR194Evidence} from './evidence-delta.mjs';
import {compareR194Readiness} from './risk-trend.mjs';
import {renderR194Interactive} from './interactive-dashboard.mjs';
const opts=['--before','--after','--out'];
function validName(x){return typeof x==='string'&&
 /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,79}$/.test(x)&&
 !x.includes('..');}
async function readR193(filename){
 requireTrue(validName(filename)&&filename.endsWith('.json'),
  'R193 input filenames must be plain local JSON names');
 let bytes;
 try{bytes=await readFile(resolve(process.cwd(),filename));}
 catch{throw Error('R194: cannot read prior R193 evidence');}
 requireTrue(bytes.length>=1000&&bytes.length<=200000,
  'bounded R193 read-only evidence file required');
 let x;
 try{x=JSON.parse(bytes.toString('utf8'));}
 catch{throw Error('R194: malformed R193 evidence JSON');}
 requireTrue(x&&typeof x==='object'&&
  Object.keys(x).sort().join(',')===
  'assessment,github,intake,productionAuthorized,realPilotAuthorized'&&
  x.productionAuthorized===false&&x.realPilotAuthorized===false,
  'R193 report must be explicit fail-closed evidence file');
 const commit=x.assessment?.sourceCommit;
 const bundleSha256=x.assessment?.sourceBundleSha256;
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||''),
  'source commit and tree sha are mandatory');
 for(const [v,k] of [[x.github,'R193_GITHUB'],[x.intake,'R193_INTAKE'],
  [x.assessment,'R193_ASSESSMENT']])
  verifyReceipt(v,k,commit,bundleSha256);
 requireTrue(x.assessment.githubEvidenceSha256===x.github.evidenceSha256&&
  x.assessment.intakeEvidenceSha256===x.intake.evidenceSha256,
  'R193 report has mismatched source-proof hashes');
 return x;
}
export async function runR194Cli({
 argv=process.argv.slice(2),clock=()=>Date.now(),output=console.log
}={}){
 if(argv.length===1&&argv[0]==='--help'){
  output('node ops/r194/operator-cli.mjs --before earlier.json --after newer.json --out r194-audit');
  output('Both inputs are immutable R193 evidence.json copies from the same source commit.');
  output('No network, tokens, real approval, or remote deployment.');
  return {help:true};
 }
 requireTrue(argv.length===6,'R194 requires three flag/value options');
 const given={};
 for(let i=0;i<argv.length;i+=2){
  requireTrue(opts.includes(argv[i])&&!Object.hasOwn(given,argv[i]),
   'unknown or duplicate CLI options');
  given[argv[i]]=argv[i+1];
 }
 requireTrue(opts.every(k=>typeof given[k]==='string')&&
  given['--before']!==given['--after']&&
  validName(given['--out'])&&!given['--out'].includes('.'),
  'two distinct source files and a safe output folder required');
 const before=await readR193(given['--before']);
 const after=await readR193(given['--after']);
 const commit=after.assessment.sourceCommit;
 const bundleSha256=after.assessment.sourceBundleSha256;
 requireTrue(before.assessment.sourceCommit===commit&&
  before.assessment.sourceBundleSha256===bundleSha256,
  'source changed between operator snapshots');
 const now=clock();
 const evidenceDelta=compareR194Evidence({commit,bundleSha256,
  before:before.intake,after:after.intake,clock:()=>now});
 const riskTrend=compareR194Readiness({commit,bundleSha256,
  before:before.assessment,after:after.assessment,clock:()=>now});
 const ledger=createR194TaskLedger({commit,bundleSha256,
  assessment:after.assessment,clock:()=>now});
 const rendered=renderR194Interactive({commit,bundleSha256,
  assessment:after.assessment,ledger,evidenceDelta,riskTrend});
 const folder=resolve(process.cwd(),given['--out']);
 await mkdir(folder,{recursive:false,mode:0o700});
 for(const [name,contents] of [
  ['index.html',rendered.html],
  ['report.md',rendered.markdown],
  ['evidence.json',JSON.stringify({schemaVersion:1,
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   beforeAssessment:before.assessment,afterAssessment:after.assessment,
   beforeIntake:before.intake,afterIntake:after.intake,
   ledger,evidenceDelta,riskTrend,
   decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
   productionAuthorized:false,realPilotAuthorized:false},null,2)+'\n']
 ])await writeFile(join(folder,name),contents,{flag:'wx',mode:0o600});
 output('R194 offline interactive Audit Desk: '+given['--out']+'/index.html');
 output('NO_GO: local task completion is never a release approval.');
 return Object.freeze({path:folder,decision:'NO_GO',productionAuthorized:false});
}
if(import.meta.url==='file://'+process.argv[1]){
 try{await runR194Cli();}
 catch(e){console.error('R194 operator CLI refused: '+String(e?.message||e));process.exitCode=1;}
}
