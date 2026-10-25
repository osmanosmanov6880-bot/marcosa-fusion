import {readFileSync,writeFileSync} from 'node:fs';
const KEYS=['supabaseProject','authRls','privateStorage','stagingHttps','sshHostVerified','backupsRestored','moderationLegal','paymentReconciliation','realBetaRetention','securityAudit'];
export function evaluateReleaseEvidence(evidence){
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))throw Error('Evidence must be an object');
 const checks=KEYS.map(key=>{
  const value=evidence[key];
  const valid=value&&typeof value==='object'&&!Array.isArray(value)
   &&value.passed===true&&typeof value.reference==='string'
   &&/^https:\/\/[^\s]+$/.test(value.reference)
   &&typeof value.verifiedAt==='string'&&!Number.isNaN(Date.parse(value.verifiedAt));
  return{key,passed:!!valid,reference:valid?value.reference:null};
 });
 const missing=checks.filter(x=>!x.passed).map(x=>x.key);
 return{productionReady:missing.length===0,mode:'fail-closed',missing,checks,
  warning:'References are self-reported; independent inspection of artifacts and operator authorization still required.'};
}
if(process.argv[1]&&process.argv[1].endsWith('release-evidence-gate.mjs')){
 try{
  if(process.argv.length!==3)throw Error('Usage: node ops/release-evidence-gate.mjs EVIDENCE.json');
  const result=evaluateReleaseEvidence(JSON.parse(readFileSync(process.argv[2],'utf8')));
  console.log(JSON.stringify(result,null,2));
  if(!result.productionReady)process.exitCode=2;
 }catch(err){console.error('MARCOSA RELEASE BLOCKED: '+err.message);process.exitCode=1;}
}
