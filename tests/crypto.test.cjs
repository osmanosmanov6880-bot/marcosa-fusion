'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const engine=require('../site/creator.js');
const vault=require('../site/creator-vault.js');
const backup=require('../site/creator-backup.js');
const secure=require('../site/creator-crypto.js');

const ID='mc-12345678-1234-4123-8123-123456789abc';
const PASS='Correct-Horse-Crimson-Nebula-2026';
const WHEN='2026-10-24T01:02:03.000Z';
function archive(){
  const story=engine.demoDraft();
  const record=vault.createRecord(story,{id:ID,created_at:WHEN,note:'Original story'});
  story.title='Звёздный город и герои';
  story.endings[0].body='Другой оригинальный финал с длинным русским описанием для проверки UTF-8.';
  const second=vault.appendRecord(record,story,{created_at:WHEN,expected_revision:1,note:'Editor revised outcome'});
  return backup.stringifyBackup([second],WHEN);
}
const clone=x=>JSON.parse(JSON.stringify(x));

test('R11 AES-256-GCM encrypt/decrypt preserves a full multiversion UTF-8 backup',async()=>{
  const plain=archive();
  const sealed=await secure.encryptBackup(plain,PASS,webcrypto);
  const parsed=secure.readEnvelope(sealed);
  assert.equal(parsed.envelope.schema,'marcosa-encrypted-vault/v1');
  assert.equal(parsed.envelope.kdf,'PBKDF2-HMAC-SHA-256');
  assert.equal(parsed.envelope.cipher,'AES-256-GCM');
  assert.equal(parsed.envelope.iterations,600000);
  assert.equal(parsed.salt.length,16);
  assert.equal(parsed.nonce.length,12);
  assert.ok(parsed.ciphertext.length>16);
  assert.equal(sealed.includes('Город последнего сигнала'),false);
  assert.equal(sealed.includes('Звёздный город'),false);
  assert.equal(sealed.includes(PASS),false);
  assert.equal(sealed.includes(ID),false);
  const restored=await secure.decryptBackup(sealed,PASS,webcrypto);
  assert.deepEqual(restored,backup.parseBackup(plain));
  assert.equal(restored.projects[0].revisions.length,2);
  assert.equal(restored.projects[0].revisions[0].draft.rights_self_attested,false);
  assert.equal(restored.projects[0].revisions[1].draft.manual_approval,false);
});
test('R11 wrong passphrase or tampered AES-GCM cipher/salt/nonce never reveals plaintext',async()=>{
  const sealed=await secure.encryptBackup(archive(),PASS,webcrypto);
  await assert.rejects(
    secure.decryptBackup(sealed,'Different-Correct-Looking-Password-2026',webcrypto),
    /DECRYPT_FAILED/
  );
  for(const field of ['ciphertext','salt','nonce']){
    const damaged=JSON.parse(sealed);
    const raw=damaged[field];
    damaged[field]=(raw[0]==='A'?'B':'A')+raw.slice(1);
    await assert.rejects(
      secure.decryptBackup(JSON.stringify(damaged),PASS,webcrypto),
      /DECRYPT_FAILED/,
      field
    );
  }
});
test('R11 fresh random salt and nonce yield different encrypted files for same story/password',async()=>{
  const plain=archive();
  const a=secure.readEnvelope(await secure.encryptBackup(plain,PASS,webcrypto));
  const b=secure.readEnvelope(await secure.encryptBackup(plain,PASS,webcrypto));
  assert.notEqual(a.envelope.salt,b.envelope.salt);
  assert.notEqual(a.envelope.nonce,b.envelope.nonce);
  assert.notEqual(a.envelope.ciphertext,b.envelope.ciphertext);
});
test('R11 validates passphrase length and rejects malformed envelopes before decrypting',async()=>{
  assert.equal(secure.passwordOK(PASS),true);
  for(const password of ['',null,12,'short','x'.repeat(257),'good-password\nX'])
    assert.equal(secure.passwordOK(password),false);
  const plain=archive();
  await assert.rejects(secure.encryptBackup(plain,'short',webcrypto),/INVALID_PASSPHRASE/);
  await assert.rejects(secure.encryptBackup(plain,PASS,null),/WEBCRYPTO_UNAVAILABLE/);
  await assert.rejects(secure.decryptBackup('bad','bad',webcrypto),/INVALID_PASSPHRASE/);
  await assert.rejects(secure.decryptBackup('bad',PASS,null),/WEBCRYPTO_UNAVAILABLE/);
  const sealed=await secure.encryptBackup(plain,PASS,webcrypto);
  const object=JSON.parse(sealed);
  assert.throws(()=>secure.readEnvelope('not-json'),/INVALID_ENCRYPTED_JSON/);
  assert.throws(()=>secure.readEnvelope('x'.repeat(secure.MAX_ENVELOPE_BYTES+1)),/ENCRYPTED_BACKUP_TOO_LARGE/);
  for(const [key,value] of [
    ['schema','a-malicious-schema'],
    ['cipher','AES-CBC'],
    ['kdf','PBKDF2-MD5'],
    ['iterations',1],
    ['iterations',1000000000]
  ])assert.throws(()=>secure.readEnvelope(JSON.stringify({...object,[key]:value})),/INVALID_ENCRYPTED_CONTRACT/);
  assert.throws(()=>secure.readEnvelope(JSON.stringify({...object,secret:'x'})),/UNKNOWN_ENCRYPTED_BACKUP/);
  assert.throws(()=>secure.readEnvelope(JSON.stringify({...object,salt:'bad-base64'})),/INVALID_CIPHERTEXT_ENCODING/);
  assert.throws(()=>secure.readEnvelope(JSON.stringify({...object,nonce:object.nonce.slice(0,20)})),/INVALID_ENCRYPTED_LENGTHS/);
  assert.throws(()=>secure.readEnvelope(JSON.stringify({...object,ciphertext:'A==='})),/INVALID_CIPHERTEXT_ENCODING/);
  assert.throws(()=>secure.readEnvelope('{}'),/UNKNOWN_ENCRYPTED_BACKUP/);
  const tampered=JSON.parse(JSON.stringify(object));
  tampered.ciphertext=tampered.ciphertext.slice(0,-4);
  assert.throws(()=>secure.readEnvelope(JSON.stringify(tampered)),/INVALID_CIPHERTEXT_ENCODING|INVALID_ENCRYPTED_LENGTHS/);
});
test('R11 refuses forged plaintext approvals and giant archives before writing encrypted data',async()=>{
  const forged=backup.parseBackup(archive());
  forged.projects[0].revisions[1].draft.manual_approval=true;
  await assert.rejects(
    secure.encryptBackup(JSON.stringify(forged),PASS,webcrypto),/INVALID_DRAFT_CONTRACT/
  );
  await assert.rejects(
    secure.encryptBackup(' '.repeat(backup.MAX_BYTES+1),PASS,webcrypto),/BACKUP_TOO_LARGE/
  );
});
test('R11 UI never persists passwords or transmits a backup through network APIs',()=>{
  const dir=path.resolve(__dirname,'../site');
  const js=fs.readFileSync(path.join(dir,'creator-crypto.js'),'utf8');
  const html=fs.readFileSync(path.join(dir,'creator.html'),'utf8');
  const css=fs.readFileSync(path.join(dir,'creator.css'),'utf8');
  for(const id of [
    'mc-crypto','mc-crypto-heading','mc-crypto-pass','mc-crypto-confirm',
    'mc-crypto-download','mc-crypto-file','mc-crypto-feedback'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator-crypto.js"'));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('autocomplete="new-password"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(js.includes("clearPasswords();lock(false);"),'passwords must be cleared on completion');
  assert.ok(js.includes("win.isSecureContext"),'use HTTPS or localhost only');
  assert.ok(js.includes("win.confirm(message)"),'require confirmation before modifying local archive');
  assert.ok(js.includes("store.restoreRecords("),'encrypted restore must use atomic R10 merge');
  assert.match(css,/\.mc-crypto-card/);
  assert.match(css,/@media\(max-width:570px\)/);
  for(const language of ['ru','en','zh']){
    assert.ok(secure.COPY[language].title.length>5);
    assert.ok(secure.COPY[language].warned.length>20);
  }
  for(const forbidden of [
    'fetch(', 'XMLHttpRequest','sendBeacon','new WebSocket(',
    'localStorage','sessionStorage','document.cookie','innerHTML',
    'eval(', 'new Function(', 'service_role','supabase.createClient('
  ])assert.equal(js.includes(forbidden),false,'forbidden source API: '+forbidden);
});
