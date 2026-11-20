/**
 * MARCOSA R193 offline/mobile readiness dashboard. No CDN, cookies, network,
 * tracking or third-party code; all source values escaped as plain HTML.
 */
import {createHash} from 'node:crypto';
import {verifyReceipt,H40,H64,requireTrue} from '../r190/common.mjs';
import {R193_POLICY} from './assessment.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const escape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const statusText={
 BLOCKED:'Заблокировано',MISSING:'Нет свидетельства',
 CLAIM_UNVERIFIED:'Заявлено, не проверено',
 OBSERVED_UNATTESTED:'Наблюдение без аттестации'
};
const statusClass={
 BLOCKED:'blocked',MISSING:'missing',
 CLAIM_UNVERIFIED:'claimed',OBSERVED_UNATTESTED:'observed'
};
const styles=[
 "html{background:#080f20;color:#edf2ff;scroll-behavior:smooth}",
 "*{box-sizing:border-box}",
 "body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;line-height:1.52}",
 "a{color:inherit;text-decoration:none} a:hover{text-decoration:underline}",
 ".shell{max-width:1200px;margin:auto;padding:clamp(16px,4vw,48px)}",
 "header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #243251;padding-bottom:20px}",
 ".logo{font-weight:800;letter-spacing:.22em;font-size:13px}.version{font-size:12px;color:#a8b7d0}",
 "nav{display:flex;gap:20px;flex-wrap:wrap;color:#b6c8ea;font-size:13px}",
 ".hero{padding:clamp(36px,7vw,86px) 0 34px;display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,360px);gap:28px;align-items:end}",
 ".eyebrow{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#c5a87b}",
 "h1{font-size:clamp(38px,6vw,76px);letter-spacing:-.045em;line-height:1.04;margin:14px 0 18px;font-weight:650}",
 "p{margin:0 0 12px}.sub{color:#b7c3d8;max-width:65ch;font-size:clamp(15px,2vw,18px)}",
 ".stamp{border:1px solid #42516b;background:#0b172c;border-radius:18px;padding:24px}",
 ".stamp .label{font-size:12px;color:#aab9d2;text-transform:uppercase;letter-spacing:.14em}",
 ".stamp strong{display:block;font-size:30px;letter-spacing:.13em;margin:10px 0;color:#e8d6c4}",
 ".stamp small{color:#adbed8;line-height:1.6;display:block}",
 ".metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0 44px}",
 ".metric{border:1px solid #263655;background:#0c1830;border-radius:16px;padding:21px}",
 ".metric .num{font-variant-numeric:tabular-nums;font-size:32px;display:block;font-weight:600}",
 ".metric .meta{color:#abbad3;font-size:12px}",
 "h2{font-size:clamp(23px,2.8vw,35px);margin:0 0 16px;letter-spacing:-.02em;font-weight:600}",
 ".sec{margin:44px 0}.intro{color:#aebdd3;margin:0 0 19px}",
 ".cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}",
 ".control{background:#111e36;border:1px solid #293855;border-radius:18px;padding:23px;min-width:0}",
 ".control-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
 ".control h3{font-size:18px;margin:8px 0 10px;font-weight:600}",
 ".control .id{letter-spacing:.13em;font-size:11px;color:#98adc9}",
 ".pill{display:inline-block;white-space:normal;text-align:right;font-size:11px;padding:6px 10px;border-radius:30px;background:#25344f;color:#dce6f4}",
 ".pill.blocked{color:#f4b6a9;background:#3b2733}",
 ".pill.missing{color:#becce1;background:#263249}",
 ".pill.claimed{color:#efdaae;background:#3d372a}",
 ".pill.observed{color:#aedacb;background:#1e3936}",
 ".detail{color:#bfd0e7;font-size:14px;margin:12px 0 16px}",
 ".owner{color:#9eb1c7;font-size:12px;text-transform:uppercase;letter-spacing:.1em}",
 ".card-footer{margin-top:18px;border-top:1px solid #2a3753;padding-top:15px;display:flex;align-items:center;justify-content:space-between;gap:10px}",
 "code{font-size:12px;color:#d2ddf2;word-break:break-all;overflow-wrap:anywhere}",
 ".tasks{counter-reset:tasks;display:grid;gap:9px}",
 ".task{border-bottom:1px solid #263454;display:grid;grid-template-columns:44px 1fr auto;gap:13px;align-items:center;padding:13px 0}",
 ".task:before{counter-increment:tasks;content:counter(tasks,decimal-leading-zero);color:#c5a87b;font-size:14px}",
 ".task strong{display:block;font-weight:600}.task small{color:#bdcbe0}.task .owner{white-space:nowrap}",
 ".fine{font-size:12px;color:#9cadc9;line-height:1.65}",
 ".meta-table{width:100%;border-collapse:collapse;max-width:100%;table-layout:fixed}",
 ".meta-table th,.meta-table td{text-align:left;border-bottom:1px solid #263454;padding:11px 0;vertical-align:top;word-wrap:break-word}",
 ".meta-table th{color:#a7b7d0;font-size:13px;font-weight:450;width:160px}",
 "footer{border-top:1px solid #263454;margin-top:55px;padding-top:22px;display:flex;justify-content:space-between;gap:15px;color:#a6b7cf;font-size:12px}",
 ":focus-visible{outline:2px solid #e0bf82;outline-offset:4px}",
 "@media(max-width:780px){.hero{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.cards{grid-template-columns:1fr}.task{grid-template-columns:35px 1fr}.task .owner{grid-column:2}.stamp{max-width:400px}header{align-items:flex-start;flex-direction:column}footer{flex-direction:column}}",
 "@media(max-width:380px){.shell{padding:15px}.metrics{gap:8px}.metric{padding:15px}.control{padding:17px}.pill{font-size:10px}.meta-table th{width:110px}}",
 "@media print{html{background:#fff;color:#152031}body{background:#fff}.stamp,.control,.metric{background:#fff;border-color:#aeb7c5;color:#152031}.pill,.detail,.fine,.intro,.meta-table th,.owner,.meta,.sub,.version,nav,.eyebrow,.stamp small,.stamp .label,.task small{color:#34445a!important}a{text-decoration:underline}.sec{break-inside:avoid}}"
].join('\n');
function policyCheck(assessment){
 requireTrue(Array.isArray(assessment.controls)&&assessment.controls.length===8&&
  assessment.controls.every((c,i)=>c.id===R193_POLICY[i].id&&
   c.title===R193_POLICY[i].title&&c.owner===R193_POLICY[i].owner&&
   c.action===R193_POLICY[i].action&&
   Object.hasOwn(statusText,c.status)&&
   (c.artifactSha256===null||H64.test(c.artifactSha256||''))),
  'refuse unexpected data or changed operator decision structure');
 requireTrue(Array.isArray(assessment.actionQueue)&&
  assessment.actionQueue.length<=8&&
  assessment.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
  assessment.productionAuthorized===false,
  'no production GO or unverified extra control permitted');
}
export function renderR193Dashboard({assessment,commit,bundleSha256}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||''),
  'exact source for dashboard required');
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 policyCheck(a);
 const cards=a.controls.map(x=>
  '<article class="control" id="control-'+escape(x.id)+'">'+
  '<div class="control-head"><div><span class="id">'+escape(x.id)+'</span>'+
  '<h3>'+escape(x.title)+'</h3></div>'+
  '<span class="pill '+statusClass[x.status]+'">'+
  escape(statusText[x.status])+'</span></div>'+
  '<p class="detail">'+escape(x.action)+'</p>'+
  '<div class="card-footer"><span class="owner">'+escape(x.owner)+'</span>'+
  '<span class="fine">Приёмка: не подтверждена</span></div></article>'
 ).join('');
 const actions=a.actionQueue.map(x=>
  '<div class="task"><div><strong>'+escape(x.action)+'</strong>'+
  '<small>'+escape(x.id)+'</small></div>'+
  '<span class="owner">'+escape(x.owner)+'</span></div>'
 ).join('');
 const table=[
  ['Коммит',commit],
  ['SHA-256 дерева/пакета',bundleSha256],
  ['Свидетельство GitHub',a.githubEvidenceSha256],
  ['Свидетельство оператора',a.intakeEvidenceSha256],
  ['SHA-256 отчёта',a.evidenceSha256],
  ['Режим','Офлайн-отчёт. Нет доступа к production'],
  ['Приёмка','Независимое подтверждение отсутствует']
 ].map(row=>'<tr><th scope="row">'+escape(row[0])+'</th><td><code>'+
  escape(row[1])+'</code></td></tr>').join('');
 const html='<!doctype html>\n<html lang="ru"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta name="color-scheme" content="dark light">'+
  '<meta name="referrer" content="no-referrer">'+
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+
  '<title>MARCOSA | Staging Audit R193</title><style>'+styles+'</style></head><body>'+
  '<div class="shell"><header><div class="logo">MARCOSA <span class="version">/ AUDIT DESK R193</span></div>'+
  '<nav aria-label="Разделы"><a href="#overview">Обзор</a><a href="#checks">Проверки</a>'+
  '<a href="#actions">План действий</a><a href="#source">Источники</a></nav></header>'+
  '<main><section class="hero" id="overview"><div><p class="eyebrow">Independent staging readiness</p>'+
  '<h1>Проверка<br>готовности.</h1>'+
  '<p class="sub">Свидетельства GitHub и операторов разделены. Синтетические тесты и заявления не дают права на запуск.</p></div>'+
  '<aside class="stamp" aria-label="Решение"><span class="label">Release decision</span>'+
  '<strong>NO-GO</strong><small>Реальный пилот и production заблокированы до независимой приёмки.</small></aside></section>'+
  '<section class="metrics" aria-label="Сводка">'+
  [['Заблокировано',a.tally.blocked],['Не предоставлено',a.tally.missing],
   ['Заявлено',a.tally.claims],['Наблюдено',a.tally.observed]].map(row=>
   '<div class="metric"><span class="num">'+escape(row[1])+'</span><span class="meta">'+
   escape(row[0])+'</span></div>').join('')+'</section>'+
  '<section id="checks" class="sec"><h2>Контрольные направления</h2>'+
  '<p class="intro">Все восемь направлений требуют независимого допуска, даже если автоматическая проверка успешна.</p>'+
  '<div class="cards">'+cards+'</div></section>'+
  '<section id="actions" class="sec"><h2>Следующие действия</h2>'+
  '<p class="intro">Приоритеты определяются риском, а не количеством пройденных синтетических тестов.</p>'+
  '<div class="tasks">'+actions+'</div></section>'+
  '<section id="source" class="sec"><h2>Источники и целостность</h2>'+
  '<table class="meta-table"><tbody>'+table+'</tbody></table>'+
  '<p class="fine" style="margin-top:20px">Этот автономный отчёт не обращается в сеть, не собирает персональные данные и не выдаёт разрешений на развёртывание.</p></section>'+
  '</main><footer><span>MARCOSA / INDEPENDENT READINESS</span>'+
  '<span>R193 · 20 NOV 2026 · NO-GO</span></footer></div></body></html>\n';
 const markdown=[
  '# MARCOSA R193 — проверка staging (NO-GO)',
  '', 'Исходный коммит: '+commit,
  'Источник: '+bundleSha256,
  'Решение: '+a.decision,
  '',
  '## Контрольные направления',
  ...a.controls.map(x=>'- '+x.id+' — '+statusText[x.status]+
   '. Ответственный: '+x.owner+'. Действие: '+x.action+'.'),
  '','## Приоритетная очередь',
  ...a.actionQueue.map((x,i)=>String(i+1)+'. '+x.owner+
   ' / '+x.id+' — '+x.action),
  '','## Ограничения','Ни один сигнал не означает разрешения на production.',
  'Подлинность реальных личностей, инфраструктуры и юридические согласования проверяются отдельно.',
  '','SHA-256 оценки: '+a.evidenceSha256,''
 ].join('\n');
 return Object.freeze({html,markdown,
  htmlSha256:hash(Buffer.from(html,'utf8')),
  markdownSha256:hash(Buffer.from(markdown,'utf8')),
  sourceCommit:commit,
  productionAuthorized:false});
}
