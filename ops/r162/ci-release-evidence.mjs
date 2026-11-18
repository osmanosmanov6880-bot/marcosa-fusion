/**
 * Generate/verify reproducible CI source evidence (not independent signing).
 * Write only into the GitHub runner temporary directory, never the repository.
 */
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR162Evidence,verifyR162Evidence} from './release-evidence.mjs';

const fail=m=>{throw Error('R162 CI evidence: '+m);};
const repo='osmanosmanov6880-bot/marcosa-fusion';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!==repo||
 !process.env.GITHUB_SHA||!process.env.RUNNER_TEMP)
 fail('only the trusted synthetic GitHub checkout may generate proof');
const root=process.cwd();
const commit=process.env.GITHUB_SHA.toLowerCase();
const evidence=await buildR162Evidence({root,repo,commit});
const path=join(process.env.RUNNER_TEMP,'marcosa-r162-local-source-evidence.json');
await writeFile(path,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
const reopened=JSON.parse(await readFile(path,'utf8'));
const verified=await verifyR162Evidence(reopened,{root,repo,commit});
if(!verified.matchingLocalCheckout||verified.productionAuthorized!==false)
 fail('local source evidence did not survive independent readback');
console.log('R162_COMPLETE_LOCAL_SOURCE_SHA256_VERIFIED=PASS');
console.log('R162_EVIDENCE_SHA256='+verified.sha256);
console.log('R162_INDEPENDENT_REVIEW_AND_REMOTE_DEPLOYMENT=NO_GO');
