/**
 * MARCOSA R152 — OFFLINE creator allocations from R76 verified test receipts
 * and R86 test refunds/disputes. No payment or payout integration.
 */
import {createHash} from 'node:crypto';
export const CREATOR_LAB='MARCOSA-R152-CREATOR-OFFLINE-v1';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const creatorPattern=/^creator_test_[A-Za-z0-9_-]{4,64}$/;
const orderPattern=/^r76_[A-Za-z0-9_-]{4,80}$/;
const batchPattern=/^batch_test_[A-Za-z0-9_-]{6,80}$/;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const sum=(rows,key)=>rows.reduce((n,row)=>{const v=n+row[key];need(safe(v),'Unsafe integer aggregation');return v;},0);
const fingerprint=rows=>createHash('sha256').update(JSON.stringify(rows.map(r=>[
 r.orderId,r.currency,r.shareBps,r.grossMinor,r.refundedMinor,r.lostMinor,
 r.reservedMinor,r.entitledMinor,r.heldMinor,r.availableMinor]))).digest('hex');
function atomic(db,action){
 db.exec('BEGIN IMMEDIATE');
 try{const result=action();db.exec('COMMIT');return result;}
 catch(e){db.exec('ROLLBACK');throw e;}
}
export function initCreatorEarnings(db){
 need(db&&typeof db.prepare==='function','SQLite required');
 for(const name of ['r76_lab_orders','r76_lab_receipts','r86_lab_refunds','r86_lab_disputes'])
  need(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
   'Initialize R76 and R86 before creator ledger: '+name);
 db.exec('PRAGMA foreign_keys=ON');
 db.exec([
  'CREATE TABLE IF NOT EXISTS r152_creator_shares(order_id TEXT PRIMARY KEY REFERENCES r76_lab_orders(order_id),creator_id TEXT NOT NULL,share_bps INTEGER NOT NULL CHECK(share_bps BETWEEN 1 AND 10000),recorded_at_ms INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_r152_creator_shares_creator ON r152_creator_shares(creator_id,order_id)',
  "CREATE TABLE IF NOT EXISTS r152_creator_batches(batch_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,currency TEXT NOT NULL,maker_id TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),available_minor INTEGER NOT NULL CHECK(available_minor>=0),held_minor INTEGER NOT NULL CHECK(held_minor>=0),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reconciled')),created_at_ms INTEGER NOT NULL,reconciled_at_ms INTEGER,reviewer_id TEXT)",
  'CREATE TABLE IF NOT EXISTS r152_creator_batch_items(batch_id TEXT NOT NULL REFERENCES r152_creator_batches(batch_id) ON DELETE CASCADE,order_id TEXT NOT NULL REFERENCES r152_creator_shares(order_id),available_minor INTEGER NOT NULL CHECK(available_minor>=0),held_minor INTEGER NOT NULL CHECK(held_minor>=0),entitled_minor INTEGER NOT NULL CHECK(entitled_minor>=0),PRIMARY KEY(batch_id,order_id))',
  'CREATE TABLE IF NOT EXISTS r152_creator_review_audit(batch_id TEXT PRIMARY KEY REFERENCES r152_creator_batches(batch_id),reviewer_id TEXT NOT NULL,approved_hash TEXT NOT NULL,reviewed_at_ms INTEGER NOT NULL)'
 ].join(';')+';');
}
/** Immutable author split; only after a R76 verified test receipt exists. */
export function attachTestCreatorShare(db,{orderId,creatorId,shareBps,now=Date.now()}={}){
 need(typeof orderId==='string'&&orderPattern.test(orderId),'Only synthetic test order IDs accepted');
 need(typeof creatorId==='string'&&creatorPattern.test(creatorId),'Only synthetic creator IDs accepted');
 need(Number.isSafeInteger(shareBps)&&shareBps>=1&&shareBps<=10000,'Invalid share basis points');
 need(Number.isSafeInteger(now)&&now>0,'Invalid UTC clock');
 return atomic(db,()=>{
  need(db.prepare("SELECT 1 FROM r76_lab_receipts r JOIN r76_lab_orders o ON o.order_id=r.order_id AND o.status='paid' WHERE r.order_id=?").get(orderId),
   'A verified paid R76 TEST receipt is required');
  const old=db.prepare('SELECT creator_id,share_bps FROM r152_creator_shares WHERE order_id=?').get(orderId);
  if(old){
   need(old.creator_id===creatorId&&old.share_bps===shareBps,'Creator share immutable for an order');
   return{duplicate:true,simulated:true,production:false};
  }
  db.prepare('INSERT INTO r152_creator_shares(order_id,creator_id,share_bps,recorded_at_ms) VALUES(?,?,?,?)')
   .run(orderId,creatorId,shareBps,now);
  return{duplicate:false,simulated:true,production:false};
 });
}
function rowsFor(db,creatorId,currency){
 need(typeof creatorId==='string'&&creatorPattern.test(creatorId),'Only synthetic creator IDs accepted');
 need(typeof currency==='string'&&/^[a-z]{3}$/.test(currency),'Lowercase ISO currency required');
 const sql=[
  'SELECT sh.order_id AS orderId,r.currency,sh.share_bps AS shareBps,r.amount_minor AS grossMinor,',
  '(SELECT COALESCE(SUM(f.amount_minor),0) FROM r86_lab_refunds f WHERE f.order_id=sh.order_id) AS refundedMinor,',
  "(SELECT COALESCE(SUM(d.amount_minor),0) FROM r86_lab_disputes d WHERE d.order_id=sh.order_id AND d.status='lost') AS lostMinor,",
  "(SELECT COALESCE(SUM(d.amount_minor),0) FROM r86_lab_disputes d WHERE d.order_id=sh.order_id AND d.status='open') AS reservedMinor",
  'FROM r152_creator_shares sh JOIN r76_lab_receipts r ON r.order_id=sh.order_id',
  "JOIN r76_lab_orders o ON o.order_id=r.order_id AND o.status='paid'",
  'WHERE sh.creator_id=? AND r.currency=? ORDER BY sh.order_id'
 ].join(' ');
 return db.prepare(sql).all(creatorId,currency).map(r=>{
  for(const key of ['shareBps','grossMinor','refundedMinor','lostMinor','reservedMinor'])
   need(safe(r[key]),'Invalid simulated source amount: '+key);
  const net=r.grossMinor-r.refundedMinor-r.lostMinor,available=net-r.reservedMinor;
  need(net>=0&&available>=0,'Negative simulated net balance');
  const entitledMinor=Math.floor(net*r.shareBps/10000);
  const availableMinor=Math.floor(available*r.shareBps/10000);
  const heldMinor=entitledMinor-availableMinor;
  need([entitledMinor,availableMinor,heldMinor].every(safe),'Invalid creator share calculation');
  return{...r,entitledMinor,heldMinor,availableMinor};
 });
}
/** Current snapshot, excludes no losses and keeps unresolved dispute money held. */
export function creatorTestBalance(db,{creatorId,currency}={}){
 const orders=rowsFor(db,creatorId,currency);
 return{contract:CREATOR_LAB,creatorId,currency,orders,orderCount:orders.length,
  entitledMinor:sum(orders,'entitledMinor'),heldMinor:sum(orders,'heldMinor'),
  availableMinor:sum(orders,'availableMinor'),simulated:true,production:false,
  realCreatorId:null,actualPayoutMinor:null,realSettlementReconciled:false,
  commercialLaunchAuthorized:false};
}
/** Immutable draft with exact per-order source proof. No funds are moved. */
export function prepareTestReconciliation(db,{batchId,creatorId,currency,makerId,now=Date.now()}={}){
 need(typeof batchId==='string'&&batchPattern.test(batchId),'Invalid test batch ID');
 need(typeof makerId==='string'&&/^maker_test_[A-Za-z0-9_-]{4,64}$/.test(makerId),'Synthetic maker required');
 need(Number.isSafeInteger(now)&&now>0,'Invalid UTC timestamp');
 return atomic(db,()=>{
  const balance=creatorTestBalance(db,{creatorId,currency});
  need(balance.orderCount>0,'No allocated test receipts to reconcile');
  const snapshotSha256=fingerprint(balance.orders);
  const previous=db.prepare('SELECT * FROM r152_creator_batches WHERE batch_id=?').get(batchId);
  if(previous){
   need(previous.creator_id===creatorId&&previous.currency===currency&&previous.maker_id===makerId&&
    previous.snapshot_sha256===snapshotSha256&&previous.available_minor===balance.availableMinor&&
    previous.held_minor===balance.heldMinor,'Batch ID reused with changed financial state');
   return{batchId,snapshotSha256,availableMinor:balance.availableMinor,heldMinor:balance.heldMinor,
    duplicate:true,simulated:true,production:false};
  }
  db.prepare('INSERT INTO r152_creator_batches(batch_id,creator_id,currency,maker_id,snapshot_sha256,available_minor,held_minor,created_at_ms) VALUES(?,?,?,?,?,?,?,?)')
   .run(batchId,creatorId,currency,makerId,snapshotSha256,balance.availableMinor,balance.heldMinor,now);
  const insert=db.prepare('INSERT INTO r152_creator_batch_items(batch_id,order_id,available_minor,held_minor,entitled_minor) VALUES(?,?,?,?,?)');
  for(const row of balance.orders)insert.run(batchId,row.orderId,row.availableMinor,row.heldMinor,row.entitledMinor);
  return{batchId,snapshotSha256,availableMinor:balance.availableMinor,heldMinor:balance.heldMinor,
   duplicate:false,simulated:true,production:false};
 });
}
/** Separate synthetic auditor verifies freshness. This is NOT a payment approval. */
export function reconcileTestBatch(db,{batchId,reviewerId,expectedSha256,now=Date.now()}={}){
 need(typeof batchId==='string'&&batchPattern.test(batchId),'Invalid test batch ID');
 need(typeof reviewerId==='string'&&/^auditor_test_[A-Za-z0-9_-]{4,64}$/.test(reviewerId),
  'Independent synthetic auditor required');
 need(typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256),'Exact snapshot SHA required');
 need(Number.isSafeInteger(now)&&now>0,'Invalid UTC timestamp');
 return atomic(db,()=>{
  const batch=db.prepare('SELECT * FROM r152_creator_batches WHERE batch_id=?').get(batchId);
  need(batch,'Unknown test batch');
  need(reviewerId!==batch.maker_id,'Maker cannot self-review');
  need(batch.snapshot_sha256===expectedSha256,'Batch hash mismatch');
  const latest=creatorTestBalance(db,{creatorId:batch.creator_id,currency:batch.currency});
  need(fingerprint(latest.orders)===expectedSha256&&latest.availableMinor===batch.available_minor&&
   latest.heldMinor===batch.held_minor,'Stale reconciliation: refund/dispute/allocation changed');
  if(batch.status==='reconciled'){
   need(batch.reviewer_id===reviewerId,'Batch already reviewed by another auditor');
   return{duplicate:true,reconciled:true,simulated:true,actualTransferCreated:false};
  }
  const changed=db.prepare("UPDATE r152_creator_batches SET status='reconciled',reconciled_at_ms=?,reviewer_id=? WHERE batch_id=? AND status='draft'")
   .run(now,reviewerId,batchId);
  need(changed.changes===1,'Simulated review state conflict');
  db.prepare('INSERT INTO r152_creator_review_audit(batch_id,reviewer_id,approved_hash,reviewed_at_ms) VALUES(?,?,?,?)')
   .run(batchId,reviewerId,expectedSha256,now);
  return{duplicate:false,reconciled:true,simulated:true,actualTransferCreated:false};
 });
}
export function testBatchReport(db,batchId){
 need(typeof batchId==='string'&&batchPattern.test(batchId),'Invalid test batch ID');
 const batch=db.prepare('SELECT * FROM r152_creator_batches WHERE batch_id=?').get(batchId);
 need(batch,'Unknown test batch');
 const latest=creatorTestBalance(db,{creatorId:batch.creator_id,currency:batch.currency});
 const stored=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(available_minor),0) AS available,COALESCE(SUM(held_minor),0) AS held FROM r152_creator_batch_items WHERE batch_id=?').get(batchId);
 need(stored.n>0&&stored.available===batch.available_minor&&stored.held===batch.held_minor,'Stored batch item totals corrupted');
 return{batchId,status:batch.status,creatorId:batch.creator_id,currency:batch.currency,
  snapshotSha256:batch.snapshot_sha256,
  sourceCurrent:fingerprint(latest.orders)===batch.snapshot_sha256&&
   latest.availableMinor===batch.available_minor&&latest.heldMinor===batch.held_minor,
  simulatedAvailableMinor:batch.available_minor,simulatedHeldMinor:batch.held_minor,
  actualPayoutMinor:null,actualTransferCreated:false,production:false,
  approvalIsNotPayment:true,commercialLaunchAuthorized:false};
}
