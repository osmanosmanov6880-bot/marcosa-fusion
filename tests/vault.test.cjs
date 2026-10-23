'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const engine=require('../site/creator.js');
const vault=require('../site/creator-vault.js');

const ID='mc-12345678-1234-4123-8123-123456789abc';
const AT='2026-10-23T20:30:00.000Z';
const clone=v=>JSON.parse(JSON.stringify(v));
const draft=()=>engine.demoDraft();
const create=(changes={})=>vault.createRecord(draft(),{id:ID,created_at:AT,...changes});
const allChecks=()=>({authorship:true,sponsorship:true,editorial:true,privacy:true});

test('R9 validates the local project shape and strips all stale legal attestations',()=>{
  assert.equal(vault.WORKSPACE_SCHEMA,'marcosa-local-workspace/v1');
  assert.equal(vault.REVIEW_SCHEMA,'marcosa-review-packet/v1');
  assert.equal(vault.MAX_PROJECTS,8);
  assert.equal(vault.MAX_VERSIONS,15);
  const a=draft();a.rights_self_attested=true;a.sponsorship_disclosure_committed=true;
  const record=vault.createRecord(a,{id:ID,created_at:AT,note:'first save'});
  assert.deepEqual(vault.normalizeRecord(record),record);
  assert.equal(record.revisions.length,1);
  assert.equal(record.revisions[0].revision,1);
  assert.equal(record.revisions[0].draft.rights_self_attested,false);
  assert.equal(record.revisions[0].draft.sponsorship_disclosure_committed,false);
  assert.equal(record.revisions[0].draft.manual_approval,false);
  assert.equal(record.revisions[0].draft.publication_state,'not_published');
  assert.equal(vault.summarize(record).count,1);
  assert.equal(vault.summarize(record).version,1);
  assert.deepEqual(vault.CHECK_KEYS,['authorship','sponsorship','editorial','privacy']);
  assert.throws(()=>vault.createRecord(a,{id:'evil-id',created_at:AT}),/INVALID_REVISION_METADATA/);
  assert.throws(()=>vault.createRecord(a,{id:ID,created_at:'tomorrow'}),/INVALID_REVISION_METADATA/);
  assert.throws(()=>vault.createRecord(a,{id:ID,created_at:AT,note:'x'.repeat(141)}),/INVALID_REVISION_NOTE/);
});

test('R9 stores independent immutable snapshots and detects other-tab revision conflicts',()=>{
  const v1=create();
  const changed=draft();
  changed.title='Вторая версия города';
  changed.branches[0].scene='Новая сцена для проверки сохранения. Её текст заметно отличается от первоначального.';
  const v2=vault.appendRecord(v1,changed,{created_at:AT,note:'редактура',expected_revision:1});
  assert.equal(v1.title,engine.demoDraft().title);
  assert.equal(v1.revisions.length,1);
  assert.equal(v2.title,changed.title);
  assert.equal(v2.revisions.length,2);
  assert.deepEqual(v2.revisions.map(x=>x.revision),[1,2]);
  assert.notEqual(v2.revisions[1].created_at,v2.revisions[0].created_at,'timestamps remain ordered');
  assert.equal(v2.revisions[0].draft.title,v1.title,'older revision cannot be overwritten');
  assert.equal(v2.revisions[1].draft.title,changed.title);
  assert.throws(()=>vault.appendRecord(v2,draft(),{created_at:AT,expected_revision:1}),/STALE_VERSION/);
  assert.throws(()=>vault.appendRecord(v2,draft(),{created_at:'invalid',expected_revision:2}),/INVALID_REVISION_METADATA/);
  const diff=vault.diffDrafts(v1.revisions[0].draft,v2.revisions[1].draft);
  assert.deepEqual(diff.map(x=>x.field),['title','branches.0.scene']);
  assert.equal(diff[0].after,changed.title);
  assert.equal(vault.diffDrafts(v1.revisions[0].draft,v1.revisions[0].draft).length,0);
  assert.equal(JSON.stringify(v1.revisions[0]).includes('Вторая версия'),false);
});

test('R9 retains at most 15 meaningful revisions while preserving monotone version IDs',()=>{
  let record=create();
  for(let i=2;i<=27;i++){
    const changed=draft();changed.title='История номер '+i+' с отдельной редакцией';
    record=vault.appendRecord(record,changed,{created_at:AT,note:'R'+i,expected_revision:i-1});
  }
  assert.equal(record.revisions.length,15);
  assert.equal(record.revisions[0].revision,13);
  assert.equal(record.revisions[14].revision,27);
  assert.equal(record.title,'История номер 27 с отдельной редакцией');
  assert.equal(record.revisions[0].draft.title,'История номер 13 с отдельной редакцией');
  assert.deepEqual(vault.normalizeRecord(record),record);
});

