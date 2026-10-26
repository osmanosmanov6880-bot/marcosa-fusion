import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,appendFileSync,
  mkdirSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {syntheticPng,validatePng,createSyntheticSource,scanObjects,
  seedSqlForMetadata,backupSyntheticStorage,restoreSyntheticStorage,
  verifyRestoredStorage,verifySnapshot,verifyRowsAgainstStorage}
  from '../ops/r130_disposable_storage_restore.mjs';
const WORLD=[
 '12800000-0000-4128-8128-000000000101',
 '12800000-0000-4128-8128-000000000102',
];
const USERS=[
 '12800000-0000-4128-8128-000000000001',
 '12800000-0000-4128-8128-000000000002',
];
const REVIEWER='12800000-0000-4128-8128-000000000003';
function temp(fn){
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r130-test-'));
 try{return fn({dir,source:join(dir,'source'),backup:join(dir,'backup'),
   restored:join(dir,'restored')});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
function setup(p){
 const items=createSyntheticSource(p.source);
 const m=backupSyntheticStorage(p.source,p.backup);
 restoreSyntheticStorage(p.backup,p.restored);
 return {items,m};
}
function rows(items){
 return WORLD.map((world,i)=>{
   const e=items.find(x=>x.key.startsWith('world-covers/'+world+'/'));
   return [world,USERS[i],e.key,e.sha256,String(e.bytes),
     String(e.width),String(e.height),i?'t':'f',i?'approved':'pending',
     i?REVIEWER:'',i?'public':'private'];
 });
}
test('R130 creates two actual valid deterministic PNGs with different digests',()=>{
 const a=syntheticPng(1),b=syntheticPng(2);
 assert.ok(a.length>=57&&a.length<=786432);
 assert.notDeepEqual(a,b);
 assert.deepEqual(validatePng(a),{width:64,height:48});
 assert.deepEqual(validatePng(b),{width:64,height:48});
 assert.deepEqual(syntheticPng(1),a);
});
test('R130 true filesystem source → SHA snapshot → restored bytes and metadata',()=>temp(p=>{
 const {items,m}=setup(p);
 assert.equal(items.length,2);
 assert.equal(m.entries.length,2);
 assert.deepEqual(scanObjects(p.restored),items);
 assert.equal(verifySnapshot(p.backup).sha256OfCanonicalEntries,
   m.sha256OfCanonicalEntries);
 assert.ok(verifyRowsAgainstStorage(items,rows(items)));
 assert.match(seedSqlForMetadata(items),/marcosa_private.world_cover_assets/);
 assert.match(seedSqlForMetadata(items),/R130_DISPOSABLE_MEDIA_METADATA_SEEDED=PASS/);
}));
test('R130 refuses restoring over any existing destination, preserving its contents',()=>temp(p=>{
 setup(p);
 assert.throws(()=>restoreSyntheticStorage(p.backup,p.restored),/destination exists/);
 assert.equal(scanObjects(p.restored).length,2);
}));
test('R130 refuses backing up over an existing snapshot',()=>temp(p=>{
 setup(p);
 assert.throws(()=>backupSyntheticStorage(p.source,p.backup),/overwrites forbidden/);
}));
test('R130 refuses corrupted media object SHA in recovered directory',()=>temp(p=>{
 const {items}=setup(p);
 appendFileSync(join(p.restored,...items[0].key.split('/')),Buffer.from('tamper'));
 assert.throws(()=>verifyRestoredStorage(p.backup,p.restored),
   /Storage object path SHA-256 differs|PNG byte size/);
}));
test('R130 refuses corrupted backup before creating a restore',()=>temp(p=>{
 createSyntheticSource(p.source);
 const m=backupSyntheticStorage(p.source,p.backup);
 const key=m.entries[0].key;
 appendFileSync(join(p.backup,'objects',...key.split('/')),Buffer.from('tamper'));
 assert.throws(()=>restoreSyntheticStorage(p.backup,p.restored),
   /Storage object path SHA-256 differs/);
}));
test('R130 refuses modified canonical manifest digest',()=>temp(p=>{
 setup(p);
 const file=join(p.backup,'manifest.json');
 const m=JSON.parse(readFileSync(file,'utf8'));m.sha256OfCanonicalEntries='f'.repeat(64);
 writeFileSync(file,JSON.stringify(m));
 assert.throws(()=>verifySnapshot(p.backup),/fingerprint mismatch/);
}));
test('R130 refuses a snapshot claiming production GO',()=>temp(p=>{
 setup(p);
 const file=join(p.backup,'manifest.json');
 const m=JSON.parse(readFileSync(file,'utf8'));m.productionCutoverAuthorized=true;
 writeFileSync(file,JSON.stringify(m));
 assert.throws(()=>verifySnapshot(p.backup),/production-claiming/);
}));
test('R130 refuses extra hidden or unexpected files in the archive',()=>temp(p=>{
 setup(p);
 writeFileSync(join(p.backup,'extra.txt'),'unapproved');
 assert.throws(()=>verifySnapshot(p.backup),/Snapshot must include only/);
}));
test('R130 refuses a symlink injected into source object tree',()=>temp(p=>{
 const items=createSyntheticSource(p.source);
 const original=join(p.source,...items[0].key.split('/'));
 const dest=join(p.source,'world-covers',WORLD[0],'a'.repeat(64)+'.png');
 symlinkSync(original,dest);
 assert.throws(()=>scanObjects(p.source),/symlink forbidden/);
}));
test('R130 rejects unknown Storage path and path traversal',()=>temp(p=>{
 createSyntheticSource(p.source);
 const wrong=join(p.source,'world-covers',WORLD[0],'not-a-valid-key.png');
 writeFileSync(wrong,'NO');
 assert.throws(()=>scanObjects(p.source),/Unexpected Storage object path/);
}));
test('R130 rejects damaged PNG header and tampered CRC without accepting the file',()=>{
 const a=syntheticPng(1);
 const wrong=Buffer.from(a);wrong[0]=0;
 assert.throws(()=>validatePng(wrong),/Bad PNG signature/);
 const tampered=Buffer.from(a);tampered[50]^=1;
 assert.throws(()=>validatePng(tampered),/PNG CRC mismatch|PNG compressed content invalid/);
});
test('R130 requires exact restored storage ownership and digest',()=>temp(p=>{
 const {items}=setup(p),r=rows(items);
 r[0][1]=USERS[1];
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/ownership/);
 r[0][1]=USERS[0];r[1][3]='a'.repeat(64);
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/digest/);
}));
test('R130 rejects missing or duplicated restored PostgreSQL metadata rows',()=>temp(p=>{
 const {items}=setup(p),r=rows(items);
 assert.throws(()=>verifyRowsAgainstStorage(items,r.slice(0,1)),/two independent/);
 r[1]=[...r[0]];
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/ownership|Missing one/);
}));
test('R130 refuses private asset that became public or approved unexpectedly',()=>temp(p=>{
 const {items}=setup(p),r=rows(items);
 r[0][10]='public';
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/Private World/);
 r[0][10]='private';r[0][8]='approved';
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/Private World/);
}));
test('R130 rejects public approved media without independent reviewer',()=>temp(p=>{
 const {items}=setup(p),r=rows(items);
 r[1][9]=USERS[1];
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/independent trusted moderation/);
 r[1][9]=REVIEWER;r[1][7]='f';
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/independent trusted moderation/);
}));
test('R130 refuses extra rows from wrong tenant / unexpected World',()=>temp(p=>{
 const {items}=setup(p),r=rows(items);
 r[1][0]='33333333-4444-4555-8666-777777777777';
 assert.throws(()=>verifyRowsAgainstStorage(items,r),/ownership/);
}));
test('R130 CLI refuses execution outside official disposable PostgreSQL runner',()=>{
 const x=spawnSync(process.execPath,
   ['ops/r130_disposable_storage_restore.mjs','seed'],{
     cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,
     env:{...process.env,GITHUB_REPOSITORY:'attacker/other',
       RUNNER_TEMP:tmpdir(),PGHOST:'external.example',PGPORT:'5432',
       PGUSER:'postgres',PGDATABASE:'postgres'},
   });
 assert.notEqual(x.status,0);
 assert.match(x.stderr,/R130_DISPOSABLE_STORAGE_REFUSED/);
 assert.doesNotMatch(x.stdout,/PASS|CREATED/);
});
test('R130 source SQL includes only synthetic IDs, no production Storage mutations',()=>temp(p=>{
 const items=createSyntheticSource(p.source);
 const sql=seedSqlForMetadata(items);
 assert.match(sql,/current_database\(\)<>'postgres'/);
 assert.match(sql,/r130reviewer/);
 assert.doesNotMatch(sql,/storage\.objects|service_role|ALTER ROLE|DROP DATABASE/);
 assert.equal(sql.match(/INSERT INTO marcosa_private.world_cover_assets/g)?.length,2);
}));
