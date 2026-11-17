import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createSandboxLedger,registerSandboxOrder,ingestSignedTestEvent} from './stripe-sandbox-contract.mjs';
import {createOfflineFinance,applyOfflineFinancialEvent} from './offline-refund-reconciliation.mjs';
import {initCreatorEarnings,attachTestCreatorShare,creatorTestBalance,
 prepareTestReconciliation,reconcileTestBatch,testBatchReport,CREATOR_LAB} from './creator-earnings-r152.mjs';

const clock=Date.parse('2026-10-25T12:00:00Z'),secret='whsec_r152_offline_only_2026';
const maker='maker_test_operations',auditor='auditor_test_compliance';
function paid(db,{orderId='r76_creators001',sessionId='cs_test_creator0001',amount=10000,
 currency='usd',eventId='evt_test_creator001'}={}){
 registerSandboxOrder(db,{orderId,sessionId,amountMinor:amount,currency});
 const event={object:'event',id:eventId,livemode:false,type:'checkout.session.completed',
 data:{object:{object:'checkout.session',id:sessionId,client_reference_id:orderId,
 status:'complete',mode:'payment',payment_status:'paid',amount_total:amount,currency}}};
 const rawBody=Buffer.from(JSON.stringify(event)),ts=Math.floor(clock/1000);
 const signature='t='+ts+',v1='+createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest('hex');
 assert.equal(ingestSignedTestEvent(db,{rawBody,signature,secret,now:clock}).result,'paid');
}
const init=()=>{const db=new DatabaseSync(':memory:');createSandboxLedger(db);createOfflineFinance(db);initCreatorEarnings(db);return db;};
const refund=(id,amount)=>({kind:'refund',eventId:'evt_r86_refund'+id,referenceId:'re_test_refund'+id,
 orderId:'r76_creators001',amountMinor:amount,currency:'usd'});
const dispute=(id,kind,amount)=>({kind,eventId:'evt_r86_case'+id,referenceId:'dp_test_caseCreator01',
 orderId:'r76_creators001',amountMinor:amount,currency:'usd'});

