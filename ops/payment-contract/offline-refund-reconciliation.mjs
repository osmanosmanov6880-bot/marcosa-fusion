/**
 * MARCOSA R86: OFFLINE refund/dispute simulation atop R76 paid test receipts.
 * No network, no Checkout, no Stripe API, no customer, no real revenue.
 * NOT a webhook handler. Real payment flows require independently approved
 * merchant ownership, signed provider events and provider reconciliation.
 */
import {createHash} from 'node:crypto';

const demand=(ok,message)=>{if(!ok)throw Error(message);};
const EVENT=/^evt_r86_[A-Za-z0-9_-]{6,80}$/;
const ORDER=/^r76_[A-Za-z0-9_-]{4,80}$/;
const REFUND=/^re_test_[A-Za-z0-9_-]{6,96}$/;
const DISPUTE=/^dp_test_[A-Za-z0-9_-]{6,96}$/;
const KINDS=new Set(['refund','dispute_open','dispute_won','dispute_lost']);
export const FINANCE_LAB='MARCOSA-R86-OFFLINE-ONLY-v1';

export function createOfflineFinance(db){
 demand(db&&typeof db.exec==='function'&&typeof db.prepare==='function',
  'Requires a real SQLite database');
 demand(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='r76_lab_receipts'").get(),
  'R76 test receipt ledger must be initialized first');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec([
  "CREATE TABLE IF NOT EXISTS r86_lab_events(event_id TEXT PRIMARY KEY,payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),event_kind TEXT NOT NULL CHECK(event_kind IN ('refund','dispute_open','dispute_won','dispute_lost')),result TEXT NOT NULL,recorded_at_ms INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS r86_lab_refunds(refund_id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES r76_lab_orders(order_id) ON DELETE CASCADE,event_id TEXT NOT NULL UNIQUE REFERENCES r86_lab_events(event_id) ON DELETE CASCADE,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),currency TEXT NOT NULL,recorded_at_ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_r86_refunds_order ON r86_lab_refunds(order_id)",
  "CREATE TABLE IF NOT EXISTS r86_lab_disputes(case_id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES r76_lab_orders(order_id) ON DELETE CASCADE,opened_event_id TEXT NOT NULL UNIQUE REFERENCES r86_lab_events(event_id) ON DELETE CASCADE,resolved_event_id TEXT UNIQUE REFERENCES r86_lab_events(event_id) ON DELETE SET NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),currency TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','won','lost')),opened_at_ms INTEGER NOT NULL,resolved_at_ms INTEGER)"
 ].join(';')+';');
}
function normalize(input){
 demand(input&&typeof input==='object'&&!Array.isArray(input),'Adjustment must be an object');
 const fields=['eventId','kind','orderId','referenceId','amountMinor','currency'];
 demand(Object.keys(input).length===fields.length&&Object.keys(input).every(k=>fields.includes(k)),
  'Only documented adjustment fields allowed');
 const {eventId,kind,orderId,referenceId,amountMinor,currency}=input;
 demand(typeof eventId==='string'&&EVENT.test(eventId),'Only synthetic R86 event IDs accepted');
 demand(KINDS.has(kind),'Unknown offline finance adjustment');
 demand(typeof orderId==='string'&&ORDER.test(orderId),'Only pre-registered test orders accepted');
 demand(typeof referenceId==='string'&&(kind==='refund'?REFUND:DISPUTE).test(referenceId),
  'Only synthetic refund/dispute reference IDs accepted');
 demand(Number.isSafeInteger(amountMinor)&&amountMinor>0&&amountMinor<=1000000000,
  'Amount must be positive bounded integer minor units');
 demand(typeof currency==='string'&&/^[a-z]{3}$/.test(currency),'Lowercase ISO currency required');
 return{eventId,kind,orderId,referenceId,amountMinor,currency};
}
const digest=o=>createHash('sha256').update(JSON.stringify([
 o.kind,o.orderId,o.referenceId,o.amountMinor,o.currency])).digest('hex');
