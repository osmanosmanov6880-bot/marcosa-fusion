'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const creator=require('../site/creator.js');
const vault=require('../site/creator-vault.js');
const backup=require('../site/creator-backup.js');

const WHEN='2026-10-24T00:01:02.003Z';
const ID_A='mc-12345678-1234-4123-8123-123456789abc';
const ID_B='mc-22345678-1234-4123-8123-123456789abc';
const copy=x=>JSON.parse(JSON.stringify(x));
const project=(id=ID_A,at=WHEN)=>{
  let draft=creator.demoDraft();
  let record=vault.createRecord(draft,{id,created_at:at,note:'original'});
  draft.title='Переработанный космический сюжет';
  draft.endings[0].body='Новый финал сохраняет полноценный текст и отдельную творческую развилку.';
  record=vault.appendRecord(record,draft,{created_at:at,expected_revision:1,note:'revision two'});
  return record;
};
test('R10 whole-vault JSON round trip keeps every retained story revision intact',()=>{
  const records=[project(ID_A),project(ID_B)];
  const text=backup.stringifyBackup(records,WHEN);
  const recovered=backup.parseBackup(text);
  assert.equal(recovered.schema,'marcosa-local-vault-backup/v1');
  assert.equal(recovered.exported_at,WHEN);
  assert.deepEqual(recovered.projects,records);
  assert.equal(recovered.projects.length,2);
  assert.deepEqual(recovered.projects.map(x=>x.revisions.length),[2,2]);
  assert.equal(recovered.projects[0].revisions[0].revision,1);
  assert.equal(recovered.projects[0].revisions[1].revision,2);
  assert.equal(recovered.projects[0].revisions[1].draft.manual_approval,false);
  assert.equal(recovered.projects[0].revisions[1].draft.rights_self_attested,false);
  assert.ok(Buffer.byteLength(text,'utf8')<=backup.MAX_BYTES);
  assert.equal(backup.MAX_BYTES,2*1024*1024);
});
test('R10 strictly denies corrupted backups, unknown fields, forged moderation and duplicates',()=>{
  const original=backup.parseBackup(backup.stringifyBackup([project()],WHEN));
  const bad=[
    {...original,schema:'marcosa-local-vault-backup/v666'},
    {...original,service_role:'dont-ever-trust-extra-fields'},
    {...original,exported_at:'not-a-date'},
    {...original,projects:[...original.projects,...original.projects]},
    {...original,projects:Array(9).fill(original.projects[0])},
    {...original,projects:{not:'an-array'}},
    {...original,projects:[{...original.projects[0],token:'secret'}]}
  ];
  for(const entry of bad)
    assert.throws(()=>backup.normalizeBackup(entry),/INVALID_|UNKNOWN_|DUPLICATE_/);
  const forged=copy(original);forged.projects[0].revisions[1].draft.manual_approval=true;
  assert.throws(()=>backup.normalizeBackup(forged),/INVALID_DRAFT_CONTRACT/);
  const forgedConsent=copy(original);forgedConsent.projects[0].revisions[1].draft.rights_self_attested=true;
  assert.throws(()=>backup.normalizeBackup(forgedConsent),/STORED_CONSENT_IS_NOT_VALID/);
  const malicious=JSON.parse(JSON.stringify(original).replace('"schema":','"__proto__":{"polluted":true},"schema":'));
  assert.throws(()=>backup.normalizeBackup(malicious),/UNKNOWN_BACKUP/);
  assert.throws(()=>backup.parseBackup(' ' .repeat(backup.MAX_BYTES+1)),/BACKUP_TOO_LARGE/);
  assert.throws(()=>backup.parseBackup('{"not valid"}'),SyntaxError);
  assert.throws(()=>backup.stringifyBackup([project()], '2026-12-01'),/INVALID_BACKUP_CONTRACT/);
});
test('R10 non-destructive restore plan is idempotent and retains diverging histories',()=>{
  const same=project(ID_A),another=project(ID_B);
  const plain=backup.planRestore([same,another],[]);
  assert.deepEqual({...plain},{incoming:2,added:2,skipped:0,conflicts:0,capacity:2,canRestore:true});
  const duplicate=backup.planRestore([same],[same]);
  assert.equal(duplicate.added,0);
  assert.equal(duplicate.skipped,1);
  assert.equal(duplicate.conflicts,0);
  assert.equal(duplicate.canRestore,true);
  const updated=copy(same);
  updated.revisions[1].draft.title='Обновлённый сюжет в текущем браузере';
  updated.title=updated.revisions[1].draft.title;
  const conflict=backup.planRestore([same],[updated]);
  assert.equal(conflict.added,0);
  assert.equal(conflict.skipped,0);
  assert.equal(conflict.conflicts,1,'different version must be copied, not overwritten');
  assert.equal(conflict.capacity,2);
  assert.equal(conflict.canRestore,true);
  const full=[same,another,...Array.from({length:6},(_,i)=>project(
    'mc-'+(i+3).toString(16).padStart(8,'0')+'-1234-4123-8123-123456789abc'
  ))];
  assert.equal(full.length,8);
  assert.equal(backup.planRestore([same],full).canRestore,true);
  assert.equal(backup.planRestore([updated],full).canRestore,false);
  assert.throws(()=>backup.planRestore([same,same],[]),/DUPLICATE_BACKUP_IDS/);
});
test('R10 portable JSON is no-network, no secret keys, optional and uses accessible UI',()=>{
  const root=path.join(__dirname,'../site');
  const js=fs.readFileSync(path.join(root,'creator-backup.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'creator.html'),'utf8');
  const vaultJS=fs.readFileSync(path.join(root,'creator-vault.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'creator.css'),'utf8');
  for(const id of ['mc-backup','mc-backup-heading','mc-backup-download',
    'mc-backup-file','mc-backup-feedback'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator-backup.js"'));
  assert.ok(html.includes('accept=".json,application/json"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('data-mcb-text="warning"'));
  assert.ok(js.includes('new TextEncoder()'),'byte cap must cover UTF-8 JSON');
  assert.ok(js.includes('vault.normalizeRecord'),'backup must reuse strict R9 schema');
  assert.ok(vaultJS.includes("async restoreRecords(records)"));
  assert.ok(vaultJS.includes("return run('readwrite'"),'all-or-nothing atomic restore');
  assert.ok(vaultJS.includes('store.add(project)'),'never overwrite a diverging old project');
  assert.ok(!vaultJS.includes('store.put(project)'),'restore must not upsert existing projects');
  assert.match(css,/\.mc-backup-card/);
  for(const lng of ['ru','en','zh']){
    assert.ok(backup.COPY[lng].title.length);
    assert.ok(backup.COPY[lng].warning.length);
    assert.ok(backup.COPY[lng].prompt.length);
  }
  for(const bad of ['fetch(', 'XMLHttpRequest','sendBeacon','WebSocket(', 'localStorage',
    'sessionStorage','document.cookie','innerHTML','eval(', 'new Function(', 'service_role',
    'new Image(', 'supabase.createClient('])
    assert.ok(!js.includes(bad),'unsafe API found: '+bad);
});
