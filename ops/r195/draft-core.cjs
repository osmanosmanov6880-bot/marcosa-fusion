/* MARCOSA R195 portable draft v2. No network/storage. SHA-256 is an
 * integrity checksum, NOT a digital signature or proof of human identity. */
(function (root) {
  'use strict';
  var IDS = ['SOURCE_AND_CI','PR_REVIEWS','HUMAN_IDENTITY',
    'GITHUB_ENVIRONMENT','TLS_ORIGIN','AWS_EFFECTIVE_RIGHTS',
    'STAGING_RESTORE','PRIVACY_LEGAL'];
  var FROM = { START:['OPEN','BLOCKED_LOCAL'], BLOCK:['OPEN','IN_PROGRESS'],
    COMPLETE:['IN_PROGRESS'], REOPEN:['DONE_LOCAL','BLOCKED_LOCAL'] };
  var TO = { START:'IN_PROGRESS',BLOCK:'BLOCKED_LOCAL',
    COMPLETE:'DONE_LOCAL',REOPEN:'OPEN' };
  var STATES = ['OPEN','IN_PROGRESS','BLOCKED_LOCAL','DONE_LOCAL'];
  var H40 = /^[a-f0-9]{40}$/, H64 = /^[a-f0-9]{64}$/;
  function demand(v,m) { if (!v) { throw Error('R195 draft: '+m); } }
  function object(x) { return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
    (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null); }
  function exact(x,names) {
    return object(x)&&Object.keys(x).sort().join(',')===names.slice().sort().join(',');
  }
  function ordered(x) {
    demand(object(x)&&Object.keys(x).length===IDS.length&&
      IDS.every(function (id) { return Object.prototype.hasOwnProperty.call(x,id)&&
        STATES.includes(x[id]); }), 'eight exact initial task states required');
    var result={}; IDS.forEach(function(id){result[id]=x[id];});return result;
  }
  async function digest(value) {
    demand(root.crypto&&root.crypto.subtle&&typeof root.TextEncoder==='function',
      'secure SHA-256 API unavailable');
    var bytes=new root.TextEncoder().encode(value);
    var out=await root.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(out),function(x){return x.toString(16).padStart(2,'0');}).join('');
  }
  function context(x) {
    demand(object(x)&&H40.test(x.sourceCommit||'')&&H64.test(x.assessmentSha256||''),
      'exact commit and source assessment SHA required');
    return {sourceCommit:x.sourceCommit,assessmentSha256:x.assessmentSha256,
      initialProgress:ordered(x.initialProgress)};
  }
  async function genesis(x) {
    return digest('MARCOSA/R195/LOCAL-ONLY/GENESIS/v2\n'+
      JSON.stringify([x.sourceCommit,x.assessmentSha256,x.initialProgress]));
  }
  async function create(input) {
    var x=context(input),head=await genesis(x);
    return {schemaVersion:2,kind:'R195_LOCAL_DRAFT',sourceMode:'LOCAL_UNTRUSTED',
      sourceCommit:x.sourceCommit,assessmentSha256:x.assessmentSha256,
      initialProgress:x.initialProgress,progress:ordered(x.initialProgress),
      events:[],headSha256:head,decision:'NO_GO',
      realPilotAuthorized:false,productionAuthorized:false};
  }
  async function verify(data,reference) {
    demand(exact(data,['schemaVersion','kind','sourceMode','sourceCommit',
      'assessmentSha256','initialProgress','progress','events','headSha256',
      'decision','realPilotAuthorized','productionAuthorized']),
      'unexpected draft keys');
    var x=context(reference);
    demand(data.schemaVersion===2&&data.kind==='R195_LOCAL_DRAFT'&&
      data.sourceMode==='LOCAL_UNTRUSTED'&&data.sourceCommit===x.sourceCommit&&
      data.assessmentSha256===x.assessmentSha256&&
      data.decision==='NO_GO'&&data.realPilotAuthorized===false&&
      data.productionAuthorized===false&&H64.test(data.headSha256||'')&&
      Array.isArray(data.events)&&data.events.length<=200,
      'foreign source, false GO or excessive history');
    var initial=ordered(data.initialProgress),state=ordered(data.progress);
    demand(IDS.every(function(id){return initial[id]===x.initialProgress[id];}),
      'imported draft redefines the pinned initial state');
    var last=await genesis(x),prevAt=0;
    for (var i=0;i<data.events.length;i++) {
      var e=data.events[i];
      demand(exact(e,['control','action','from','to','atMs',
        'previousSha256','eventSha256'])&&IDS.includes(e.control)&&
        Object.prototype.hasOwnProperty.call(FROM,e.action)&&
        e.from===initial[e.control]&&
        FROM[e.action].includes(e.from)&&e.to===TO[e.action]&&
        H64.test(e.eventSha256||'')&&e.previousSha256===last&&
        Number.isSafeInteger(e.atMs)&&e.atMs>=prevAt&&e.atMs>0,
        'invalid transition, chronology or hash ancestry');
      var raw={control:e.control,action:e.action,from:e.from,to:e.to,
        atMs:e.atMs,previousSha256:e.previousSha256};
      var signature=await digest('MARCOSA/R195/LOCAL-ONLY/EVENT/v2\n'+JSON.stringify(raw));
      demand(signature===e.eventSha256,'local event hash mismatch');
      last=signature;prevAt=e.atMs;initial[e.control]=e.to;
    }
    demand(last===data.headSha256&&IDS.every(function(id){
      return initial[id]===state[id];}),'transcript/replayed progress differs');
    return true;
  }
  async function append(data,reference,control,action,time) {
    await verify(data,reference);
    demand(IDS.includes(control)&&Object.prototype.hasOwnProperty.call(FROM,action)&&
      FROM[action].includes(data.progress[control])&&data.events.length<200,
      'prohibited state transition or event cap');
    var atMs=time===undefined?Date.now():time;
    demand(Number.isSafeInteger(atMs)&&atMs>0&&
      (!data.events.length||atMs>=data.events[data.events.length-1].atMs),
      'invalid event timestamp');
    var raw={control:control,action:action,from:data.progress[control],
      to:TO[action],atMs:atMs,previousSha256:data.headSha256};
    var event={...raw,eventSha256:await digest(
      'MARCOSA/R195/LOCAL-ONLY/EVENT/v2\n'+JSON.stringify(raw))};
    var out={...data,events:data.events.concat(event),
      progress:{...data.progress,[control]:TO[action]},
      headSha256:event.eventSha256};
    await verify(out,reference);
    return out;
  }
  async function importText(text,reference) {
    demand(typeof text==='string'&&text.length>=250&&text.length<=70000,
      'draft file exceeds safe size or is empty');
    var x;
    try{x=JSON.parse(text);}catch(_){throw Error('R195 draft: invalid JSON');}
    await verify(x,reference);
    return x;
  }
  var api=Object.freeze({IDS:IDS.slice(),STATES:STATES.slice(),
    FROM:FROM,TO:TO,create:create,verify:verify,append:append,
    importText:importText,exportText:function(x){return JSON.stringify(x,null,2)+'\n';}});
  if (typeof module==='object'&&module.exports)module.exports=api;
  root.MarcosaR195Draft=api;
})(typeof globalThis==='object'?globalThis:this);
