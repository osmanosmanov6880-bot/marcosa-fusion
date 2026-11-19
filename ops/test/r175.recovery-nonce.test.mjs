import test from 'node:test';
import assert from 'node:assert/strict';
import {r175RecoveryNonceSql,createR175RecoveryNonce}
 from '../r175/recovery-nonce.mjs';
const input={nonce:'a'.repeat(32),sequence:1,anchorSha256:'b'.repeat(64),
 archiveSha256:'c'.repeat(64),commit:'d'.repeat(40)};
test('R175 SQL uses SERIALIZABLE source snapshot and atomic lease/audit CTE',()=>{
 const s=r175RecoveryNonceSql(input);
 assert.match(s,/FOR SHARE/);
 assert.match(s,/ON CONFLICT DO NOTHING/);
 assert.match(s,/INSERT INTO r175_ci.recovery_audit/);
 assert.match(s,/SET LOCAL ROLE marcosa_r175_writer/);
 for(const q of [{nonce:'wrong'},{sequence:0},
  {archiveSha256:"' OR true--"},{commit:'bad'}])
 assert.throws(()=>r175RecoveryNonceSql({...input,...q}),/R175 recovery nonce/);
});
test('R175 accepts 1|1 once and rejects replay and incomplete audit',async()=>{
 let n=0;
 const fence=createR175RecoveryNonce({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 const p=await fence.consume(input);
 assert.equal(p.consumedExactlyOnce,true);
 assert.equal(p.productionAuthorized,false);
 await assert.rejects(fence.consume(input),/R175 recovery nonce/);
 await assert.rejects(createR175RecoveryNonce({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).consume(input),/R175 recovery nonce/);
});
test('R175 rejects database outage without issuing restore authority',async()=>{
 const f=createR175RecoveryNonce({
  executeSql:async()=>{throw Error('backend unavailable');}
 });
 await assert.rejects(f.consume(input),/atomic PostgreSQL lease rejected/);
});