test('R152 creator shares require paid test receipts, immutable allocation and synthetic identities',()=>{
 const db=init();try{
  const allocation={orderId:'r76_creators001',creatorId:'creator_test_writer01',shareBps:2500,now:clock};
  assert.throws(()=>attachTestCreatorShare(db,allocation),/verified paid/);
  paid(db);
  assert.equal(attachTestCreatorShare(db,allocation).duplicate,false);
  assert.equal(attachTestCreatorShare(db,allocation).duplicate,true);
  assert.throws(()=>attachTestCreatorShare(db,{...allocation,shareBps:2600}),/immutable/);
  assert.throws(()=>attachTestCreatorShare(db,{...allocation,creatorId:'creator_test_other01'}),/immutable/);
  assert.throws(()=>attachTestCreatorShare(db,{...allocation,creatorId:'acct_live_person'}),/Only synthetic/);
  assert.throws(()=>attachTestCreatorShare(db,{...allocation,shareBps:11000}),/basis points/);
  const bal=creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'usd'});
  assert.equal(bal.contract,CREATOR_LAB);assert.equal(bal.availableMinor,2500);
  assert.equal(bal.actualPayoutMinor,null);assert.equal(bal.commercialLaunchAuthorized,false);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
test('R152 multiple refunds and open/lost disputes reduce available TEST shares only',()=>{
 const db=init();try{
  paid(db);attachTestCreatorShare(db,{orderId:'r76_creators001',creatorId:'creator_test_writer01',shareBps:2500});
  applyOfflineFinancialEvent(db,refund('One0001',2000),{now:clock});
  applyOfflineFinancialEvent(db,refund('Two0002',500),{now:clock});
  let bal=creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'usd'});
  assert.equal(bal.entitledMinor,1875);assert.equal(bal.heldMinor,0);
  applyOfflineFinancialEvent(db,dispute('One0001','dispute_open',3000),{now:clock});
  bal=creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'usd'});
  assert.equal(bal.entitledMinor,1875);assert.equal(bal.availableMinor,1125);assert.equal(bal.heldMinor,750);
  applyOfflineFinancialEvent(db,dispute('Two0002','dispute_lost',3000),{now:clock});
  bal=creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'usd'});
  assert.equal(bal.entitledMinor,1125);assert.equal(bal.heldMinor,0);assert.equal(bal.availableMinor,1125);
 }finally{db.close();}
});
test('R152 locked two-person reconciliation catches stale snapshot and replay',()=>{
 const db=init();try{
  paid(db);attachTestCreatorShare(db,{orderId:'r76_creators001',creatorId:'creator_test_writer01',shareBps:3333});
  const opts={batchId:'batch_test_2026Creator01',creatorId:'creator_test_writer01',currency:'usd',makerId:maker,now:clock};
  const first=prepareTestReconciliation(db,opts);
  assert.equal(first.availableMinor,3333);assert.equal(prepareTestReconciliation(db,opts).duplicate,true);
  assert.throws(()=>prepareTestReconciliation(db,{...opts,makerId:'maker_test_alternate'}),/reused/);
  assert.throws(()=>reconcileTestBatch(db,{batchId:opts.batchId,reviewerId:auditor,expectedSha256:'f'.repeat(64)}),/hash mismatch/);
  assert.throws(()=>reconcileTestBatch(db,{batchId:opts.batchId,reviewerId:maker,expectedSha256:first.snapshotSha256}),/Independent/);
  assert.equal(reconcileTestBatch(db,{batchId:opts.batchId,reviewerId:auditor,expectedSha256:first.snapshotSha256}).duplicate,false);
  assert.equal(reconcileTestBatch(db,{batchId:opts.batchId,reviewerId:auditor,expectedSha256:first.snapshotSha256}).duplicate,true);
  assert.equal(testBatchReport(db,opts.batchId).sourceCurrent,true);
  assert.equal(testBatchReport(db,opts.batchId).actualTransferCreated,false);
  applyOfflineFinancialEvent(db,refund('Next0003',2000),{now:clock});
  assert.equal(testBatchReport(db,opts.batchId).sourceCurrent,false);
  assert.throws(()=>reconcileTestBatch(db,{batchId:opts.batchId,reviewerId:auditor,expectedSha256:first.snapshotSha256}),/Stale/);
  assert.throws(()=>prepareTestReconciliation(db,opts),/changed financial state/);
  const next=prepareTestReconciliation(db,{...opts,batchId:'batch_test_2026Creator02'});
  assert.equal(next.availableMinor,2666);
  assert.equal(reconcileTestBatch(db,{batchId:'batch_test_2026Creator02',reviewerId:auditor,expectedSha256:next.snapshotSha256}).reconciled,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM r152_creator_review_audit').get().n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
test('R152 cross-currency and cross-creator isolation',()=>{
 const db=init();try{
  paid(db);paid(db,{orderId:'r76_creators002',sessionId:'cs_test_creator0002',amount:9200,currency:'eur',eventId:'evt_test_creator002'});
  attachTestCreatorShare(db,{orderId:'r76_creators001',creatorId:'creator_test_writer01',shareBps:5000});
  attachTestCreatorShare(db,{orderId:'r76_creators002',creatorId:'creator_test_writer02',shareBps:10000});
  assert.equal(creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'usd'}).availableMinor,5000);
  assert.equal(creatorTestBalance(db,{creatorId:'creator_test_writer01',currency:'eur'}).availableMinor,0);
  assert.equal(creatorTestBalance(db,{creatorId:'creator_test_writer02',currency:'eur'}).availableMinor,9200);
  assert.throws(()=>prepareTestReconciliation(db,{batchId:'batch_test_wrongcurrency',creatorId:'creator_test_writer01',currency:'eur',makerId:maker}),/No allocated/);
 }finally{db.close();}
});
