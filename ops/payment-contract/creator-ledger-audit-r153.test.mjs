import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createSandboxLedger,registerSandboxOrder,ingestSignedTestEvent} from './stripe-sandbox-contract.mjs';
import {createOfflineFinance,applyOfflineFinancialEvent} from './offline-refund-reconciliation.mjs';
import {initCreatorEarnings,attachTestCreatorShare,prepareTestReconciliation,reconcileTestBatch} from './creator-earnings-r152.mjs';
import {auditedCreatorStatement,creatorStatementCsv} from './creator-ledger-audit-r153.mjs';

const now=Date.parse('2026-10-25T12:00:00Z'),secret='whsec_r153_creator_statement_test_only';
const db=()=>{const x=new DatabaseSync(':memory:');createSandboxLedger(x);createOfflineFinance(x);initCreatorEarnings(x);return x;};
function paid(db,n,amount=10000,currency='usd'){
 const orderId='r76_statement'+n,sessionId='cs_test_statement'+n;
 registerSandboxOrder(db,{orderId,sessionId,amountMinor:amount,currency});
 const e={object:'event',id:'evt_test_statement'+n,livemode:false,type:'checkout.session.completed',
  data:{object:{object:'checkout.session',id:sessionId,client_reference_id:orderId,
   mode:'payment',status:'complete',payment_status:'paid',amount_total:amount,currency}}};
 const rawBody=Buffer.from(JSON.stringify(e)),stamp=Math.floor(now/1000);
 const signature='t='+stamp+',v1='+createHmac('sha256',secret).update(stamp+'.').update(rawBody).digest('hex');
 assert.equal(ingestSignedTestEvent(db,{rawBody,signature,secret,now}).result,'paid');
 attachTestCreatorShare(db,{orderId,creatorId:'creator_test_statement',shareBps:4000,now});
 return orderId;
}
const prepare=db=>{
 const batchId='batch_test_r153statement',opts={batchId,creatorId:'creator_test_statement',
  currency:'usd',makerId:'maker_test_statement',now};
 const proof=prepareTestReconciliation(db,opts);
 assert.equal(reconcileTestBatch(db,{batchId,reviewerId:'auditor_test_statement',
  expectedSha256:proof.snapshotSha256,now}).reconciled,true);
 return batchId;
};
test('R153 only reconciled and unchanged synthetic batches can be exported, never actual payments',()=>{
 const x=db();try{
  const a=paid(x,'001',10000),b=paid(x,'002',15000);
  assert.throws(()=>auditedCreatorStatement(x,'batch_test_unknown00'),/Unknown/);
  const id=prepare(x),statement=auditedCreatorStatement(x,id);
  assert.equal(statement.orderCount,2);
  assert.equal(statement.availableMinor,10000);
  assert.equal(statement.actualPayoutMinor,null);
  assert.equal(statement.bankTransferAttempted,false);
  const csv=creatorStatementCsv(statement);
  assert.match(csv,/TEST_ONLY,/);
  assert.match(csv,/NOT_A_PAYOUT/);
  assert.match(csv,new RegExp(a));
  assert.match(csv,new RegExp(b));
  assert.doesNotMatch(csv,/@|sk_live_|acct_/);
  assert.equal(x.prepare('SELECT COUNT(*) AS n FROM r152_creator_review_audit').get().n,1);
  assert.deepEqual(x.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{x.close();}
});
test('R153 stale after a real R86 test refund or new allocation, always fails closed',()=>{
 const x=db();try{
  const orderId=paid(x,'001');
  const id=prepare(x);
  assert.equal(auditedCreatorStatement(x,id).availableMinor,4000);
  applyOfflineFinancialEvent(x,{kind:'refund',eventId:'evt_r86_statement001',referenceId:'re_test_statement001',
   orderId,amountMinor:1000,currency:'usd'},{now});
  assert.throws(()=>auditedCreatorStatement(x,id),/STALE/);
  paid(x,'002');
  assert.throws(()=>auditedCreatorStatement(x,id),/STALE/);
 }finally{x.close();}
});
test('R153 detects per-order tampering even when aggregate amount remains unchanged',()=>{
 const x=db();try{
  const first=paid(x,'001'),second=paid(x,'002');
  const id=prepare(x);
  const update=x.prepare('UPDATE r152_creator_batch_items SET available_minor=available_minor+? WHERE batch_id=? AND order_id=?');
  update.run(1,id,first);update.run(-1,id,second);
  assert.equal(x.prepare('SELECT SUM(available_minor) AS n FROM r152_creator_batch_items').get().n,8000);
  assert.throws(()=>auditedCreatorStatement(x,id),/Batch item was changed/);
 }finally{x.close();}
});
test('R153 maker cannot masquerade as reviewer and spreadsheets cannot inject formula fields',()=>{
 const x=db();try{
  paid(x,'001');
  const proof=prepareTestReconciliation(x,{batchId:'batch_test_unreviewed01',creatorId:'creator_test_statement',
   currency:'usd',makerId:'maker_test_statement',now});
  assert.throws(()=>auditedCreatorStatement(x,'batch_test_unreviewed01'),/independently reconciled/);
  assert.throws(()=>reconcileTestBatch(x,{batchId:'batch_test_unreviewed01',reviewerId:'maker_test_statement',
   expectedSha256:proof.snapshotSha256,now}),/Independent/);
  assert.throws(()=>creatorStatementCsv({contract:'MARCOSA-R153-RECONCILED-TEST-STATEMENT-v1',
   simulated:true,production:false,bankTransferAttempted:false,actualPayoutMinor:null,
   creatorId:'=HYPERLINK',batchId:'batch_test_unreviewed01',currency:'usd',rows:[],orderCount:0}),/identity/);
 }finally{x.close();}
});
