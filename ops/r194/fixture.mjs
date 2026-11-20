/** Disposable, source-pinned historical R193 snapshots for R194 integration. */
import {createHash,generateKeyPairSync} from 'node:crypto';
import {buildR193Fixture} from '../r193/fixture.mjs';
import {createR194TaskLedger,appendR194TaskEvent} from './task-ledger.mjs';
import {compareR194Evidence} from './evidence-delta.mjs';
import {compareR194Readiness} from './risk-trend.mjs';
import {renderR194Interactive} from './interactive-dashboard.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function buildR194Fixture({
 commit='a'.repeat(40),bundleSha256='b'.repeat(64),now=Date.now()
}={}){
 const before=await buildR193Fixture({commit,bundleSha256,
  now:now-10000,runId:944044});
 const currentRecords=[
  {control:'TLS_ORIGIN',sourceCommit:commit,
   artifactSha256:sha('R194:tls:negative'),
   authority:'CI_FIXTURE',claim:'FAIL_CLAIM',
   observedAtMs:now-1000,expiresAtMs:now+30000},
  {control:'AWS_EFFECTIVE_RIGHTS',sourceCommit:commit,
   artifactSha256:sha('fixture:aws'),
   authority:'CI_FIXTURE',claim:'FAIL_CLAIM',
   observedAtMs:now-1000,expiresAtMs:now+30000},
  {control:'STAGING_RESTORE',sourceCommit:commit,
   artifactSha256:sha('R194:restore:claim'),
   authority:'CI_FIXTURE',claim:'PASS_CLAIM',
   observedAtMs:now-1000,expiresAtMs:now+30000}
 ];
 const after=await buildR193Fixture({commit,bundleSha256,
  now,runId:944044,evidenceRecords:currentRecords});
 const clock=()=>now;
 const evidenceDelta=compareR194Evidence({commit,bundleSha256,
  before:before.intake,after:after.intake,clock});
 const riskTrend=compareR194Readiness({commit,bundleSha256,
  before:before.assessment,after:after.assessment,clock});
 const initial=createR194TaskLedger({commit,bundleSha256,
  assessment:after.assessment,clock});
 const started=appendR194TaskEvent({ledger:initial,assessment:after.assessment,
  commit,bundleSha256,control:'TLS_ORIGIN',action:'START',clock});
 const board=appendR194TaskEvent({ledger:started,assessment:after.assessment,
  commit,bundleSha256,control:'TLS_ORIGIN',action:'BLOCK',clock});
 const rendered=renderR194Interactive({commit,bundleSha256,
  assessment:after.assessment,ledger:board,evidenceDelta,riskTrend});
 const pair=generateKeyPairSync('ed25519');
 return Object.freeze({commit,bundleSha256,now,before,after,
  board,evidenceDelta,riskTrend,rendered,
  keyPair:pair,publicKeyDer:pair.publicKey.export({type:'spki',format:'der'})});
}