function paidOrder(db,orderId){
 const row=db.prepare("SELECT o.order_id,o.currency,r.amount_minor FROM r76_lab_orders o JOIN r76_lab_receipts r ON r.order_id=o.order_id WHERE o.order_id=? AND o.status='paid'").get(orderId);
 demand(row,'Refund/dispute requires a verified R76 TEST receipt');
 return row;
}
/** INTERNAL deterministic test only. Not a route, web hook or real payment. */
export function applyOfflineFinancialEvent(db,unsafe,{now=Date.now()}={}){
 const a=normalize(unsafe);
 demand(Number.isSafeInteger(now)&&now>0,'Invalid event timestamp');
 const h=digest(a);
 db.exec('BEGIN IMMEDIATE');
 try{
  const existing=db.prepare('SELECT payload_sha256,result FROM r86_lab_events WHERE event_id=?').get(a.eventId);
  if(existing){
   demand(existing.payload_sha256===h,'Reused event ID has altered immutable body');
   db.exec('COMMIT');
   return{duplicate:true,result:existing.result,simulated:true,production:false};
  }
  const paid=paidOrder(db,a.orderId);
  demand(paid.currency===a.currency,'Currency differs from signed R76 test receipt');
  demand(a.amountMinor<=paid.amount_minor,'Adjustment exceeds original test receipt');
  const refunds=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM r86_lab_refunds WHERE order_id=?').get(a.orderId).n;
  const dispute=db.prepare('SELECT * FROM r86_lab_disputes WHERE order_id=?').get(a.orderId);
  let result;
  if(a.kind==='refund'){
   demand(!dispute||dispute.status!=='open','Refund forbidden during unresolved dispute');
   demand(!db.prepare('SELECT 1 FROM r86_lab_refunds WHERE refund_id=?').get(a.referenceId),
    'Refund reference was previously recorded in a different event');
   const lost=dispute?.status==='lost'?dispute.amount_minor:0;
   demand(a.amountMinor<=paid.amount_minor-refunds-lost,
    'Refund would double-credit or exceed payment after lost dispute');
   result='refund_recorded';
  }else if(a.kind==='dispute_open'){
   demand(!dispute,'Only one immutable test dispute per order');
   demand(a.amountMinor<=paid.amount_minor-refunds,'Dispute exceeds net test payment');
   result='dispute_opened';
  }else{
   demand(dispute&&dispute.case_id===a.referenceId&&dispute.status==='open',
    'Only an existing open dispute can be resolved once');
   demand(dispute.amount_minor===a.amountMinor&&dispute.currency===a.currency,
    'Case amount or currency mismatch');
   result=a.kind==='dispute_lost'?'dispute_lost':'dispute_won';
  }
  db.prepare('INSERT INTO r86_lab_events(event_id,payload_sha256,event_kind,result,recorded_at_ms) VALUES(?,?,?,?,?)')
   .run(a.eventId,h,a.kind,result,now);
  if(a.kind==='refund'){
   db.prepare('INSERT INTO r86_lab_refunds(refund_id,order_id,event_id,amount_minor,currency,recorded_at_ms) VALUES(?,?,?,?,?,?)')
    .run(a.referenceId,a.orderId,a.eventId,a.amountMinor,a.currency,now);
  }else if(a.kind==='dispute_open'){
   db.prepare("INSERT INTO r86_lab_disputes(case_id,order_id,opened_event_id,amount_minor,currency,status,opened_at_ms) VALUES(?,?,?,?,?,'open',?)")
    .run(a.referenceId,a.orderId,a.eventId,a.amountMinor,a.currency,now);
  }else{
   const changed=db.prepare("UPDATE r86_lab_disputes SET status=?,resolved_event_id=?,resolved_at_ms=? WHERE case_id=? AND order_id=? AND status='open'")
    .run(a.kind==='dispute_lost'?'lost':'won',a.eventId,now,a.referenceId,a.orderId);
   demand(changed.changes===1,'Concurrent dispute resolution blocked');
  }
  db.exec('COMMIT');
  return{duplicate:false,result,simulated:true,production:false};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
/** TEST-only balances per currency. Real revenue/merchant fields remain null. */
export function offlineFinanceReport(db){
 const currencies=db.prepare('SELECT DISTINCT currency FROM r76_lab_receipts ORDER BY currency').all();
 const totals=currencies.map(({currency})=>{
  const gross=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM r76_lab_receipts WHERE currency=?').get(currency).n;
  const refunded=db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM r86_lab_refunds WHERE currency=?').get(currency).n;
  const lost=db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS n FROM r86_lab_disputes WHERE currency=? AND status='lost'").get(currency).n;
  const reserved=db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS n FROM r86_lab_disputes WHERE currency=? AND status='open'").get(currency).n;
  demand(gross>=refunded+lost+reserved,'Inconsistent simulated finance balance');
  return{currency,simulatedGrossMinor:gross,simulatedRefundedMinor:refunded,
   simulatedLostDisputesMinor:lost,simulatedOpenDisputeReserveMinor:reserved,
   simulatedNetAfterLossMinor:gross-refunded-lost,
   simulatedAvailableAfterReserveMinor:gross-refunded-lost-reserved};
 });
 return{contract:FINANCE_LAB,production:false,simulated:true,testOnlyCurrencies:totals,
  actualNetRevenue:null,actualGrossRevenue:null,paymentAccountVerified:false,
  merchantLegalApproved:false,realCustomerCount:null,
  realSettlementReconciled:false,commercialLaunchAuthorized:false};
}
