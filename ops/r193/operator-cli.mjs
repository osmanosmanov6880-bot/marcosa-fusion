#!/usr/bin/env node
/** Operator-readonly CLI. Run with explicit R193_ALLOW_NETWORK=1. No secrets
 * or PII in output. Never issues launch authorization.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {observeR193Github} from './github-observer.mjs';
import {ingestR193Evidence} from './evidence-intake.mjs';
import {assessR193Readiness} from './assessment.mjs';
import {renderR193Dashboard} from './dashboard.mjs';
import {H40,H64,requireTrue} from '../r190/common.mjs';
const help=[
 'MARCOSA R193 — read-only audit desk',
 'node ops/r193/operator-cli.mjs --commit SHA40 --bundle SHA64',
 '  --run GITHUB_RUN_ID --security USER_ID --operations USER_ID',
 '  --privacy USER_ID --evidence ./evidence.json --out r193-audit',
 'Requires R193_ALLOW_NETWORK=1 for real GitHub read-only GET;',
 'optional GITHUB_TOKEN (read-only token recommended).',
 'Evidence file format: {"records":[{"control":"TLS_ORIGIN",',
 '"sourceCommit":"...","artifactSha256":"...","authority":',
 '"OPERATOR_OBSERVED_UNVERIFIED","claim":"PASS_CLAIM",',
 '"observedAtMs":1234,"expiresAtMs":5678}]}',
 'All claims remain NO-GO until independently verified.'
].join('\n');
function parse(argv){
 if(argv.includes('--help'))return {help:true};
 const allowed=new Set(['--commit','--bundle','--run','--security',
  '--operations','--privacy','--evidence','--out']);
 requireTrue(argv.length>0&&argv.length%2===0,'CLI options must be flag/value pairs');
 const o={};
 for(let i=0;i<argv.length;i+=2){
  requireTrue(allowed.has(argv[i])&&!(argv[i] in o),'unsupported or duplicate CLI option');
  o[argv[i]]=argv[i+1];
 }
 requireTrue(H40.test(o['--commit']||'')&&H64.test(o['--bundle']||'')&&
  /^\d{5,15}$/.test(o['--run']||'')&&
  ['--security','--operations','--privacy'].every(k=>/^\d{1,15}$/.test(o[k]||'')),
  'exact source, run and reviewer numeric IDs required');
 const out=o['--out']||'r193-audit';
 const filename=o['--evidence']||'r193-evidence.json';
 requireTrue(/^[A-Za-z0-9_-]{1,40}$/.test(out)&&
  /^[A-Za-z0-9_.-]{1,80}\.json$/.test(filename)&&
  filename!=='.'&&!filename.includes('..'),
  'safe local report name and evidence filename required');
 return {commit:o['--commit'],bundleSha256:o['--bundle'],
  runId:Number(o['--run']),reviewerIds:{
   SECURITY:Number(o['--security']),
   OPERATIONS:Number(o['--operations']),
   PRIVACY:Number(o['--privacy'])},
  file:filename,out};
}
export async function runR193Cli({
 argv=process.argv.slice(2),env=process.env,
 output=console.log,now=()=>Date.now()
}={}){
 const opt=parse(argv);
 if(opt.help){output(help);return {help:true};}
 requireTrue(env.R193_ALLOW_NETWORK==='1',
  'live read-only GitHub inspection requires R193_ALLOW_NETWORK=1');
 let data;
 try{data=JSON.parse(await readFile(resolve(process.cwd(),opt.file),'utf8'));}
 catch{throw Error('R193: evidence file missing or not JSON');}
 requireTrue(data&&Object.getPrototypeOf(data)===Object.prototype&&
  Object.keys(data).join(',')==='records'&&
  Array.isArray(data.records),'operator evidence file must contain only records array');
 const clock=now;
 const github=await observeR193Github({
  commit:opt.commit,bundleSha256:opt.bundleSha256,
  runId:opt.runId,reviewerIds:opt.reviewerIds,
  token:env.GITHUB_TOKEN,
  sourceMode:'OPERATOR_READONLY_UNATTESTED',
  allowNetwork:true,clock});
 const intake=ingestR193Evidence({
  commit:opt.commit,bundleSha256:opt.bundleSha256,
  records:data.records,
  sourceMode:'OPERATOR_OBSERVED_UNVERIFIED',clock});
 const assessment=assessR193Readiness({
  commit:opt.commit,bundleSha256:opt.bundleSha256,github,intake,clock});
 const report=renderR193Dashboard({assessment,commit:opt.commit,
  bundleSha256:opt.bundleSha256});
 const dir=resolve(process.cwd(),opt.out);
 await mkdir(dir,{recursive:false,mode:0o700});
 await Promise.all([
  writeFile(join(dir,'index.html'),report.html,{flag:'wx',mode:0o600}),
  writeFile(join(dir,'report.md'),report.markdown,{flag:'wx',mode:0o600}),
  writeFile(join(dir,'evidence.json'),JSON.stringify({
   github,intake,assessment,realPilotAuthorized:false,
   productionAuthorized:false},null,2)+'\n',{flag:'wx',mode:0o600})
 ]);
 output('R193 offline audit written: '+opt.out+'/index.html');
 output('Decision: NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED');
 return Object.freeze({decision:assessment.decision,reportDirectory:dir});
}
if(import.meta.url==='file://'+process.argv[1]){
 try{await runR193Cli();}
 catch(e){console.error('R193 audit refused: '+String(e?.message||e));process.exitCode=1;}
}
