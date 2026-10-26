#!/usr/bin/env node
/**
 * R129: public preview SOURCE route and legacy integration gap, READ ONLY.
 * Historical legacy facts are NOT current production evidence. No private
 * credentials, old source, Auth, database, network requests or production writes.
 */
import {readdirSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-R129-LEGACY-PREVIEW-ROUTE-GAP-v1';
export const CRITICAL=Object.freeze([
 'developer-console.js','interaction-bridge.js','marcosa-config.js',
 'marcosa-supabase.js','nexus.js'
]);
export const HISTORY=Object.freeze({
 auditSha:'5a5111d01bfb55509ea634509c1170997a16a329',
 r118RunId:40244992341,legacyPublicTopLevel:34,legacyOnlyAtAudit:33,
 currentProductionProven:false
});
const SHA=/^[a-f0-9]{40}$/;
const BASENAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const EXT=new Set(['html','htm','css','js','mjs','svg','webp','png','jpg','jpeg','json']);
const EXCLUDED=new Set(['config.json','secrets.json','settings.json','credentials.json']);
const demand=(yes,reason)=>{if(!yes)throw Error(reason)};
const uniqueSorted=arr=>[...new Set(arr)].sort();
const safeFile=n=>typeof n==='string'&&BASENAME.test(n)&&!n.includes('..')&&
 !n.toLowerCase().includes('.env')&&!EXCLUDED.has(n.toLowerCase())&&
 EXT.has(n.split('.').at(-1).toLowerCase());
/* Only the SAFE public filename can leave this classifier, never raw URLs. */
export function classifyReference(input){
 if(typeof input!=='string')return {kind:'ignored'};
 const raw=input.trim();
 if(!raw||raw[0]==='#'||/^(data:|blob:|mailto:|tel:)/i.test(raw))
   return {kind:'ignored'};
 if(/^(?:https?:|\/\/)/i.test(raw))return {kind:'external'};
 if(/^(javascript:|vbscript:)/i.test(raw))return {kind:'danger'};
 if(/^[a-z][\w+.-]*:/i.test(raw))return {kind:'unreviewed'};
 if(/[\u0000-\u001f\\]/.test(raw))return {kind:'unreviewed'};
 const path=raw.split(/[?#]/,1)[0];
 if(!path||path.endsWith('/'))return {kind:'directory'};
 let decoded;
 try{decoded=decodeURIComponent(path)}catch{return {kind:'unreviewed'};}
 if(decoded.includes('%')||decoded.includes('\\')||decoded.includes('\0'))
   return {kind:'unreviewed'};
 const parts=decoded.replace(/^\/+/,'').split('/');
 const prefix=parts.length===2&&parts[0]==='.';
 if(parts.length>1&&!prefix)return {kind:'nested'};
 const name=parts.at(-1);
 if(!safeFile(name))return {kind:'unreviewed'};
 return {kind:'local',name};
}
function parseHtml(html){
 const names=[],c={external:0,danger:0,unreviewed:0,nested:0};
 let forms=0,scripts=0;
 for(const tag of html.matchAll(/<(a|link|script|img|source|iframe|form)\b[^>]*>/gi)){
   const type=tag[1].toLowerCase();
   if(type==='form')forms++;if(type==='script')scripts++;
   const wanted=type==='form'?'action':type==='a'||type==='link'?'href':'src';
   const attrs=tag[0].matchAll(/\b([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi);
   for(const a of attrs){
     if(a[1].toLowerCase()!==wanted)continue;
     const ref=classifyReference(a[2]??a[3]);
     if(ref.kind==='local')names.push(ref.name);
     if(Object.hasOwn(c,ref.kind))c[ref.kind]++;
     break;
   }
 }
 return {names:uniqueSorted(names),counts:c,forms,scripts};
}
export function auditPreview({siteDir,sourceSha}={}){
 demand(typeof sourceSha==='string'&&SHA.test(sourceSha),
   'Full exact source SHA required');
 demand(typeof siteDir==='string'&&siteDir.length>0,'Public source directory required');
 const root=resolve(siteDir),info=lstatSync(root);
 demand(info.isDirectory()&&!info.isSymbolicLink(),
   'Public site root cannot be a symlink');
 const names=readdirSync(root).sort();
 demand(names.length>=2&&names.length<=128&&names.includes('index.html'),
   'Public source inventory missing index or out of bounds');
 let total=0;
 for(const name of names){
   demand(safeFile(name),'Unexpected or sensitive source filename');
   const p=join(root,name),stat=lstatSync(p);
   demand(stat.isFile()&&!stat.isSymbolicLink(),
     'Symlink or non-file found in public asset inventory');
   demand(stat.size<=5*1024*1024,'Oversized public asset source');
   total+=stat.size;
 }
 demand(total<=64*1024*1024,'Total public source inventory exceeds cap');
 const existing=new Set(names),routes=[],missing=new Set();
 let external=0,danger=0,unreviewed=0,forms=0,scripts=0;
 for(const name of names.filter(x=>/\.html?$/i.test(x))){
   const data=parseHtml(readFileSync(join(root,name),'utf8'));
   const unfound=data.names.filter(x=>!existing.has(x));
   unfound.forEach(x=>missing.add(x));
   external+=data.counts.external;danger+=data.counts.danger;
   unreviewed+=data.counts.unreviewed+data.counts.nested;
   forms+=data.forms;scripts+=data.scripts;
   routes.push({name,linkedHtmlRoutes:data.names.filter(x=>/\.html?$/i.test(x)),
     trackedLocalReferences:data.names.length,
     missingSourceAssetCandidates:unfound});
 }
 const absent=CRITICAL.filter(x=>!existing.has(x));
 const report={
   format:FORMAT,sourceSha,scope:'new_preview_source_only',
   historicalBaseline:HISTORY,
   sourceFileCount:names.length,sourceBytes:total,htmlRouteCount:routes.length,
   routes,missingSourceAssetCandidates:uniqueSorted([...missing]),
   historicalLegacyIntegrationNames:CRITICAL,
   missingLegacyModuleFilenamesInPreview:absent,
   externalHtmlReferenceCount:external,
   unreviewedLocalReferenceCount:unreviewed,
   potentiallyUnsafeSchemeCount:danger,formTagCount:forms,scriptTagCount:scripts,
   legacyProductionRuntimeReviewed:false,authSessionAndCookieParityProven:false,
   realPostgresAuthAndPrivateStorageRestoreProven:false,
   ownerApprovedMigrationMapping:false,productionCutoverAuthorized:false,
   existingProductionFilesModified:false,productionDecision:'NO_GO',
   note:'Public static source references only, not a browser/API or current legacy VPS audit. Missing source paths may be generated during build.',
 };
 demand(JSON.stringify(report).length<65536,'Sanitized report exceeds safe output cap');
 return Object.freeze(report);
}
function main(){
 demand(process.argv.length===2,'Arbitrary arguments forbidden');
 demand(process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion',
   'Wrong GitHub repo');
 const report=auditPreview({sourceSha:process.env.GITHUB_SHA,siteDir:'site'});
 writeFileSync('marcosa-r129-preview-legacy-gap.json',
   JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R129_PUBLIC_PREVIEW_ROUTE_MAP=PASS');
 console.log('R129_HTML_ROUTES='+report.htmlRouteCount);
 console.log('R129_LEGACY_MODULE_NAMES_ABSENT='+report.missingLegacyModuleFilenamesInPreview.length);
 console.log('R129_LEGACY_RUNTIME_PARITY=NOT_VERIFIED');
 console.log('R129_PRODUCTION_DECISION=NO_GO');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main()}catch(e){
   console.error('R129_LEGACY_MAP_REFUSED='+String(e.message||e).slice(0,140));
   process.exitCode=2;
 }
}
