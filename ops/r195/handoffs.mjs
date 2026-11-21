/** Offline auditable per-role handoff packets: source SHA and NO-GO on every
 * document. Actions are fixed by R193 policy, never arbitrary input strings. */
import {createHash} from 'node:crypto';
import {H40,H64,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {R193_POLICY} from '../r193/assessment.mjs';
import {verifyR194TaskLedger} from '../r194/task-ledger.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const owners=['ENGINEERING','GOVERNANCE','DEVOPS','SECURITY','OPERATIONS','PRIVACY'];
const riskStates=['BLOCKED','MISSING','CLAIM_UNVERIFIED','OBSERVED_UNATTESTED'];
function csvField(x) {return '"'+String(x).replaceAll('"','""')+'"';}
export function buildR195Handoffs({
 commit,bundleSha256,assessment,ledger,riskTrend,evidenceDelta
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||''),
  'source commit and bundle SHA required');
 const a=verifyReceipt(assessment,'R193_ASSESSMENT',commit,bundleSha256);
 const l=verifyR194TaskLedger({ledger,assessment:a,commit,bundleSha256});
 const t=verifyReceipt(riskTrend,'R194_RISK_TREND',commit,bundleSha256);
 const d=verifyReceipt(evidenceDelta,'R194_EVIDENCE_DELTA',commit,bundleSha256);
 requireTrue(t.afterSha256===a.evidenceSha256&&
  d.afterSha256===a.intakeEvidenceSha256&&
  a.controls.length===8&&t.changes.length===8&&d.changes.length===6,
  'complete source-pinned risk and intake evidence required');
 const items=R193_POLICY.map((x,i)=>{
  const status=a.controls[i],risk=t.changes[i];
  const claim=d.changes.find(c=>c.control===x.id);
  requireTrue(x.id===status.id&&risk.id===x.id&&
   riskStates.includes(status.status)&&
   status.allowedForRelease===false&&
   Object.hasOwn(l.progress,x.id)&&
   risk.productionAuthorized===false,
   'unsafe or foreign action control');
  return {control:x.id,owner:x.owner,priority:x.priority,
   currentStatus:status.status,localTask:l.progress[x.id],
   riskTrend:risk.status,evidenceRevision:claim?.state||'NOT_APPLICABLE',
   action:x.action,independentApproval:'REQUIRED',release:'NO_GO'};
 });
 const byOwner=owners.map(owner=>{
  const list=items.filter(x=>x.owner===owner);
  requireTrue(list.length>=1,'owner without assigned control');
  const md=[
   '# MARCOSA R195 / '+owner,
   '', 'Режим: независимое согласование. Статус: NO-GO.',
   'Source SHA: '+commit,
   'Source bundle: '+bundleSha256,
   'Assessment SHA-256: '+a.evidenceSha256,
   'Local task ledger SHA-256: '+l.evidenceSha256,
   '', '## Обязательные действия',
   ...list.map(x=>'- **'+x.control+'** (P'+x.priority+
    ', '+x.currentStatus+', локально '+x.localTask+
    ', динамика '+x.riskTrend+'): '+x.action+
    '. Нужна независимая приёмка.'),
   '', '## Ограничение',
   'Локальные отметки, GitHub fixtures и PASS_CLAIM не удостоверяют личность, IAM, TLS, DR или privacy.',
   'Никакого production GO или автоматического одобрения.',
   ''
  ].join('\n');
  const columns=['control','owner','priority','currentStatus','localTask',
   'riskTrend','evidenceRevision','action','independentApproval','release'];
  const csv=[columns.map(csvField).join(','),...list.map(x=>
   columns.map(c=>csvField(x[c])).join(','))].join('\r\n')+'\r\n';
  return {owner,count:list.length,markdown:md,csv,
   markdownSha256:sha(Buffer.from(md)),csvSha256:sha(Buffer.from(csv))};
 });
 const manifest={
  schemaVersion:1,kind:'R195_OWNER_HANDOFF_MANIFEST',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  assessmentSha256:a.evidenceSha256,
  ledgerSha256:l.evidenceSha256,
  riskTrendSha256:t.evidenceSha256,
  evidenceDeltaSha256:d.evidenceSha256,
  ownerHashes:byOwner.map(x=>({owner:x.owner,count:x.count,
   markdownSha256:x.markdownSha256,csvSha256:x.csvSha256})),
  decision:'NO_GO',realPilotAuthorized:false,productionAuthorized:false
 };
 return Object.freeze({byOwner,manifest,
  manifestSha256:sha(JSON.stringify(manifest)),
  totalControls:items.length,productionAuthorized:false});
}
