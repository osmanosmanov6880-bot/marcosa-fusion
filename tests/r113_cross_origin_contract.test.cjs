'use strict';
/* R113 regression requirements: the two-origin browser test is non-production. */
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('R113: a real Chrome profile crosses TWO different localhost origins with explicit JSON import',()=>{
 const source=read('tools/r113_two_origin_cdp.cjs');
 assert.match(source,/await listen\(serverA\),baseB=await listen\(serverB\)/);
 assert.match(source,/baseA===baseB/);
 assert.match(source,/await cdp\.navigate\(baseA\)/);
 assert.match(source,/await cdp\.navigate\(baseB,true\)/);
 assert.match(source,/R113_ORIGIN_B_INHERITED_A_DATA/);
 assert.match(source,/R113_REAL_CROSS_ORIGIN_EXPLICIT_RESTORE=PASS/);
 assert.match(source,/R113_CONFLICT_OVERWROTE_B_DATA/);
 assert.match(source,/R113_CORRUPT_ARCHIVE_CHANGED_STORAGE/);
 assert.match(source,/R113_ORIGIN_A_DATA_MODIFIED/);
 assert.match(source,/R113_EXTERNAL_PAGE_REQUESTS/);
 assert.match(source,/fs\.rmSync\(tmp,/);
 assert.doesNotMatch(source,/https:\/\/marcosa\.club\/|DEPLOY_SSH_KEY|systemctl|sudo /);
});
test('R113: source transfer retains explicit local-only export, import, conflicts, and malformed-archive guards',()=>{
 const src=read('site/social-transfer.js');
 const social=read('site/social.html');
 assert.match(src,/root\.localStorage/);
 assert.match(src,/function merge\(/);
 assert.match(src,/function parseBackup\(/);
 assert.match(src,/throw Error\('Это не проверенный архив MARCOSA Social v1'\)/);
 assert.match(src,/function persist\(/);
 assert.match(social,/JSON не зашифрован/);
 assert.match(social,/id="so-transfer-import-trigger"/);
 assert.match(social,/id="so-transfer-export"/);
 assert.doesNotMatch(src,/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\s*\(/);
});
test('R113: public Pages release pipeline includes the REAL two-origin check after signed build',()=>{
 const flow=read('.github/workflows/marcosa-public-pages.yml');
 assert.match(flow,/node --check tools\/r113_two_origin_cdp\.cjs/);
 assert.match(flow,/node tools\/r113_two_origin_cdp\.cjs/);
 assert.ok(flow.indexOf('python tools/build_webroot.py')<flow.indexOf('node tools/r113_two_origin_cdp.cjs'));
});
