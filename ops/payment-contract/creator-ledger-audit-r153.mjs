/**
 * MARCOSA R153 — tamper-evident, reproducible TEST-only creator statements.
 * A statement is not a disbursement authorization and has no bank fields.
 */
import {createHash} from 'node:crypto';
import {creatorTestBalance} from './creator-earnings-r152.mjs';

const need=(ok,message)=>{if(!ok)throw Error(message);};
const batchPattern=/^batch_test_[A-Za-z0-9_-]{6,80}$/;
const sha=/^[a-f0-9]{64}$/;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const payload=rows=>rows.map(r=>[
 r.orderId,r.currency,r.shareBps,r.grossMinor,r.refundedMinor,r.lostMinor,
 r.reservedMinor,r.entitledMinor,r.heldMinor,r.availableMinor
]);
const fingerprint=rows=>createHash('sha256').update(JSON.stringify(payload(rows))).digest('hex');
const sum=(items,key)=>items.reduce((total,row)=>{
 const value=total+row[key];
 need(safe(value),'Overflow in creator statement');
 return value;
},0);

/** A statement requires independent R152 review + exact unchanged source.
 * It deliberately refuses stale batches after refunds, disputes or new orders.
 */
export function auditedCreatorStatement(db,batchId){
 need(typeof batchId==='string'&&batchPattern.test(batchId),'Synthetic batch ID required');
 const batch=db.prepare('SELECT * FROM r152_creator_batches WHERE batch_id=?').get(batchId);
 need(batch,'Unknown creator test batch');
 need(batch.status==='reconciled','Only independently reconciled test batches are eligible');
 const audit=db.prepare('SELECT * FROM r152_creator_review_audit WHERE batch_id=?').get(batchId);
 need(audit&&audit.reviewer_id===batch.reviewer_id&&audit.approved_hash===batch.snapshot_sha256,
  'Missing or altered independent review audit');
 need(sha.test(batch.snapshot_sha256),'Invalid batch checksum');
 const balance=creatorTestBalance(db,{creatorId:batch.creator_id,currency:batch.currency});
 need(balance.orderCount>0,'Empty source balance');
 need(fingerprint(balance.orders)===batch.snapshot_sha256,
  'STALE: source changed after creator batch review');
 need(balance.availableMinor===batch.available_minor&&balance.heldMinor===batch.held_minor,
  'STALE: totals changed after creator batch review');
 const items=db.prepare([
  'SELECT bi.order_id AS orderId,bi.available_minor AS availableMinor,',
  'bi.held_minor AS heldMinor,bi.entitled_minor AS entitledMinor,',
  'sh.creator_id AS creatorId,r.currency',
  'FROM r152_creator_batch_items bi',
  'JOIN r152_creator_shares sh ON sh.order_id=bi.order_id',
  'JOIN r76_lab_receipts r ON r.order_id=bi.order_id',
  'WHERE bi.batch_id=? ORDER BY bi.order_id'
 ].join(' ')).all(batchId);
 need(items.length===balance.orderCount,'Batch/source order count mismatch');
 const expected=new Map(balance.orders.map(row=>[row.orderId,row]));
 for(const row of items){
  const current=expected.get(row.orderId);
  need(current,'Unknown batch order');
  need(row.creatorId===batch.creator_id&&row.currency===batch.currency,
   'Cross-creator or cross-currency test allocation detected');
  need(row.availableMinor===current.availableMinor&&row.heldMinor===current.heldMinor&&
   row.entitledMinor===current.entitledMinor,'Batch item was changed after review');
 }
 need(sum(items,'availableMinor')===batch.available_minor&&
  sum(items,'heldMinor')===batch.held_minor,'Batch sums were changed after review');
 const rows=balance.orders.map(row=>({
  orderId:row.orderId,shareBps:row.shareBps,grossMinor:row.grossMinor,
  refundedMinor:row.refundedMinor,lostMinor:row.lostMinor,
  reservedMinor:row.reservedMinor,entitledMinor:row.entitledMinor,
  heldMinor:row.heldMinor,availableMinor:row.availableMinor
 }));
 return{
  contract:'MARCOSA-R153-RECONCILED-TEST-STATEMENT-v1',
  batchId,creatorId:batch.creator_id,currency:batch.currency,
  snapshotSha256:batch.snapshot_sha256,
  reviewerId:batch.reviewer_id,reviewedAtMs:audit.reviewed_at_ms,
  state:'VERIFIED_SYNTHETIC_LEDGER_ONLY',rows,
  orderCount:rows.length,availableMinor:balance.availableMinor,
  heldMinor:balance.heldMinor,entitledMinor:balance.entitledMinor,
  simulated:true,production:false,bankTransferAttempted:false,actualPayoutMinor:null,
  realSettlementReconciled:false,commercialLaunchAuthorized:false
 };
}

/** Export of a server-derived synthetic statement, no PII or spreadsheet formulas. */
export function creatorStatementCsv(statement){
 need(statement?.contract==='MARCOSA-R153-RECONCILED-TEST-STATEMENT-v1'&&
  statement.simulated===true&&statement.production===false&&
  statement.bankTransferAttempted===false&&statement.actualPayoutMinor===null,
  'Only independently verified synthetic statements can be exported');
 need(/^creator_test_[A-Za-z0-9_-]{4,64}$/.test(statement.creatorId)&&
  /^[a-z]{3}$/.test(statement.currency)&&batchPattern.test(statement.batchId),
  'Invalid synthetic statement identity');
 const names=['orderId','shareBps','grossMinor','refundedMinor','lostMinor','reservedMinor',
  'entitledMinor','heldMinor','availableMinor'];
 need(Array.isArray(statement.rows)&&statement.rows.length===statement.orderCount,
  'Invalid statement row count');
 const lines=[['TEST_ONLY',statement.batchId,statement.creatorId,statement.currency].join(','),
  names.join(',')];
 for(const row of statement.rows){
  need(/^r76_[A-Za-z0-9_-]{4,80}$/.test(row.orderId),'Only synthetic order IDs permitted');
  for(const key of names.slice(1))need(safe(row[key]),'Invalid integer CSV amount');
  lines.push(names.map(n=>String(row[n])).join(','));
 }
 lines.push('NOTE,NOT_A_PAYOUT,NOT_REAL_REVENUE,NO_BANK_INTEGRATION');
 return lines.join('\r\n')+'\r\n';
}
