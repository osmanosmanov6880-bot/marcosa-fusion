/**
 * Offline operator execution ledger for the exact eight R193 controls.
 * Hash-linked transitions document task progress, NOT legal or production GO.
 */
import {H40,H64,plain,requireTrue,verifyReceipt,sealReceipt,sha256} from '../r190/common.mjs';
import {R193_POLICY} from '../r193/assessment.mjs';
const tasks=R193_POLICY.map(x=>x.id);
const states=['OPEN','IN_PROGRESS','BLOCKED_LOCAL','DONE_LOCAL'];
const transitions={
 START:['OPEN','BLOCKED_LOCAL'],
 BLOCK:['OPEN','IN_PROGRESS'],
 COMPLETE:['IN_PROGRESS'],
 REOPEN:['DONE_LOCAL','BLOCKED_LOCAL']
};
const resulting={
 START:'IN_PROGRESS',BLOCK:'BLOCKED_LOCAL',
 COMPLETE:'DONE_LOCAL',REOPEN:'OPEN'
};
export function createR194TaskLedger({commit,bundleSha256,assessment,clock=()=>Date.now()}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&typeof clock==='function',
  'source-bound task ledger required');
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 requireTrue(Array.isArray(a.controls)&&a.controls.length===8&&
  a.controls.every((x,i)=>x.id===tasks[i]&&x.allowedForRelease===false),
  'complete original eight-control assessment required');
 const createdAtMs=clock();
 requireTrue(Number.isSafeInteger(createdAtMs)&&createdAtMs>=a.observedAtMs&&
  createdAtMs<=a.expiresAtMs,'ledger must start during source receipt validity');
 return sealReceipt({schemaVersion:1,kind:'R194_TASK_LEDGER',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  assessmentSha256:a.evidenceSha256,
  createdAtMs,updatedAtMs:createdAtMs,events:[],
  progress:Object.fromEntries(tasks.map(id=>[id,'OPEN'])),
  lastEventSha256:sha256('MARCOSA_R194_GENESIS:'+commit+':'+a.evidenceSha256),
  decision:'NO_GO_OPERATOR_TASKS_ARE_NOT_RELEASE_APPROVALS',
  realPilotAuthorized:false,productionAuthorized:false});
}
export function verifyR194TaskLedger({ledger,assessment,commit,bundleSha256}={}){
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 const x=verifyReceipt(ledger,'R194_TASK_LEDGER',commit,bundleSha256);
 requireTrue(x.assessmentSha256===a.evidenceSha256&&
  x.decision==='NO_GO_OPERATOR_TASKS_ARE_NOT_RELEASE_APPROVALS'&&
  Number.isSafeInteger(x.createdAtMs)&&x.createdAtMs>=a.observedAtMs&&
  x.createdAtMs<=a.expiresAtMs&&
  Number.isSafeInteger(x.updatedAtMs)&&x.updatedAtMs>=x.createdAtMs&&
  Array.isArray(x.events)&&x.events.length<=200&&plain(x.progress)&&
  Object.keys(x.progress).sort().join(',')===tasks.slice().sort().join(','),
  'task ledger content, source or chronology invalid');
 const state=Object.fromEntries(tasks.map(id=>[id,'OPEN']));
 let previous=sha256('MARCOSA_R194_GENESIS:'+commit+':'+a.evidenceSha256);
 let last=x.createdAtMs;
 for(const event of x.events){
  requireTrue(plain(event)&&Object.keys(event).sort().join(',')===
   'action,atMs,control,eventSha256,from,owner,previousEventSha256,to'&&
   tasks.includes(event.control)&&
   event.owner===R193_POLICY[tasks.indexOf(event.control)].owner&&
   Object.hasOwn(transitions,event.action)&&
   transitions[event.action].includes(event.from)&&
   event.from===state[event.control]&&
   event.to===resulting[event.action]&&
   event.previousEventSha256===previous&&
   Number.isSafeInteger(event.atMs)&&
   event.atMs>=last&&event.atMs<=a.expiresAtMs,
   'invalid task owner, state transition or monotonic timestamp');
  const {eventSha256,...raw}=event;
  requireTrue(H64.test(eventSha256||'')&&sha256(raw)===eventSha256,
   'task event hash chain is broken');
  previous=eventSha256;
  state[event.control]=event.to;last=event.atMs;
 }
 requireTrue(tasks.every(id=>x.progress[id]===state[id])&&
  x.lastEventSha256===previous&&x.updatedAtMs===last&&
  tasks.every(id=>states.includes(x.progress[id])),
  'task ledger snapshot differs from replayed events');
 return x;
}
export function appendR194TaskEvent({
 ledger,assessment,commit,bundleSha256,control,action,clock=()=>Date.now()
}={}){
 const x=verifyR194TaskLedger({ledger,assessment,commit,bundleSha256});
 requireTrue(tasks.includes(control)&&Object.hasOwn(transitions,action)&&
  transitions[action].includes(x.progress[control])&&
  x.events.length<200&&typeof clock==='function',
  'invalid or too many local execution transitions');
 const atMs=clock();
 requireTrue(Number.isSafeInteger(atMs)&&atMs>=x.updatedAtMs&&
  atMs<=assessment.expiresAtMs,'task event out of source validity interval');
 const raw={control,action,from:x.progress[control],to:resulting[action],
  owner:R193_POLICY[tasks.indexOf(control)].owner,
  atMs,previousEventSha256:x.lastEventSha256};
 const event={...raw,eventSha256:sha256(raw)};
 return verifyR194TaskLedger({ledger:sealReceipt({
  schemaVersion:1,kind:'R194_TASK_LEDGER',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  assessmentSha256:x.assessmentSha256,createdAtMs:x.createdAtMs,
  updatedAtMs:atMs,events:[...x.events,event],
  progress:{...x.progress,[control]:resulting[action]},
  lastEventSha256:event.eventSha256,
  decision:x.decision,realPilotAuthorized:false,productionAuthorized:false
 }),assessment,commit,bundleSha256});
}
