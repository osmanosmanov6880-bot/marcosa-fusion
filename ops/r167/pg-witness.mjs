/**
 * R167 read-only, synthetic PG17 independent inventory.
 * Accepts an injected privileged read-only SQL executor; outputs only hashes
 * and fixed security counts, never raw names/user identifiers.
 */
import {createHash} from 'node:crypto';
import {verifyR167RestoredInventory} from './transfer-manifest.mjs';

const err=m=>{throw Error('R167 PG witness: '+m);};
const ok=(v,m)=>{if(!v)err(m);};
const hex=/^[a-f0-9]{64}$/;
export const R167_INVENTORY_SQL=[
 "SELECT json_build_object(",
 "'pgVersion',(SELECT current_setting('server_version_num')::integer),",
 "'publicRows',(SELECT count(*)::integer FROM public.r167_episodes),",
 "'privateRows',(SELECT count(*)::integer FROM r167_ci.r167_sessions),",
 "'auditRows',(SELECT count(*)::integer FROM r167_ci.r167_audit),",
 "'activeSessions',(SELECT count(*)::integer FROM r167_ci.r167_sessions WHERE active),",
 "'revokedSessions',(SELECT count(*)::integer FROM r167_ci.r167_sessions WHERE NOT active),",
 "'quarantineClosed',(SELECT closed FROM r167_ci.r167_quarantine WHERE id=1),",
 "'quarantineGeneration',(SELECT generation FROM r167_ci.r167_quarantine WHERE id=1),",
 "'auditHead',(SELECT event_hash FROM r167_ci.r167_audit ORDER BY seq DESC LIMIT 1),",
 "'publicRls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.r167_episodes'::regclass),",
 "'privateRls',(SELECT relrowsecurity FROM pg_class WHERE oid='r167_ci.r167_sessions'::regclass),",
 "'browserCanReadPrivate',has_table_privilege('authenticated','r167_ci.r167_sessions','SELECT'),",
 "'readerCanReadPrivate',has_table_privilege('marcosa_r167_reader','r167_ci.r167_sessions','SELECT'),",
 "'writerCanDeleteAudit',has_table_privilege('marcosa_r167_reader','r167_ci.r167_audit','DELETE'),",
 "'rows',json_build_object(",
 " 'episodes',coalesce((SELECT json_agg(json_build_object('id',id::text,'title',title,'revision',revision) ORDER BY id) FROM public.r167_episodes),'[]'::json),",
 " 'sessions',coalesce((SELECT json_agg(json_build_object('id',id::text,'active',active) ORDER BY id) FROM r167_ci.r167_sessions),'[]'::json),",
 " 'audit',coalesce((SELECT json_agg(json_build_object('seq',seq,'category',category,'hash',event_hash) ORDER BY seq) FROM r167_ci.r167_audit),'[]'::json),",
 " 'quarantine',(SELECT json_build_object('closed',closed,'generation',generation) FROM r167_ci.r167_quarantine WHERE id=1)",
 "))::text;"
].join(' ');
const keys=['pgVersion','publicRows','privateRows','auditRows','activeSessions',
 'revokedSessions','quarantineClosed','quarantineGeneration','auditHead',
 'publicRls','privateRls','browserCanReadPrivate','readerCanReadPrivate',
 'writerCanDeleteAudit','rows'].sort().join(',');
export async function readR167FixtureInventory({sqlRead}={}){
 ok(typeof sqlRead==='function','trusted read-only SQL transport required');
 let value;
 try{value=JSON.parse(await sqlRead(R167_INVENTORY_SQL));}
 catch{err('PostgreSQL readback unavailable');}
 ok(value&&Object.getPrototypeOf(value)===Object.prototype&&
  Object.keys(value).sort().join(',')===keys&&
  Number.isInteger(value.pgVersion)&&value.pgVersion>=170000&&
  value.pgVersion<180000,'only PostgreSQL 17 fixture accepted');
 ok(value.rows&&Object.getPrototypeOf(value.rows)===Object.prototype&&
  Object.keys(value.rows).sort().join(',')==='audit,episodes,quarantine,sessions'&&
  Array.isArray(value.rows.episodes)&&value.rows.episodes.length===3&&
  Array.isArray(value.rows.sessions)&&value.rows.sessions.length===2&&
  Array.isArray(value.rows.audit)&&value.rows.audit.length===3&&
  value.rows.quarantine?.closed===true,
  'expected exact disposable fixture row set');
 const rowsDigest=createHash('sha256').update(JSON.stringify(value.rows)).digest('hex');
 const {pgVersion,rows,...other}=value;
 const inventory={...other,rowsDigest};
 // Uses exactly the same strict source/restore invariants and role predicates.
 verifyR167RestoredInventory({source:inventory,restored:inventory});
 ok(hex.test(rowsDigest),'independent source digest not computed');
 return Object.freeze(inventory);
}
