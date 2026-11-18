import test from 'node:test';
import assert from 'node:assert/strict';
import {createR162IncidentLedger,verifyR162IncidentSnapshot} from '../r162/incident-ledger.mjs';
test('R162 privacy-safe hash chain refuses arbitrary user or secret fields',()=>{
 const l=createR162IncidentLedger({clock:()=>1800000000000});
 l.append({event:'staging_start',phase:'boot',result:'ok'});
 l.append({event:'preflight_denied',phase:'recovery',result:'deny'});
 const exported=l.snapshot();
 const verified=l.verify(exported.head);
 assert.equal(verified.consistent,true);
 assert.equal(verified.independentlyAnchored,true);
 assert.equal(exported.entries.length,2);
 assert.equal(exported.productionAuthorized,false);
 for(const extra of [
  {event:'staging_start',phase:'boot',result:'ok',email:'test@example.com'},
  {event:'staging_start',phase:'boot',result:'ok',apiKey:'secret'},
  {event:'free-form event',phase:'boot',result:'ok'}
 ])assert.throws(()=>l.append(extra),/only non-PII|unknown event/);
 assert.doesNotMatch(JSON.stringify(exported),/test@example|secret|token/);
});
test('R162 chain catches row tamper, dropped tail and external head mismatch',()=>{
 const ledger=createR162IncidentLedger({clock:()=>1800000000100});
 ledger.append({event:'staging_start',phase:'boot',result:'ok'});
 ledger.append({event:'restore_verified',phase:'verification',result:'ok'});
 const s=ledger.snapshot(),tampered=structuredClone(s);
 tampered.entries[0].event='staging_rollback';
 assert.throws(()=>verifyR162IncidentSnapshot(tampered),/tampered/);
 const removed=structuredClone(s);removed.entries.pop();
 assert.throws(()=>verifyR162IncidentSnapshot(removed),/inconsistent/);
 assert.throws(()=>ledger.verify('f'.repeat(64)),/anchored head mismatch/);
});
test('R162 bounded retention preserves verifiable hash head and monotonic sequence',()=>{
 let time=100000;const l=createR162IncidentLedger({clock:()=>time,limit:4});
 for(let i=0;i<14;i++){time-=10;l.append({event:'staging_drain',
  phase:'shutdown',result:'ok'});}
 const s=l.snapshot();
 assert.equal(s.entries.length,4);
 assert.equal(s.entries.at(-1).seq,14);
 assert.equal(l.verify(s.head).retained,4);
 assert.equal(s.entries.at(-1).at,100000);
 assert.equal(s.productionAuthorized,false);
});
