/**
 * R195 verified rich offline Audit Desk: all comparisons are source-bound,
 * all actions local, every displayed claim remains NO-GO. Single CSP
 * SHA-256 inline script, no external network/storage/tracking.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {H40,H64,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {renderR194Interactive} from '../r194/interactive-dashboard.mjs';
import {verifyR194TaskLedger} from '../r194/task-ledger.mjs';
import {R193_POLICY} from '../r193/assessment.mjs';
import {buildR195Handoffs} from './handoffs.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const css=[
 '.r195-section{border:1px solid #2b3d5c;border-radius:19px;background:#0e1a31;padding:clamp(17px,3vw,30px)}',
 '.r195-matrix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}',
 '.r195-row{padding:17px;border-radius:13px;border:1px solid #304361;background:#12213d;min-width:0}',
 '.r195-row strong{display:block;font-size:13px;margin-bottom:6px;font-weight:600;overflow-wrap:anywhere}',
 '.r195-row small{display:block;color:#b0c4e0;font-size:12px;line-height:1.5}',
 '.r195-flag{display:inline-block;font-size:11px;color:#e6bd8d;letter-spacing:.04em;margin-bottom:6px}',
 '.r195-flag.risk{color:#f5aea5}.r195-flag.better{color:#bbd7c7}',
 '.r195-handoff{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}',
 '.r195-owner{border:1px solid #324361;border-radius:12px;padding:17px;background:#0d1b35}',
 '.r195-owner strong{display:block;font-size:13px;letter-spacing:.07em}',
 '.r195-owner small{display:block;margin:8px 0 15px;color:#a8bbd4}',
 '.r195-action,.r195-button{font:inherit;background:#192e4c;color:#e5edfc;border:1px solid #5a6c8c;min-height:43px;padding:10px 13px;border-radius:9px;font-size:12px;cursor:pointer}',
 '.r195-action:disabled{opacity:.34;cursor:not-allowed}',
 '.r195-action:hover:not(:disabled),.r195-button:hover{border-color:#dfc48b}',
 '.r195-controls{border-top:1px solid #344661;padding-top:15px;margin-top:16px}',
 '.r195-progress{font-size:12px;color:#d8ba86;display:block;margin-bottom:12px}',
 '.r195-buttons{display:flex;gap:7px;flex-wrap:wrap}',
 '.r195-filezone{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}',
 '.r195-label{display:block;font-size:13px;margin-bottom:8px;color:#d2ddf2}',
 '.r195-file,.r195-textarea,.r195-select{width:100%;border:1px solid #526581;border-radius:10px;background:#101e37;color:#f0f4fa;padding:11px;font:inherit;font-size:13px}',
 '.r195-textarea{font-family:ui-monospace,monospace;min-height:145px;resize:vertical;font-size:12px}',
 '.r195-select{min-height:44px}',
 '.r195-buttons-row{display:flex;gap:9px;flex-wrap:wrap;margin:13px 0}',
 '.r195-history{margin:10px 0 0;padding-left:22px;color:#b7c9df;font-size:12px;line-height:1.9;max-height:320px;overflow-y:auto}',
 '.r195-helper{font-size:12px;color:#a5b9d4;margin-top:10px;line-height:1.6}',
 '.r195-status{font-size:12px;color:#e5c9a4;min-height:40px;margin-top:10px}',
 '.r195-summary{margin:15px 0;color:#acbfdb;font-size:13px}',
 '.r195-tag{font-size:11px;color:#dbbe8b;font-weight:500}',
 '.r194-exchange[hidden]{display:none!important}',
 'button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #dfc48b;outline-offset:3px}',
 '@media(max-width:800px){.r195-handoff{grid-template-columns:repeat(2,minmax(0,1fr))}}',
 '@media(max-width:650px){.r195-filezone,.r195-matrix,.r195-handoff{grid-template-columns:1fr}}',
 '@media print{.r195-controls,.r195-filezone,.r195-action,.r195-button,.r195-history{display:none!important}}'
].join('\n');
const riskText={
 UNMODIFIED:'Без изменений',DEGRADED:'УХУДШЕНИЕ',REPORTED_IMPROVEMENT:'Заявлено улучшение'
};
const evidenceText={
 UNCHANGED:'Без изменений',ADDED:'Добавлено',WITHDRAWN:'Удалено',
 HASH_CHANGED:'Изменён SHA-256',CLAIM_CHANGED:'Изменено заявление',
 HASH_AND_CLAIM_CHANGED:'Изменены SHA-256 и статус'
};
export function renderR195Dashboard({
 commit,bundleSha256,assessment,ledger,evidenceDelta,riskTrend
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||''),
  'exact source for offline R195 dashboard required');
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 const l=verifyR194TaskLedger({ledger,assessment:a,commit,bundleSha256});
 const d=verifyReceipt(evidenceDelta,'R194_EVIDENCE_DELTA',commit,bundleSha256);
 const t=verifyReceipt(riskTrend,'R194_RISK_TREND',commit,bundleSha256);
 const h=buildR195Handoffs({commit,bundleSha256,assessment:a,
  ledger:l,evidenceDelta:d,riskTrend:t});
 const base=renderR194Interactive({commit,bundleSha256,assessment:a,
  ledger:l,evidenceDelta:d,riskTrend:t});
 const core=readFileSync(new URL('./draft-core.cjs',import.meta.url),'utf8');
 const client=readFileSync(new URL('./client.js',import.meta.url),'utf8');
 const script=core+'\n'+client;
 requireTrue(script.length>=6000&&script.length<=45000&&
  !script.includes('</script')&&!script.includes('fetch(')&&
  !script.includes('localStorage')&&!script.includes('XMLHttpRequest'),
  'R195 browser source must be self-contained, offline and bounded');
 const riskCards=t.changes.map((x,i)=>{
  requireTrue(x.id===R193_POLICY[i].id&&Object.hasOwn(riskText,x.status)&&
   x.productionAuthorized===false&&x.requiresExternalVerification===true,
   'untrusted risk data is not displayable');
  return '<div class="r195-row"><span class="r195-flag '+
   (x.status==='DEGRADED'?'risk':x.status==='REPORTED_IMPROVEMENT'?'better':'')+'">'+
   esc(riskText[x.status])+'</span><strong>'+esc(R193_POLICY[i].title)+'</strong>'+
   '<small>'+esc(x.previousStatus)+' → '+esc(x.currentStatus)+
   ' · Независимая проверка обязательна</small></div>';
 }).join('');
 const evidenceCards=d.changes.map(x=>{
  requireTrue(Object.hasOwn(evidenceText,x.state)&&x.stillUnverified===true&&
   x.releaseClearance===false,
   'untrusted evidence delta may not claim GO');
  return '<div class="r195-row"><span class="r195-flag">'+
   esc(evidenceText[x.state])+'</span><strong>'+esc(x.control)+'</strong>'+
   '<small>'+esc(x.previousClaim||'Нет записи')+' → '+
   esc(x.currentClaim||'Нет записи')+
   ' · Источники без независимой аттестации</small></div>';
 }).join('');
 const insight='<section id="r195-comparison" class="sec r195-section">'+
  '<p class="eyebrow">EVIDENCE / RISK COMPARISON</p>'+
  '<h2>Что действительно изменилось</h2>'+
  '<p class="r195-summary">Изменений свидетельств: <b>'+d.changedCount+
  '</b> · Ухудшений: <b>'+t.regressions.length+
  '</b> · Заявленных улучшений: <b>'+t.reportedImprovements.length+
  '</b>. Ни один показатель не является допуском к запуску.</p>'+
  '<h3>Динамика восьми контрольных направлений</h3>'+
  '<div class="r195-matrix">'+riskCards+'</div>'+
  '<h3 style="margin-top:28px">История шести типов свидетельств</h3>'+
  '<div class="r195-matrix">'+evidenceCards+'</div></section>';
 const owners='<section class="sec r195-section" id="r195-handoffs">'+
  '<p class="eyebrow">TEAM HANDOFF</p><h2>Пакеты для ответственных</h2>'+
  '<p class="intro">Фиксированные задачи по ролям. Экспорт CSV не назначает ответственного автоматически и не подтверждает одобрение.</p>'+
  '<div class="r195-handoff">'+h.byOwner.map(x=>
   '<div class="r195-owner"><strong>'+esc(x.owner)+'</strong>'+
   '<small>Контрольных направлений: '+x.count+'</small>'+
   '<button type="button" class="r195-button" data-r195-owner="'+esc(x.owner)+'">'+
   'Скачать CSV</button></div>').join('')+'</div></section>';
 const workspace='<section class="sec r195-section" id="r195-workspace">'+
  '<p class="eyebrow">PRIVATE LOCAL DRAFT / V2</p>'+
  '<h2>Черновик оператора</h2>'+
  '<p class="intro">История всех новых действий проверяется по SHA-256. Цепочка защищает от случайной порчи, но не удостоверяет личность.</p>'+
  '<div class="r195-filezone"><div>'+
  '<label class="r195-label" for="r195-file">Импортировать сохранённый файл JSON</label>'+
  '<input class="r195-file" id="r195-file" type="file" accept=".json,application/json">'+
  '<label class="r195-label" for="r195-paste" style="margin-top:16px">Или вставить текст JSON</label>'+
  '<textarea id="r195-paste" class="r195-textarea" maxlength="70000" placeholder="Черновик MARCOSA R195 v2"></textarea>'+
  '<div class="r195-buttons-row"><button type="button" class="r195-button" id="r195-import">Проверить и импортировать</button>'+
  '<button type="button" class="r195-button" id="r195-reset">Новый черновик</button></div>'+
  '</div><div>'+
  '<label class="r195-label" for="r195-export-text">Подготовленный JSON для копирования</label>'+
  '<textarea id="r195-export-text" class="r195-textarea" readonly></textarea>'+
  '<div class="r195-buttons-row"><button type="button" class="r195-button" id="r195-export">Скачать проверенный JSON</button></div>'+
  '<p class="r195-helper">Сохранение только вручную. Ни токены, ни пароли, ни персональные данные вводить не нужно. JSON — локальная запись, не внешний акт согласования.</p>'+
  '</div></div>'+
  '<div><h3>Последние локальные события <span class="r195-tag" id="r195-count">0</span></h3>'+
  '<ol id="r195-history" class="r195-history"></ol></div>'+
  '<p id="r195-message" role="status" aria-live="polite" class="r195-status"></p></section>';
 const selection='<div class="r195-owner-select"><label class="r195-label" for="r195-owner">Ответственный</label>'+
  '<select id="r195-owner" class="r195-select"><option value="ALL">Все роли</option>'+
  h.byOwner.map(x=>'<option value="'+esc(x.owner)+'">'+esc(x.owner)+'</option>').join('')+
  '</select></div>';
 const source={
  schemaVersion:2,sourceCommit:commit,assessmentSha256:a.evidenceSha256,
  initialProgress:l.progress,
  handoffs:h.byOwner.map(x=>({owner:x.owner,csv:x.csv})),
  decision:'NO_GO',productionAuthorized:false
 };
 const sourceJson=JSON.stringify(source).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
 const oldScript=base.html.match(/<script>[\s\S]*?<\/script>/g)||[];
 requireTrue(oldScript.length===1&&base.html.includes('<div class="r194-exchange">')&&
  base.html.includes('<p id="r194-status" class="r194-status" aria-live="polite"></p></section>'),
  'R194 base template changed unexpectedly');
 const baseHash=base.html.match(/script-src &#39;sha256-([A-Za-z0-9+/=]+)&#39;/);
 requireTrue(baseHash&&baseHash.length===2,'R194 inline script CSP missing');
 const newHash=createHash('sha256').update(script,'utf8').digest('base64');
 const markup=base.html.replace(oldScript[0],'')
  .replace(baseHash[0],"script-src &#39;sha256-"+newHash+"&#39;")
  .replace('</style>',css+'</style>')
  .replace('<div class="r194-exchange">','<div class="r194-exchange" hidden>')
  .replace('<div class="r194-toolgrid">','<div class="r194-toolgrid">'+selection)
  .replace('<p id="r194-status" class="r194-status" aria-live="polite"></p></section>',
   '<p id="r194-status" class="r194-status" hidden aria-live="polite"></p></section>'+
   workspace)
  .replace('<section id="checks" class="sec">',insight+owners+'<section id="checks" class="sec">')
  .replace('AUDIT DESK R194','AUDIT DESK R195')
  .replace('R194 · 20 NOV 2026','R195 · 20 NOV 2026')
  .replace('</body>','<div id="r195-source" hidden aria-hidden="true">'+
   sourceJson+'</div><script>'+script+'</script></body>');
 requireTrue(markup.includes('id="r195-source" hidden')&&
  markup.includes('connect-src &#39;none&#39;')&&
  markup.includes('script-src &#39;sha256-')&&
  !markup.includes('src="https:')&&!markup.includes('onerror=')&&
  !markup.includes('onclick='),'R195 generated page must be self-contained and CSP-bound');
 const markdown=['# MARCOSA R195 / Аудит и передача ответственности','',
  'Исходный коммит: '+commit,'Пакет SHA-256: '+bundleSha256,
  'Данные R194: '+t.evidenceSha256,
  'Манифест передачи: '+h.manifestSha256,
  'Изменённых свидетельств: '+d.changedCount,
  'Ухудшений: '+t.regressions.length,
  'Заявленных улучшений: '+t.reportedImprovements.length,
  'Независимое согласование: отсутствует',
  'Решение: NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED','','## Передача по ролям',
  ...h.byOwner.map(x=>'- '+x.owner+': '+x.count+' направление(я) · CSV SHA-256 '+x.csvSha256),
  '','## Источники',
  ...R193_POLICY.map((x,i)=>'- '+x.id+': '+a.controls[i].status+
   ' · локальная задача '+l.progress[x.id]+' · '+t.changes[i].status),
  '','Никакая локальная отметка, PASS_CLAIM или регрессия не разрешают реальный пилот.',''].join('\n');
 return Object.freeze({
  html:markup,markdown,handoffs:h,sourceCommit:commit,
  htmlSha256:sha(Buffer.from(markup,'utf8')),
  markdownSha256:sha(Buffer.from(markdown,'utf8')),
  scriptSha256:sha(Buffer.from(script,'utf8')),
  handoffManifestSha256:h.manifestSha256,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false
 });
}
