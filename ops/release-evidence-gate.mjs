#!/usr/bin/env node
/**
 * MARCOSA R80: convenience adapter to the existing, stricter R48 gate.
 * No independent interpretation of self-reported URLs can authorize production.
 * Public profile only; requires selected exact commit SHA.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate} from './check-release-gate.mjs';

const SHA=/^[a-f0-9]{40}$/i;

export function evaluateReleaseEvidence(evidence,{sha,now=Date.now()}={}){
 if(typeof sha!=='string'||!SHA.test(sha))
  return {decision:'BLOCKED',productionAuthorized:false,productionReady:false,
   readyForIndependentReview:false,errors:['Exact reviewed commit SHA required'],missing:[]};
 const report=evaluate(evidence,{profile:'public',sha,now});
 return {...report,productionAuthorized:false,productionReady:false,
  readyForIndependentReview:report.decision==='READY_FOR_INDEPENDENT_REVIEW',
  warning:'References and reviewer identities are self-attested. No automated release authorization.'};
}

const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
 try{
  const args=process.argv.slice(2);
  if(args.length!==3||args[1]!=='--sha'||!SHA.test(args[2]))
   throw Error('Usage: node ops/release-evidence-gate.mjs EVIDENCE.json --sha EXACT40');
  const report=evaluateReleaseEvidence(JSON.parse(readFileSync(resolve(args[0]),'utf8')),{sha:args[2]});
  console.log(JSON.stringify(report,null,2));
  if(report.decision!=='READY_FOR_INDEPENDENT_REVIEW')process.exitCode=2;
 }catch(e){
  console.error(JSON.stringify({decision:'BLOCKED',productionAuthorized:false,
   productionReady:false,error:String(e.message||e)}));
  process.exitCode=2;
 }
}
