/**
 * Upgrade the verified R193 offline report to a fully interactive mobile
 * execution scratchpad with a hash-authorized inline script. No network,
 * storage, upload, production permissions or executable user-supplied text.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyReceipt,H40,H64,requireTrue} from '../r190/common.mjs';
import {renderR193Dashboard} from '../r193/dashboard.mjs';
import {verifyR194TaskLedger} from './task-ledger.mjs';
import {R193_POLICY} from '../r193/assessment.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const css=[
 '.r194-workbench{border:1px solid #314265;background:#0d1b33;border-radius:22px;padding:clamp(16px,3vw,32px)}',
 '.r194-controls{margin-top:18px;border-top:1px solid #32425e;padding-top:14px}',
 '.r194-progress{font-size:12px;color:#d1bc98;display:block;margin-bottom:10px}',
 '.r194-buttons{display:flex;flex-wrap:wrap;gap:7px}',
 '.r194-smallbtn,.r194-button{font:inherit;border:1px solid #536483;border-radius:10px;background:#172944;color:#e8edf8;padding:9px 12px;cursor:pointer;font-size:12px;min-height:40px}',
 '.r194-smallbtn:hover,.r194-button:hover{border-color:#d5b47d}',
 '.r194-smallbtn:disabled{opacity:.38;cursor:not-allowed}',
 '.r194-input,.r194-select,.r194-textarea{font:inherit;background:#111d33;border:1px solid #506080;border-radius:10px;color:#f0f4fc;padding:11px 13px;min-height:45px;width:100%;max-width:100%}',
 '.r194-input:focus,.r194-select:focus,.r194-textarea:focus{outline:2px solid #d6b98d;outline-offset:2px}',
 '.r194-textarea{font-family:ui-monospace,monospace;min-height:120px;resize:vertical;font-size:12px}',
 '.r194-toolgrid{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin:20px 0 12px}',
 '.r194-label{display:block;font-size:12px;color:#b9c8e0;margin-bottom:8px}',
 '.r194-note{color:#9eb5d5;font-size:12px;line-height:1.6;margin:12px 0}',
 '.r194-exchange{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px}',
 '.r194-results{font-size:13px;color:#dfcfb1;margin-top:11px}',
 '.r194-status{min-height:1.7em;font-size:12px;color:#b9cbe3;margin-top:13px}',
 'article.control[hidden]{display:none!important}',
 '@media(max-width:780px){.r194-toolgrid,.r194-exchange{grid-template-columns:1fr}}',
 '@media print{.r194-workbench,.r194-controls{display:none!important}}'
].join('\n');
const escape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function renderR194Interactive({
 commit,bundleSha256,assessment,ledger,evidenceDelta,riskTrend
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||''),
  'exact source required for interactive desk');
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 const l=verifyR194TaskLedger({ledger,assessment:a,commit,bundleSha256});
 const d=verifyReceipt(evidenceDelta,'R194_EVIDENCE_DELTA',commit,bundleSha256);
 const t=verifyReceipt(riskTrend,'R194_RISK_TREND',commit,bundleSha256);
 requireTrue(d.afterSha256===a.intakeEvidenceSha256&&
  t.afterSha256===a.evidenceSha256&&
  d.decision==='NO_GO_OPERATOR_CLAIMS_NOT_EXTERNALLY_VERIFIED'&&
  t.decision==='NO_GO_TREND_IS_NOT_INDEPENDENT_APPROVAL'&&
  Array.isArray(d.changes)&&d.changes.length===6&&
  Array.isArray(t.changes)&&t.changes.length===8,
  'R194 dashboard data cannot refer to foreign proof or grant approval');
 const base=renderR193Dashboard({assessment:a,commit,bundleSha256});
 const app=readFileSync(new URL('./client.js',import.meta.url),'utf8');
 requireTrue(app.length>3000&&app.length<30000&&!app.includes('fetch(')&&
  !app.includes('XMLHttpRequest')&&!app.includes('localStorage')&&
  !app.includes('navigator.sendBeacon'),
  'offline-only client cannot access network or persistent storage');
 const policy=R193_POLICY.map(x=>x.id);
 const data={schemaVersion:1,commit,assessmentSha256:a.evidenceSha256,
  controls:policy,progress:l.progress,
  sourceMode:'OFFLINE_UNTRUSTED_SCRATCHPAD',
  productionAuthorized:false};
 const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
 const workspace='<section class="sec r194-workbench" id="workbench">'+
  '<p class="eyebrow">LOCAL OPERATOR WORKSPACE</p>'+
  '<h2>Рабочий кабинет</h2>'+
  '<p class="intro">Поиск, фильтры и локальные отметки. Выполнение задачи не означает разрешения на пилот или production.</p>'+
  '<div class="r194-toolgrid"><div><label class="r194-label" for="r194-search">Поиск направления</label>'+
  '<input id="r194-search" class="r194-input" type="search" maxlength="80" placeholder="Например, TLS или AWS"></div>'+
  '<div><label class="r194-label" for="r194-filter">Статус</label>'+
  '<select class="r194-select" id="r194-filter">'+
  [['ALL','Все'],['BLOCKED','Заблокировано'],['MISSING','Нет свидетельств'],
   ['CLAIM_UNVERIFIED','Заявлено'],['OBSERVED_UNATTESTED','Наблюдено'],
   ['LOCAL_DONE','Локально выполнено']].map(x=>
   '<option value="'+escape(x[0])+'">'+escape(x[1])+'</option>').join('')+
  '</select></div></div>'+
  '<p id="r194-results" class="r194-results" aria-live="polite"></p>'+
  '<div class="r194-exchange"><div><label class="r194-label" for="r194-export-json">Экспорт локального черновика JSON</label>'+
  '<textarea id="r194-export-json" class="r194-textarea" readonly></textarea>'+
  '<button type="button" id="r194-export" class="r194-button">Подготовить экспорт</button></div>'+
  '<div><label class="r194-label" for="r194-import-json">Вставьте ранее экспортированный черновик</label>'+
  '<textarea id="r194-import-json" class="r194-textarea" maxlength="30000"></textarea>'+
  '<button type="button" id="r194-import" class="r194-button">Импортировать</button>'+
  '<button type="button" id="r194-reset" class="r194-button">Сбросить</button></div></div>'+
  '<p class="r194-note">Данные существуют только в памяти открытой вкладки. Сохраните JSON вручную: закрытие страницы сбрасывает изменения. Не вводите персональные данные, токены или пароли.</p>'+
  '<p id="r194-status" class="r194-status" aria-live="polite"></p></section>';
 const scriptHash=createHash('sha256').update(app,'utf8').digest('base64');
 const oldCsp='base-uri &#39;none&#39;; form-action &#39;none&#39;';
 const newCsp='script-src &#39;sha256-'+scriptHash+'&#39;; connect-src &#39;none&#39;; '+
  'base-uri &#39;none&#39;; form-action &#39;none&#39;';
 requireTrue(base.html.includes(oldCsp)&&
  base.html.includes('</nav></header>')&&base.html.includes('</body>')&&
  base.html.includes('</style>'),'base report structure not available');
 const html=base.html
  .replace(oldCsp,newCsp)
  .replace('</style>',css+'</style>')
  .replace('</nav></header>','</nav></header>'+workspace)
  .replace('</body>','<template id="r194-source">'+json+'</template>'+
   '<script>'+app+'</script></body>')
  .replace('AUDIT DESK R193','AUDIT DESK R194')
  .replace('R193 · 20 NOV 2026','R194 · 20 NOV 2026');
 requireTrue(html.includes("script-src &#39;sha256-")&&
  !html.includes('src="https:')&&
  !html.includes('onerror=')&&!html.includes('onclick='),
  'offline mobile CSP/safe DOM contract violated');
 const markdown=[
  '# MARCOSA R194 — интерактивный автономный Audit Desk',
  '',
  'Исходный коммит: '+commit,
  'Источник SHA-256: '+bundleSha256,
  'Предыдущая оценка: '+t.beforeSha256,
  'Текущая оценка: '+a.evidenceSha256,
  'Изменённых свидетельств: '+d.changedCount,
  'Ухудшений: '+t.regressions.length,
  'Заявленных улучшений: '+t.reportedImprovements.length,
  'Локальных отметок в проверяемом журнале: '+l.events.length,
  'Решение: NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  '',
  ...base.markdown.split('\n').slice(5),
  '',
  'Локальные действия в браузере не изменяют исходный подписанный отчёт.',
  ''
 ].join('\n');
 return Object.freeze({
  html,markdown,
  htmlSha256:hash(Buffer.from(html,'utf8')),
  markdownSha256:hash(Buffer.from(markdown,'utf8')),
  clientScriptSha256:hash(Buffer.from(app,'utf8')),
  assessmentSha256:a.evidenceSha256,
  taskLedgerSha256:l.evidenceSha256,
  evidenceDeltaSha256:d.evidenceSha256,
  riskTrendSha256:t.evidenceSha256,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false
 });
}
