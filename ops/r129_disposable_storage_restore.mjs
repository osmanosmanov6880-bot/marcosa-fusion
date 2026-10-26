#!/usr/bin/env node
/**
 * R129: byte-accurate, intentionally SYNTHETIC media-object backup and restore.
 * Cross-checks object bytes against records in an independently restored PG17
 * R128 fixture. No Supabase Storage API, user credentials, or production I/O.
 */
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {constants,copyFileSync,existsSync,readFileSync,writeFileSync,
  mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve,dirname,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const FORMAT='MARCOSA-R129-SYNTHETIC-STORAGE-BYTE-SNAPSHOT-v1';
const WORLD=[
  '12800000-0000-4128-8128-000000000101',
  '12800000-0000-4128-8128-000000000102',
];
const USERS=[
  '12800000-0000-4128-8128-000000000001',
  '12800000-0000-4128-8128-000000000002',
];
const REVIEWER='12800000-0000-4128-8128-000000000003';
const WIDTH=64,HEIGHT=48;
const PNG_SIG=Buffer.from([137,80,78,71,13,10,26,10]);
const FILE=/^world-covers\/([a-f0-9-]{36})\/([a-f0-9]{64})\.png$/;
const DIGEST=/^[a-f0-9]{64}$/;
const must=(x,m)=>{if(!x)throw Error(m);};
const digest=x=>createHash('sha256').update(x).digest('hex');
const safeUint=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;

function crc32(buf){
  let n=0xffffffff;
  for(const b of buf){
    n^=b;
    for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);
  }
  return (n^0xffffffff)>>>0;
}
function pngChunk(name,data){
  const tag=Buffer.from(name,'ascii');
  const bytes=Buffer.concat([tag,data]);
  const header=Buffer.alloc(4),tail=Buffer.alloc(4);
  header.writeUInt32BE(data.length,0);
  tail.writeUInt32BE(crc32(bytes),0);
  return Buffer.concat([header,bytes,tail]);
}
export function syntheticPng(seed){
  must(seed===1||seed===2,'Only two deterministic synthetic PNG fixtures');
  const raw=Buffer.alloc(HEIGHT*(1+WIDTH*4));
  for(let y=0;y<HEIGHT;y++){
    const start=y*(1+WIDTH*4);
    raw[start]=0;
    for(let x=0;x<WIDTH;x++){
      const at=start+1+x*4;
      raw[at]=(seed*47+x*3+y*5)&255;
      raw[at+1]=(seed*17+x*7+y*2)&255;
      raw[at+2]=(seed*89+x+y*11)&255;
      raw[at+3]=255;
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH,0);ihdr.writeUInt32BE(HEIGHT,4);
  ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([
    PNG_SIG,pngChunk('IHDR',ihdr),
    pngChunk('IDAT',deflateSync(raw,{level:9})),
    pngChunk('IEND',Buffer.alloc(0)),
  ]);
}
export function validatePng(bytes){
  must(Buffer.isBuffer(bytes)&&bytes.length>=57&&bytes.length<=786432,
    'PNG byte size is missing or outside the reviewed limit');
  must(bytes.subarray(0,8).equals(PNG_SIG),'Bad PNG signature');
  let pos=8,width=0,height=0,idat=null,phase=0;
  while(pos<bytes.length){
    must(pos+12<=bytes.length,'Truncated PNG chunk');
    const len=bytes.readUInt32BE(pos),type=bytes.toString('ascii',pos+4,pos+8);
    must(len<=786432&&pos+12+len<=bytes.length,'Unsafe PNG chunk length');
    const payload=bytes.subarray(pos+8,pos+8+len);
    const given=bytes.readUInt32BE(pos+8+len);
    must(crc32(bytes.subarray(pos+4,pos+8+len))===given,'PNG CRC mismatch');
    if(phase===0){
      must(type==='IHDR'&&len===13,'PNG must begin with IHDR');
      width=payload.readUInt32BE(0);height=payload.readUInt32BE(4);
      must(width>=1&&width<=1600&&height>=1&&height<=1600&&
        width*height<=1500000&&payload[8]===8&&payload[9]===6&&
        payload.subarray(10,13).every(v=>v===0),
        'Invalid RGBA PNG dimensions or codec');
      phase=1;
    }else if(phase===1){
      must(type==='IDAT'&&len>0,'Expected one bounded PNG IDAT');
      idat=payload;phase=2;
    }else if(phase===2){
      must(type==='IEND'&&len===0,'Expected PNG IEND');
      phase=3;
    }else throw Error('Trailing PNG chunks not allowed');
    pos+=12+len;
  }
  must(phase===3,'Missing PNG terminator');
  const max=height*(1+width*4);
  let raw;
  try{raw=inflateSync(idat,{maxOutputLength:max});}
  catch{throw Error('PNG compressed content invalid');}
  must(raw.length===max,'PNG decompressed byte count mismatch');
  for(let y=0;y<height;y++)must(raw[y*(1+width*4)]===0,
    'Unexpected PNG row filter');
  return {width,height};
}
function regularFile(path,label){
  const s=lstatSync(path);
  must(s.isFile()&&!s.isSymbolicLink(),label+' must be a non-symlink file');
  return s;
}
function realDir(path,label){
  const s=lstatSync(path);
  must(s.isDirectory()&&!s.isSymbolicLink(),
    label+' must be a non-symlink directory');
}
function safeKey(key){
  const match=typeof key==='string'&&FILE.exec(key);
  must(match&&WORLD.includes(match[1]),'Unexpected Storage object path');
  return match;
}
export function scanObjects(root){
  realDir(root,'Storage root');
  const items=[];
  function visit(dir,prefix){
    realDir(dir,'Storage directory');
    for(const name of readdirSync(dir).sort()){
      must(!name.includes('/')&&!name.includes('\\')&&name!=='.'&&name!=='..',
        'Malformed Storage basename');
      const path=join(dir,name);
      const st=lstatSync(path);
      must(!st.isSymbolicLink(),'Storage symlink forbidden');
      const key=prefix?prefix+'/'+name:name;
      if(st.isDirectory()){visit(path,key);continue;}
      must(st.isFile(),'Storage special filesystem entries refused');
      const match=safeKey(key);
      const bytes=readFileSync(path);
      const sha256=digest(bytes);
      must(match[2]===sha256,'Storage object path SHA-256 differs from bytes');
      const dim=validatePng(bytes);
      items.push({key,sha256,bytes:bytes.length,width:dim.width,height:dim.height});
      must(items.length<=128,'Too many Storage objects');
    }
  }
  visit(root,'');
  must(items.length>=1,'Storage snapshot cannot be empty');
  items.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  return items;
}
export function createSyntheticSource(root){
  must(!existsSync(root),'R129 source may not overwrite an existing directory');
  mkdirSync(root,{mode:0o700});
  for(let i=0;i<2;i++){
    const bytes=syntheticPng(i+1),sha=digest(bytes);
    const folder=join(root,'world-covers',WORLD[i]);
    mkdirSync(folder,{recursive:true,mode:0o700});
    writeFileSync(join(folder,sha+'.png'),bytes,{flag:'wx',mode:0o600});
  }
  const items=scanObjects(root);
  must(items.length===2,'Exactly two isolated Storage fixtures required');
  return items;
}
function checkedEntries(items){
  must(Array.isArray(items)&&items.length>=1&&items.length<=128,
    'Bounded Storage manifest required');
  let prev='';
  for(const e of items){
    must(e&&typeof e==='object'&&safeKey(e.key)&&
      DIGEST.test(e.sha256||'')&&
      e.key.endsWith('/'+e.sha256+'.png')&&
      safeUint(e.bytes,786432)&&e.bytes>=57&&
      safeUint(e.width,1600)&&e.width>0&&
      safeUint(e.height,1600)&&e.height>0&&
      e.width*e.height<=1500000&&e.key>prev,
      'Malformed, duplicated or unsorted Storage manifest entry');
    prev=e.key;
  }
}
function readManifest(backup){
  realDir(backup,'Snapshot root');
  const names=readdirSync(backup).sort();
  must(JSON.stringify(names)===JSON.stringify(['manifest.json','objects']),
    'Snapshot must include only manifest.json and objects');
  const manifestPath=join(backup,'manifest.json');
  regularFile(manifestPath,'Snapshot manifest');
  const bytes=readFileSync(manifestPath);
  must(bytes.length>=50&&bytes.length<=65536,'Unsafe manifest length');
  const data=JSON.parse(bytes.toString('utf8'));
  must(data&&data.format===FORMAT&&data.source==='synthetic-local-ci-only'&&
    data.productionCutoverAuthorized===false&&
    data.realCustomerObjectsIncluded===false&&
    DIGEST.test(data.sha256OfCanonicalEntries||''),
    'Untrusted or production-claiming Storage manifest');
  checkedEntries(data.entries);
  must(digest(JSON.stringify(data.entries))===data.sha256OfCanonicalEntries,
    'Storage manifest fingerprint mismatch');
  return data;
}
export function verifySnapshot(backup){
  const m=readManifest(backup);
  const observed=scanObjects(join(backup,'objects'));
  must(JSON.stringify(observed)===JSON.stringify(m.entries),
    'Snapshot object bytes differ from manifest');
  return m;
}
export function backupSyntheticStorage(source,backup){
  const entries=scanObjects(source);
  must(!existsSync(backup),'R129 backup overwrites forbidden');
  mkdirSync(backup,{mode:0o700});
  const objects=join(backup,'objects');
  mkdirSync(objects,{mode:0o700});
  for(const e of entries){
    const dest=join(objects,...e.key.split('/'));
    mkdirSync(dirname(dest),{recursive:true,mode:0o700});
    copyFileSync(join(source,...e.key.split('/')),dest,constants.COPYFILE_EXCL);
  }
  const m={
    format:FORMAT,source:'synthetic-local-ci-only',
    productionCutoverAuthorized:false,realCustomerObjectsIncluded:false,
    entries,sha256OfCanonicalEntries:digest(JSON.stringify(entries)),
  };
  writeFileSync(join(backup,'manifest.json'),JSON.stringify(m,null,2)+'\n',
    {flag:'wx',mode:0o600});
  verifySnapshot(backup);
  return m;
}
export function restoreSyntheticStorage(backup,restore){
  const m=verifySnapshot(backup);
  must(!existsSync(restore),'R129 restore destination exists; no replacement');
  mkdirSync(restore,{mode:0o700});
  for(const e of m.entries){
    const dest=join(restore,...e.key.split('/'));
    mkdirSync(dirname(dest),{recursive:true,mode:0o700});
    copyFileSync(join(backup,'objects',...e.key.split('/')),dest,
      constants.COPYFILE_EXCL);
  }
  verifyRestoredStorage(backup,restore);
  return m;
}
export function verifyRestoredStorage(backup,restore){
  const m=verifySnapshot(backup);
  const restored=scanObjects(restore);
  must(JSON.stringify(restored)===JSON.stringify(m.entries),
    'Restored Storage bytes or object keys differ from source snapshot');
  return m;
}
export function seedSqlForMetadata(items){
  checkedEntries(items);
  must(items.length===2,'Exactly two fixture objects must be seeded');
  const records=WORLD.map(id=>items.find(x=>x.key.startsWith('world-covers/'+id+'/')));
  must(records.every(Boolean),'Expected two different synthetic World object keys');
  const lines=[
    '\\set ON_ERROR_STOP on',
    "DO $$ BEGIN IF current_database()<>'postgres' THEN RAISE EXCEPTION 'R129 refuses non-disposable source'; END IF; END $$;",
    "INSERT INTO auth.users(id) VALUES ('"+REVIEWER+"');",
    "INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES ('"+REVIEWER+"','r129reviewer','Synthetic Reviewer');",
  ];
  for(let i=0;i<2;i++){
    const e=records[i],isPublic=i===1;
    lines.push("INSERT INTO marcosa_private.world_cover_assets ("+
      "world_id,uploaded_by,storage_key,sha256,mime,width,height,byte_size,"+
      "normalized,status,reviewed_by,reviewed_at) VALUES ("+
      "'"+WORLD[i]+"','"+USERS[i]+"','"+e.key+"','"+e.sha256+"','image/png',"+
      e.width+","+e.height+","+e.bytes+","+
      (isPublic?"true,'approved','"+REVIEWER+"',now()":
        "false,'pending',NULL,NULL")+");");
  }
  lines.push("SELECT 'R129_DISPOSABLE_MEDIA_METADATA_SEEDED=PASS' AS result;");
  return lines.join('\n')+'\n';
}
export function verifyRowsAgainstStorage(items,rows){
  checkedEntries(items);
  must(items.length===2&&Array.isArray(rows)&&rows.length===2,
    'R129 requires two independent restored media metadata rows');
  const index=new Map(items.map(x=>[x.key,x]));
  const seen=new Set();
  for(const row of rows){
    must(Array.isArray(row)&&row.length===11,
      'Invalid restored PostgreSQL media row format');
    const [world,owner,key,sha,bytes,width,height,normalized,status,reviewer,visibility]=row;
    const i=WORLD.indexOf(world),e=index.get(key);
    must(i!==-1&&!seen.has(world)&&e&&
      key.startsWith('world-covers/'+world+'/')&&owner===USERS[i]&&
      e.sha256===sha&&String(e.bytes)===bytes&&
      String(e.width)===width&&String(e.height)===height,
      'Restored PostgreSQL media ownership, object digest, bytes or dimensions mismatch');
    if(i===0){
      must(visibility==='private'&&normalized==='f'&&
        status==='pending'&&reviewer==='',
        'Private World media escaped pending/private access state');
    }else{
      must(visibility==='public'&&normalized==='t'&&
        status==='approved'&&reviewer===REVIEWER&&reviewer!==owner,
        'Public World media lacked independent trusted moderation');
    }
    seen.add(world);
  }
  must(seen.size===2,'Missing one of two restored Worlds');
  return true;
}
function restoredPostgresRows(){
  must(process.env.PGHOST==='127.0.0.1'&&process.env.PGPORT==='5432'&&
    process.env.PGUSER==='postgres'&&process.env.PGDATABASE==='postgres',
    'R129 requires local-only disposable PostgreSQL 17 fixture');
  const sql="SELECT a.world_id::text,a.uploaded_by::text,a.storage_key,"+
    "a.sha256,a.byte_size::text,a.width::text,a.height::text,"+
    "CASE WHEN a.normalized THEN 't' ELSE 'f' END,a.status,"+
    "coalesce(a.reviewed_by::text,''),w.visibility "+
    "FROM marcosa_private.world_cover_assets a JOIN public.marcosa_worlds w "+
    "ON w.id=a.world_id WHERE a.world_id IN ('"+WORLD.join("','")+"') "+
    "ORDER BY a.storage_key";
  const output=execFileSync('psql',[
    '-v','ON_ERROR_STOP=1','-d','marcosa_r128_restored','-At','-F','\t',
    '-c',sql,
  ],{encoding:'utf8',maxBuffer:8192,timeout:15000});
  return output.trim().split(/\r?\n/).map(x=>x.split('\t'));
}
function runnerPaths(){
  const root=process.env.RUNNER_TEMP;
  must(process.env.GITHUB_REPOSITORY===REPO&&
    typeof root==='string'&&isAbsolute(root)&&root.length<280&&
    process.env.PGHOST==='127.0.0.1'&&process.env.PGPORT==='5432'&&
    process.env.PGUSER==='postgres'&&process.env.PGDATABASE==='postgres',
    'R129 cannot operate outside official disposable local CI');
  realDir(root,'GitHub runner private temp');
  return {
    source:join(root,'marcosa-r129-source'),
    backup:join(root,'marcosa-r129-storage-snapshot'),
    restored:join(root,'marcosa-r129-restored'),
    sql:join(root,'marcosa-r129-media-fixtures.sql'),
  };
}
function cli(){
  must(process.argv.length===3,'Fixed R129 commands only');
  const mode=process.argv[2],paths=runnerPaths();
  if(mode==='seed'){
    const entries=createSyntheticSource(paths.source);
    writeFileSync(paths.sql,seedSqlForMetadata(entries),
      {flag:'wx',mode:0o600});
    console.log('R129_SYNTHETIC_PNG_OBJECTS_CREATED=2');
  }else if(mode==='backup'){
    const m=backupSyntheticStorage(paths.source,paths.backup);
    console.log('R129_DISPOSABLE_STORAGE_OBJECTS_BACKED_UP='+m.entries.length);
  }else if(mode==='restore'){
    const m=restoreSyntheticStorage(paths.backup,paths.restored);
    console.log('R129_DISPOSABLE_STORAGE_OBJECTS_RESTORED='+m.entries.length);
  }else if(mode==='attest'){
    const m=verifyRestoredStorage(paths.backup,paths.restored);
    const rows=restoredPostgresRows();
    verifyRowsAgainstStorage(m.entries,rows);
    const proof={
      format:'MARCOSA-R129-DISPOSABLE-PG17-MEDIA-RESTORE-v1',
      source:'synthetic-local-ci-only',status:'PASS',
      objectCount:m.entries.length,
      sha256OfCanonicalObjectInventory:m.sha256OfCanonicalEntries,
      byteForByteSourceSnapshotAndNewStorageRestore:'PASS',
      separatelyRestoredPostgres17MediaMetadata:'PASS',
      crossTenantOwnershipAndModeration:'PASS',
      realSupabaseStorageOrAuthVerified:false,
      realCustomerDataOrObjectsIncluded:false,
      productionCutoverAuthorized:false,verdict:'NO_GO',
    };
    writeFileSync('marcosa-r129-disposable-storage-restore-proof.json',
      JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('R129_PG17_AND_DISPOSABLE_STORAGE_CROSS_RESTORE=PASS');
    console.log('R129_REAL_CUSTOMER_STORAGE=NOT_VERIFIED');
    console.log('R129_PRODUCTION_CUTOVER=NO_GO');
  }else throw Error('Unknown R129 command');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{cli()}catch(e){
    console.error('R129_DISPOSABLE_STORAGE_REFUSED='+String(e.message||e).slice(0,180));
    process.exitCode=2;
  }
}