test('R9 rejects unknown fields, false publication approvals, forged consent and version gaps',()=>{
  const base=create();
  const variants=[
    Object.assign(clone(base),{access_token:'nope'}),
    Object.assign(clone(base),{schema:'marcosa-cloud-account/v1'}),
    Object.assign(clone(base),{updated_at:'2030-01-01T00:00:00.000Z'}),
    Object.assign(clone(base),{title:'Not the last draft'}),
    Object.assign(clone(base),{id:'../escape'}),
    Object.assign(clone(base),{revisions:[]})
  ];
  for(const bad of variants)assert.throws(()=>vault.normalizeRecord(bad),/INVALID_|UNKNOWN_|INCONSISTENT_/);
  const forged=clone(base);forged.revisions[0].draft.manual_approval=true;
  assert.throws(()=>vault.normalizeRecord(forged),/INVALID_DRAFT_CONTRACT/);
  const forgedConsent=clone(base);forgedConsent.revisions[0].draft.rights_self_attested=true;
  assert.throws(()=>vault.normalizeRecord(forgedConsent),/STORED_CONSENT_IS_NOT_VALID/);
  const extras=clone(base);extras.revisions[0].secret='token';
  assert.throws(()=>vault.normalizeRecord(extras),/UNKNOWN_REVISION/);
  const gap=clone(base);gap.revisions.push(clone(gap.revisions[0]));
  gap.revisions[1].revision=3;
  assert.throws(()=>vault.normalizeRecord(gap),/INVALID_REVISION/);
  const prototype=JSON.parse(JSON.stringify(base).replace('"schema":','"__proto__":{"admin":true},"schema":'));
  assert.throws(()=>vault.normalizeRecord(prototype),/UNKNOWN_WORKSPACE_RECORD/);
});

test('R9 exports only a manual review packet, never a published or approved story',()=>{
  const record=create();
  const checks=allChecks();
  const packet=vault.reviewPacket(record,checks,{requested_at:AT});
  assert.equal(packet.schema,'marcosa-review-packet/v1');
  assert.equal(packet.status,'prepared_for_manual_review');
  assert.equal(packet.publication_state,'not_published');
  assert.equal(packet.source.project_id,ID);
  assert.equal(packet.source.revision,1);
  assert.equal(packet.rights_independently_verified,false);
  assert.equal(packet.editorially_approved,false);
  assert.equal(packet.security_verified,false);
  assert.equal(packet.approved_for_publication,false);
  assert.equal(packet.payments,false);
  assert.equal(packet.tracking,false);
  assert.deepEqual(packet.self_checklist,checks);
  assert.equal(packet.story.status,'draft_only');
  assert.equal(packet.story.rights_self_attested,false);
  assert.ok(packet.mandatory_review_gates.includes('manual_publication_approval'));
  assert.equal(JSON.stringify(packet).includes('private_key'),false);
  assert.throws(()=>vault.reviewPacket(record,{...checks,privacy:false},{requested_at:AT}),/REVIEW_CHECKS_REQUIRED/);
  assert.throws(()=>vault.reviewPacket(record,{...checks,admin:true},{requested_at:AT}),/UNKNOWN_REVIEW_CHECKS/);
  assert.throws(()=>vault.reviewPacket(record,checks,{requested_at:'INVALID'}),/REVIEW_CHECKS_REQUIRED/);
});

test('R9 rejects dangerous fields while keeping fiction as inert story text',()=>{
  const a=draft();
  a.opening.scene='Открывается книга с тегом <script>alert(1)</script>, который должен оставаться только текстом.';
  a.endings[2].body='Один персонаж произносит <img src=x onerror=alert(1)> как реплику, а не HTML-разметку.';
  const record=vault.createRecord(a,{id:ID,created_at:AT});
  assert.ok(record.revisions[0].draft.opening.scene.includes('<script>'));
  assert.ok(record.revisions[0].draft.endings[2].body.includes('<img '));
  assert.throws(()=>vault.createVault(null,null),/STORAGE_UNAVAILABLE/);
  const js=fs.readFileSync(path.join(__dirname,'../site/creator-vault.js'),'utf8');
  for(const forbidden of [
    'fetch(', 'XMLHttpRequest','sendBeacon','localStorage','sessionStorage',
    'document.cookie','innerHTML','eval(', 'new Function(', 'https://cdn',
    'navigator.serviceWorker','new WebSocket(', 'postMessage('
  ])assert.equal(js.includes(forbidden),false,'Forbidden API in local vault source: '+forbidden);
  assert.ok(js.includes('indexedDB.open('));
  assert.ok(js.includes("tx=db.transaction(STORE,mode)"),'transactions must be atomic');
  assert.ok(js.includes("textContent=text"),'untrusted values must only appear as text');
});

test('R9 public archive ships its complete UI with correct localized and accessible controls',()=>{
  const dir=path.join(__dirname,'../site');
  const html=fs.readFileSync(path.join(dir,'creator.html'),'utf8');
  const css=fs.readFileSync(path.join(dir,'creator.css'),'utf8');
  const engineJs=fs.readFileSync(path.join(dir,'creator.js'),'utf8');
  for(const id of [
    'mc-vault','mc-vault-heading','mc-project-name','mc-version-note','mc-save-revision',
    'mc-create-project','mc-project-list','mc-version-list','mc-delete-project',
    'mc-review-authorship','mc-review-sponsorship','mc-review-editorial','mc-review-privacy',
    'mc-export-review','mc-vault-feedback','mc-revision-diff','mc-current-version','mc-unsaved-label'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator.js"'));
  assert.ok(html.includes('src="./creator-vault.js"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(engineJs.includes('root.MarcosaCreatorRuntime=api.mount(root.document,root)'));
  assert.ok(engineJs.includes('getEditedDraft(){return readForm();}'));
  assert.ok(engineJs.includes('loadLocalDraft'));
  assert.match(css,/\.mc-vault-section/);
  assert.match(css,/@media\(max-width:570px\)/);
  assert.match(css,/:focus-visible/);
  for(const lng of ['ru','en','zh']){
    assert.ok(vault.mount&&vault.REVIEW_SCHEMA);
    const ui=fs.readFileSync(path.join(dir,'creator-vault.js'),'utf8');
    assert.ok(ui.includes(lng+':{'));
  }
});
