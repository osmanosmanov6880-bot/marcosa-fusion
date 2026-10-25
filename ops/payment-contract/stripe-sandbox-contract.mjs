/**
 * MARCOSA R76 — offline, Stripe-shaped webhook ingestion proof.
 * No web server, Checkout creation, Stripe API key, real-money flow or fulfillment.
 * Only livemode:false fixtures can be applied. Test-only account/endpoint secret.
 * Production MUST use official Stripe SDK constructEvent and independently reviewed
 * account/price contract before any actual customer data is accepted.
 */
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

const demand=(ok,message)=>{if(!ok)throw Error(message);};
const MAX_BYTES=131072;
const TYPES=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded']);
export const CONTRACT_VERSION='MARCOSA-STRIPE-OFFLINE-CI-v1';

/** Signature input is the EXACT raw body, never parsed/reserialized JSON. */
export function verifySignedTestEvent({rawBody,signature,secret,now=Date.now()}){
 demand(Buffer.isBuffer(rawBody)&&rawBody.length>0&&rawBody.length<=MAX_BYTES,
  'Webhook requires bounded raw Buffer');
 demand(typeof signature==='string'&&signature.length<=2048,'Invalid signature header');
 demand(typeof secret==='string'&&/^whsec_[A-Za-z0-9_\-]{16,}$/.test(secret),
  'Lab endpoint signing secret is not configured');
 demand(Number.isSafeInteger(now)&&now>0,'Invalid current UTC milliseconds');
 const fields=signature.split(',').map(x=>x.trim());
 const times=fields.filter(x=>x.startsWith('t=')),signatures=fields.filter(x=>x.startsWith('v1='));
 demand(times.length===1&&signatures.length>0&&signatures.length<=4,
  'Missing or ambiguous Stripe-style signature header');
 const secondsText=times[0].slice(2);
 demand(/^[1-9][0-9]{8,12}$/.test(secondsText),'Invalid signature timestamp');
 const signedAt=Number(secondsText),seconds=Math.floor(now/1000);
 demand(Number.isSafeInteger(signedAt)&&Math.abs(seconds-signedAt)<=300,
  'Webhook timestamp outside five-minute window');
 const expected=createHmac('sha256',secret).update(secondsText+'.').update(rawBody).digest();
 let match=false;
 for(const field of signatures){
  const hex=field.slice(3);
  if(!/^[a-f0-9]{64}$/.test(hex))continue;
  const provided=Buffer.from(hex,'hex');
  match=timingSafeEqual(expected,provided)||match;
 }
 demand(match,'Webhook signature mismatch');
 let parsed;
 try{parsed=JSON.parse(rawBody.toString('utf8'));}catch{throw Error('Webhook JSON invalid');}
 demand(parsed&&typeof parsed==='object'&&parsed.object==='event'&&
  typeof parsed.id==='string'&&/^evt_[A-Za-z0-9_\-]{4,96}$/.test(parsed.id),
  'Webhook event identity invalid');
 demand(parsed.livemode===false,'Live Stripe webhook deliberately blocked in offline lab');
 demand(typeof parsed.type==='string'&&TYPES.has(parsed.type),'Unsupported event type');
 return parsed;
}

/** Explicitly test-only schema. No production money can be derived from it. */
export function createSandboxLedger(db){
 demand(db&&typeof db.exec==='function'&&typeof db.prepare==='function','Real SQLite connection required');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(`
  CREATE TABLE IF NOT EXISTS r76_lab_orders(
   order_id TEXT PRIMARY KEY,
   session_id TEXT NOT NULL UNIQUE,
   amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000),
   currency TEXT NOT NULL CHECK(length(currency)=3),
   status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','paid'))
  );
  CREATE TABLE IF NOT EXISTS r76_lab_events(
   event_id TEXT PRIMARY KEY,
   raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64),
   session_id TEXT NOT NULL,
   result TEXT NOT NULL CHECK(result IN ('unpaid','paid','already_paid')),
   received_at_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS r76_lab_receipts(
   order_id TEXT PRIMARY KEY REFERENCES r76_lab_orders(order_id),
   event_id TEXT NOT NULL UNIQUE REFERENCES r76_lab_events(event_id),
   amount_minor INTEGER NOT NULL,
   currency TEXT NOT NULL,
   received_at_ms INTEGER NOT NULL
  );
 `);
}

/** Register an expected fixture BEFORE any signed event. Never call from a public request. */
export function registerSandboxOrder(db,{orderId,sessionId,amountMinor,currency}){
 demand(/^r76_[A-Za-z0-9_-]{4,80}$/.test(orderId??''),'Invalid lab order ID');
 demand(/^cs_test_[A-Za-z0-9_-]{6,120}$/.test(sessionId??''),'Only test Checkout IDs accepted');
 demand(Number.isSafeInteger(amountMinor)&&amountMinor>0&&amountMinor<=1000000000,
  'Positive expected amount required');
 demand(typeof currency==='string'&&/^[a-z]{3}$/.test(currency),'ISO currency required');
 db.prepare('INSERT INTO r76_lab_orders(order_id,session_id,amount_minor,currency) VALUES(?,?,?,?)')
  .run(orderId,sessionId,amountMinor,currency);
}

/** Store a verified test event at most once, and recognize a payment at most once. */
export function ingestSignedTestEvent(db,{rawBody,signature,secret,now=Date.now()}){
 const event=verifySignedTestEvent({rawBody,signature,secret,now});
 const session=event.data?.object;
 demand(session&&session.object==='checkout.session'&&
  typeof session.id==='string'&&/^cs_test_[A-Za-z0-9_-]{6,120}$/.test(session.id),
  'Only test Checkout Sessions supported');
 demand(typeof session.client_reference_id==='string'&&
  /^r76_[A-Za-z0-9_-]{4,80}$/.test(session.client_reference_id),
  'Pre-registered lab order required');
 demand(session.mode==='payment'&&session.status==='complete',
  'Checkout not completed as a payment');
 demand(['paid','unpaid'].includes(session.payment_status),'Invalid payment status');
 demand(Number.isSafeInteger(session.amount_total)&&session.amount_total>0&&
  session.amount_total<=1000000000&&typeof session.currency==='string'&&
  /^[a-z]{3}$/.test(session.currency),'Invalid payment currency or amount');
 const digest=createHash('sha256').update(rawBody).digest('hex');
 db.exec('BEGIN IMMEDIATE');
 try{
  const seen=db.prepare('SELECT raw_sha256,result FROM r76_lab_events WHERE event_id=?').get(event.id);
  if(seen){
   demand(seen.raw_sha256===digest,'Repeated event ID has different signed body');
   db.exec('COMMIT');
   return{eventId:event.id,duplicate:true,result:seen.result,production:false};
  }
  const order=db.prepare('SELECT * FROM r76_lab_orders WHERE order_id=? AND session_id=?')
   .get(session.client_reference_id,session.id);
  demand(order,'Unknown or mismatched pre-registered order/session');
  demand(order.amount_minor===session.amount_total&&order.currency===session.currency,
   'Payment amount or currency disagrees with trusted local order');
  const paid=session.payment_status==='paid';
  const result=!paid?'unpaid':order.status==='paid'?'already_paid':'paid';
  db.prepare('INSERT INTO r76_lab_events(event_id,raw_sha256,session_id,result,received_at_ms) VALUES(?,?,?,?,?)')
   .run(event.id,digest,session.id,result,now);
  if(result==='paid'){
   const updated=db.prepare("UPDATE r76_lab_orders SET status='paid' WHERE order_id=? AND status='awaiting_payment'")
    .run(order.order_id);
   demand(updated.changes===1,'Concurrent or duplicate payment registration');
   db.prepare('INSERT INTO r76_lab_receipts(order_id,event_id,amount_minor,currency,received_at_ms) VALUES(?,?,?,?,?)')
    .run(order.order_id,event.id,order.amount_minor,order.currency,now);
  }
  db.exec('COMMIT');
  return{eventId:event.id,duplicate:false,result,production:false};
 }catch(error){db.exec('ROLLBACK');throw error;}
}

/** Guardrail: even simulated paid receipts NEVER imply actual revenue. */
export function sandboxCommercialStatus(db){
 const counts=db.prepare("SELECT COUNT(*) AS events FROM r76_lab_events").get();
 const receipts=db.prepare('SELECT COUNT(*) AS receipts FROM r76_lab_receipts').get();
 return{contract:CONTRACT_VERSION,production:false,simulated:true,
  testEvents:counts.events,testReceipts:receipts.receipts,
  realPayments:null,verifiedImpressions:null,netRevenue:null,commercialLaunchAuthorized:false};
}
