/* MARCOSA R28 — REAL LOCAL SOCIAL API.
 * Executable Node 22+ laboratory: invite-only accounts, secure password hashes,
 * HttpOnly sessions, Worlds, published/draft posts and moderation reports.
 * NOT a production identity service: no verified email/recovery, and SQLite
 * is NOT the intended Supabase/Postgres production system of record.
 * Deliberately loopback-only; no server changes or credentials required.
 */
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {scrypt,randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';

const makeKey=promisify(scrypt);
const file=fileURLToPath(import.meta.url);
const DAY=86400000;
const COOKIE='marcosa_session';
const hash=s=>createHash('sha256').update(s).digest('hex');
const str=x=>typeof x==='string'?x.trim():'';
const int=x=>/^[1-9][0-9]{0,14}$/.test(String(x))&&Number.isSafeInteger(Number(x))?Number(x):0;
const REASONS=new Set(['spam','abuse','privacy','other']);
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const check=(condition,status,message)=>{if(!condition)throw new HttpError(status,message);};
const send=(res,status,value,headers={})=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});
 res.end(JSON.stringify(value));
};
const cookie=(token,maxAge=86400)=>COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
const getCookie=header=>{
 const found=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const value=found?found.slice(COOKIE.length+1):'';
 return /^[a-f0-9]{64}$/.test(value)?value:null;
};
const pwdHash=async(password,salt)=>(await makeKey(password,salt,64,{N:16384,r:8,p:1,maxmem:67108864})).toString('hex');
const passwordMatches=async(password,record)=>{
 const digest=await pwdHash(password,record?.salt||'00000000000000000000000000000000');
 return Boolean(record)&&timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(record.password_hash,'hex'));
};
async function readJSON(req){
 check(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()==='application/json',415,'Нужен application/json');
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;check(length<=65536,413,'Слишком большой запрос');chunks.push(chunk);}
 let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw new HttpError(400,'Некорректный JSON');}
 check(result&&typeof result==='object'&&!Array.isArray(result),400,'Нужен JSON-объект');
 return result;
}
const SCHEMA=[
 'PRAGMA foreign_keys=ON',
 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'member\' CHECK(role IN (\'member\',\'moderator\')), created_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id)',
 'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), status TEXT NOT NULL CHECK(status IN (\'draft\',\'published\',\'hidden\')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS idx_posts_public ON posts(status,id DESC)',
 'CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts(author_id,id DESC)',
 'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL CHECK(reason IN (\'spam\',\'abuse\',\'privacy\',\'other\')), detail TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'open\' CHECK(status IN (\'open\',\'reviewed\')), created_at INTEGER NOT NULL, UNIQUE(post_id,reporter_id))',
 'CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,id DESC)',
 "CREATE TABLE IF NOT EXISTS world_follows (world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY(world_id,user_id))",
 "CREATE INDEX IF NOT EXISTS idx_follows_user ON world_follows(user_id,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 800), status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')), created_at INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS idx_comments_visible ON comments(post_id,status,id DESC)",
 "CREATE TABLE IF NOT EXISTS comment_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE, reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL CHECK(reason IN ('spam','abuse','privacy','other')), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed')), created_at INTEGER NOT NULL, UNIQUE(comment_id,reporter_id))",
 "CREATE TABLE IF NOT EXISTS sponsor_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, brand_name TEXT NOT NULL CHECK(length(brand_name) BETWEEN 2 AND 75), headline TEXT NOT NULL CHECK(length(headline) BETWEEN 5 AND 130), landing_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL)",
 "CREATE INDEX IF NOT EXISTS idx_sponsor_status ON sponsor_proposals(status,id DESC)"
].join(';\n')+';';

export function createApp({databasePath=':memory:',inviteCode='',now=()=>Date.now()}={}){
 const db=new DatabaseSync(databasePath);
 db.exec(SCHEMA);
 const rateMap=new Map();
 const stmt={
  email:db.prepare('SELECT * FROM users WHERE email=?'),
  session:db.prepare('SELECT u.id,u.email,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?'),
  myWorlds:db.prepare('SELECT id,slug,title,description FROM worlds WHERE owner_id=? ORDER BY created_at DESC'),
  feed:db.prepare("SELECT p.id,p.body,p.created_at,(SELECT count(*) FROM comments c WHERE c.post_id=p.id AND c.status='published') AS comments_count,w.slug AS world,u.username FROM posts p JOIN worlds w ON w.id=p.world_id JOIN users u ON u.id=p.author_id WHERE p.status='published' AND p.id<? ORDER BY p.id DESC LIMIT ?"),
  byWorld:db.prepare("SELECT p.id,p.body,p.created_at,(SELECT count(*) FROM comments c WHERE c.post_id=p.id AND c.status='published') AS comments_count,w.slug AS world,u.username FROM posts p JOIN worlds w ON w.id=p.world_id JOIN users u ON u.id=p.author_id WHERE p.status='published' AND w.slug=? AND p.id<? ORDER BY p.id DESC LIMIT ?")
 };
 function throttle(key,max,duration){
  const current=now(),a=rateMap.get(key);
  const next=!a||current>a.until?{count:1,until:current+duration}:{count:a.count+1,until:a.until};
  rateMap.set(key,next);if(rateMap.size>10000)rateMap.clear();
  check(next.count<=max,429,'Превышен лимит запросов');
 }
 const clientIp=req=>req.socket.remoteAddress||'unknown';
 function originGuard(req){
  const host=String(req.headers.host||'');
  check(host&&req.headers.origin==='http://'+host,403,'Недопустимый источник');
 }
 function who(req){
  const raw=getCookie(req.headers.cookie);
  return raw?stmt.session.get(hash(raw),now())||null:null;
 }
 function requireUser(req){const user=who(req);check(user,401,'Нужен вход в аккаунт');return user;}
 const page=(rows,limit)=>{
  const items=rows.slice(0,limit);
  return{items,nextCursor:rows.length>limit?String(items.at(-1).id):null};
 };
 async function handle(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'");
  const method=req.method||'GET';
  try{
   const incoming=new URL(req.url||'/','http://localhost');
   const route=incoming.pathname;
   const query=incoming.searchParams;
   if(method==='GET'&&['/','/app.js','/style.css'].includes(route)){
    const name=route==='/'?'index.html':route.slice(1);
    const data=await readFile(new URL('./public/'+name,import.meta.url));
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(data);return;
   }
   if(method==='GET'&&route==='/marcosa-mark.svg'){
    const data=await readFile(new URL('../site/marcosa-mark.svg',import.meta.url));
    res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8'});res.end(data);return;
   }
   if(method==='GET'&&route==='/api/health'){send(res,200,{ok:true,production:false,mode:'loopback-lab'});return;}
   if(method==='GET'&&route==='/api/auth/me'){
    const user=requireUser(req);send(res,200,{user,worlds:stmt.myWorlds.all(user.id)});return;
   }
   if(method==='GET'&&route==='/api/posts'){
    const limit=Number(query.get('limit')||12);
    check(Number.isInteger(limit)&&limit>=1&&limit<=30,400,'Неверный размер страницы');
    const cursor=query.has('cursor')?int(query.get('cursor')):Number.MAX_SAFE_INTEGER;
    check(cursor>0,400,'Неверный указатель страницы');
    send(res,200,page(stmt.feed.all(cursor,limit+1),limit));return;
   }
   if(method==='GET'&&route==='/api/worlds'){
    const items=db.prepare(`SELECT w.slug,w.title,w.description,u.username AS owner,
(SELECT count(*) FROM world_follows f WHERE f.world_id=w.id) AS followers_count,
(SELECT count(*) FROM posts p WHERE p.world_id=w.id AND p.status='published') AS posts_count
FROM worlds w JOIN users u ON u.id=w.owner_id ORDER BY w.created_at DESC LIMIT 30`).all();
    send(res,200,{items});return;
   }
   const worldRoute=route.match(/^\/api\/worlds\/([a-z0-9-]{3,45})\/posts$/);
   if(method==='GET'&&worldRoute){
    const cursor=query.has('cursor')?int(query.get('cursor')):Number.MAX_SAFE_INTEGER;
    check(cursor>0,400,'Неверный указатель страницы');
    send(res,200,page(stmt.byWorld.all(worldRoute[1],cursor,21),20));return;
   }
   // R30 / open discovery: counts are SELECTs on genuine tables, not marketing metrics.
   const followRead=route.match(/^\/api\/worlds\/([a-z][a-z0-9-]{2,39})\/followers$/);
   if(method==='GET'&&followRead){
    const world=db.prepare('SELECT id,owner_id FROM worlds WHERE slug=?').get(followRead[1]);
    check(world,404,'Мир не найден');
    const count=db.prepare('SELECT count(*) AS n FROM world_follows WHERE world_id=?').get(world.id).n;
    const visitor=who(req);
    const followed=Boolean(visitor&&db.prepare('SELECT 1 FROM world_follows WHERE world_id=? AND user_id=?').get(world.id,visitor.id));
    send(res,200,{slug:followRead[1],count,followed,owned:visitor?.id===world.owner_id});return;
   }
   const commentRead=route.match(/^\/api\/posts\/([1-9][0-9]{0,14})\/comments$/);
   if(method==='GET'&&commentRead){
    const id=int(commentRead[1]);
    check(db.prepare("SELECT 1 FROM posts WHERE id=? AND status='published'").get(id),404,'Публикация не найдена');
    const limit=20;
    const cursor=query.has('cursor')?int(query.get('cursor')):Number.MAX_SAFE_INTEGER;
    check(cursor>0,400,'Неверный курсор комментариев');
    const rows=db.prepare("SELECT c.id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? AND c.status='published' AND c.id<? ORDER BY c.id DESC LIMIT ?").all(id,cursor,limit+1);
    send(res,200,page(rows,limit));return;
   }
   if(method==='GET'&&route==='/api/sponsors/approved'){
    const items=db.prepare("SELECT a.id,a.brand_name,a.headline,a.landing_url,w.slug AS world, 'ТЕСТОВОЕ РАЗМЕЩЕНИЕ · НЕ ОПЛАЧЕНО' AS disclosure FROM sponsor_proposals a JOIN worlds w ON w.id=a.world_id WHERE a.status='approved' ORDER BY a.id DESC LIMIT 12").all();
    send(res,200,{items,paid:false,production:false});return;
   }
   if(method==='GET'&&route==='/api/me/sponsors'){
    const user=requireUser(req);
    const items=db.prepare("SELECT a.id,a.brand_name,a.headline,a.status,w.slug AS world,a.created_at FROM sponsor_proposals a JOIN worlds w ON w.id=a.world_id WHERE a.owner_id=? ORDER BY a.id DESC LIMIT 30").all(user.id);
    send(res,200,{items});return;
   }
   if(method==='GET'&&route==='/api/mod/sponsors'){
    const user=requireUser(req);check(user.role==='moderator',403,'Доступ запрещён');
    const items=db.prepare("SELECT a.id,a.brand_name,a.headline,a.landing_url,a.status,w.slug AS world,u.username AS applicant FROM sponsor_proposals a JOIN worlds w ON w.id=a.world_id JOIN users u ON u.id=a.owner_id WHERE a.status='pending' ORDER BY a.id ASC LIMIT 50").all();
    send(res,200,{items});return;
   }
   if(method==='GET'&&route==='/api/mod/comment-reports'){
    const user=requireUser(req);check(user.role==='moderator',403,'Доступ запрещён');
    const items=db.prepare("SELECT r.id,r.reason,r.comment_id,c.body,r.created_at FROM comment_reports r JOIN comments c ON c.id=r.comment_id WHERE r.status='open' AND c.status='published' ORDER BY r.id ASC LIMIT 100").all();
    send(res,200,{items});return;
   }
   if(method==='GET'&&route==='/api/account/export'){
    const user=requireUser(req);
    // All rows are owner-bound; never include password hashes or session tokens.
    const worlds=stmt.myWorlds.all(user.id);
    const posts=db.prepare('SELECT id,world_id,body,status,created_at,updated_at FROM posts WHERE author_id=? ORDER BY id ASC').all(user.id);
    const reports=db.prepare('SELECT post_id,reason,detail,status,created_at FROM reports WHERE reporter_id=? ORDER BY id ASC').all(user.id);
    const follows=db.prepare("SELECT w.slug FROM world_follows f JOIN worlds w ON w.id=f.world_id WHERE f.user_id=? ORDER BY f.created_at DESC").all(user.id);
    const comments=db.prepare('SELECT post_id,body,status,created_at FROM comments WHERE author_id=? ORDER BY id ASC').all(user.id);
    const sponsorProposals=db.prepare("SELECT a.brand_name,a.headline,a.status,w.slug AS world FROM sponsor_proposals a JOIN worlds w ON w.id=a.world_id WHERE a.owner_id=? ORDER BY a.id").all(user.id);
    send(res,200,{format:'MARCOSA-ACCOUNT-EXPORT-v1',generatedAt:new Date(now()).toISOString(),
      user:{id:user.id,username:user.username,email:user.email},worlds,posts,reports,follows,comments,sponsorProposals});
    return;
   }
   if(method==='GET'&&route==='/api/me/posts'){
    const user=requireUser(req);
    const items=db.prepare('SELECT p.id,p.body,p.status,p.created_at,w.slug AS world FROM posts p JOIN worlds w ON w.id=p.world_id WHERE p.author_id=? ORDER BY p.id DESC LIMIT 50').all(user.id);
    send(res,200,{items});return;
   }
   if(method==='GET'&&route==='/api/mod/reports'){
    const user=requireUser(req);check(user.role==='moderator',403,'Доступ запрещён');
    const items=db.prepare("SELECT r.id,r.post_id,r.reason,r.detail,r.status,r.created_at,u.username AS reporter FROM reports r JOIN users u ON u.id=r.reporter_id WHERE r.status='open' ORDER BY r.id ASC LIMIT 100").all();
    send(res,200,{items});return;
   }
   check(['POST','PATCH','DELETE'].includes(method),404,'Маршрут не найден');
   originGuard(req);
   throttle('mut:'+clientIp(req),180,60000);
   const body=await readJSON(req);
   if(method==='POST'&&route==='/api/auth/register'){
    throttle('signup:'+clientIp(req),8,600000);
    check(inviteCode.length>=12,403,'Регистрация по приглашениям временно закрыта');
    check(timingSafeEqual(Buffer.from(hash(str(body.inviteCode)),'hex'),Buffer.from(hash(inviteCode),'hex')),403,'Неверный код приглашения');
    const email=str(body.email).toLowerCase(),username=str(body.username).toLowerCase();
    const password=body.password;
    check(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Неверная почта');
    check(/^[a-z][a-z0-9_]{2,23}$/.test(username),400,'Имя: 3–24 латинских символа');
    check(typeof password==='string'&&password.length>=12&&password.length<=128,400,'Пароль: 12–128 символов');
    const salt=randomBytes(16).toString('hex'),secret=await pwdHash(password,salt);
    const id=randomUUID(),worldId=randomUUID();
    try{
     db.exec('BEGIN IMMEDIATE');
     db.prepare('INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,email,username,salt,secret,now());
     db.prepare('INSERT INTO worlds(id,owner_id,slug,title,created_at) VALUES(?,?,?,?,?)').run(worldId,id,'u-'+username,'Мир '+username,now());
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw new HttpError(409,'Регистрация с указанными данными невозможна');}
    send(res,201,{created:true,username,world:'u-'+username});return;
   }
   if(method==='POST'&&route==='/api/auth/login'){
    throttle('login:'+clientIp(req),20,600000);
    const email=str(body.email).toLowerCase(),password=typeof body.password==='string'?body.password:'';
    check(email.length<=254&&password.length<=128,400,'Некорректный запрос');
    const user=stmt.email.get(email);
    check(await passwordMatches(password,user),401,'Неверная почта или пароль');
    const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token),user.id,now()+DAY);
    send(res,200,{authenticated:true},{'Set-Cookie':cookie(token)});return;
   }
   if(method==='POST'&&route==='/api/auth/logout'){
    const token=getCookie(req.headers.cookie);
    if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
    send(res,200,{authenticated:false},{'Set-Cookie':cookie('',0)});return;
   }
   const user=requireUser(req);
   // R30 real community: follow relationships are per signed-in user.
   const followWrite=route.match(/^\/api\/worlds\/([a-z][a-z0-9-]{2,39})\/follow$/);
   if(followWrite&&(method==='POST'||method==='DELETE')){
    const world=db.prepare('SELECT id,owner_id FROM worlds WHERE slug=?').get(followWrite[1]);
    check(world,404,'Мир не найден');
    check(world.owner_id!==user.id,403,'Подписка на собственный мир недоступна');
    if(method==='POST'){
     throttle('follow:'+user.id,70,3600000);
     const result=db.prepare('INSERT OR IGNORE INTO world_follows(world_id,user_id,created_at) VALUES(?,?,?)').run(world.id,user.id,now());
     send(res,result.changes?201:200,{followed:true});return;
    }
    db.prepare('DELETE FROM world_follows WHERE world_id=? AND user_id=?').run(world.id,user.id);
    send(res,200,{followed:false});return;
   }
   const commentWrite=route.match(/^\/api\/posts\/([1-9][0-9]{0,14})\/comments$/);
   if(method==='POST'&&commentWrite){
    throttle('comment:'+user.id,25,3600000);
    const postId=int(commentWrite[1]),text=str(body.body);
    check(text.length>=1&&text.length<=800,400,'Комментарий: 1–800 символов');
    check(db.prepare("SELECT 1 FROM posts WHERE id=? AND status='published'").get(postId),404,'Публикация недоступна');
    const id=db.prepare("INSERT INTO comments(post_id,author_id,body,status,created_at) VALUES(?,?,?,'published',?)").run(postId,user.id,text,now()).lastInsertRowid;
    send(res,201,{id:Number(id),postId,body:text});return;
   }
   const removeComment=route.match(/^\/api\/comments\/([1-9][0-9]{0,14})$/);
   if(method==='DELETE'&&removeComment){
    const result=db.prepare('DELETE FROM comments WHERE id=? AND author_id=?').run(int(removeComment[1]),user.id);
    check(result.changes===1,404,'Комментарий не найден');
    send(res,200,{deleted:true});return;
   }
   const reportComment=route.match(/^\/api\/comments\/([1-9][0-9]{0,14})\/report$/);
   if(method==='POST'&&reportComment){
    throttle('comment-report:'+user.id,30,3600000);
    check(REASONS.has(body.reason),400,'Причина жалобы не поддерживается');
    const id=int(reportComment[1]);
    const comment=db.prepare("SELECT c.author_id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=? AND c.status='published' AND p.status='published'").get(id);
    check(comment,404,'Комментарий не найден');
    check(comment.author_id!==user.id,403,'Нельзя жаловаться на собственный комментарий');
    try{
     db.prepare('INSERT INTO comment_reports(comment_id,reporter_id,reason,created_at) VALUES(?,?,?,?)').run(id,user.id,body.reason,now());
    }catch{throw new HttpError(409,'Жалоба уже зарегистрирована');}
    send(res,201,{received:true});return;
   }
   const hideComment=route.match(/^\/api\/mod\/comments\/([1-9][0-9]{0,14})\/hide$/);
   if(method==='POST'&&hideComment){
    check(user.role==='moderator',403,'Нет прав модератора');
    const id=int(hideComment[1]);
    const result=db.prepare("UPDATE comments SET status='hidden' WHERE id=? AND status='published'").run(id);
    check(result.changes===1,404,'Комментарий не найден');
    db.prepare("UPDATE comment_reports SET status='reviewed' WHERE comment_id=?").run(id);
    send(res,200,{hidden:true});return;
   }
   // R30 paid-advertising gate: a proposal is NOT a paid campaign.
   // There is no billing, impressions ledger, view tracking, or automatic delivery.
   if(method==='POST'&&route==='/api/sponsors/proposals'){
    throttle('sponsor:'+user.id,4,86400000);
    const worldId=str(body.worldId),brandName=str(body.brandName),headline=str(body.headline);
    check(db.prepare('SELECT id FROM worlds WHERE id=? AND owner_id=?').get(worldId,user.id),403,'Можно предлагать спонсорство только для своего мира');
    check(brandName.length>=2&&brandName.length<=75,400,'Название бренда: 2–75 символов');
    check(headline.length>=5&&headline.length<=130,400,'Заголовок предложения: 5–130 символов');
    const submittedUrl=str(body.landingUrl);
    check(submittedUrl.length<=500,400,'Адрес слишком длинный');
    let normalized;
    try{
     const url=new URL(submittedUrl);
     const host=url.hostname.toLowerCase();
     check(url.protocol==='https:'&&!url.username&&!url.password&&!url.port,400,'Разрешены только общедоступные HTTPS-сайты');
     check(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)&&!host.endsWith('.local')&&!host.endsWith('.internal')&&!/^[0-9.]+$/.test(host),400,'Необходимо публичное доменное имя');
     url.hash='';normalized=url.href;
    }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Неверный адрес сайта');}
    const count=db.prepare("SELECT count(*) AS n FROM sponsor_proposals WHERE owner_id=? AND status='pending'").get(user.id).n;
    check(count<3,409,'Допускается не более трёх нерассмотренных предложений');
    const id=db.prepare("INSERT INTO sponsor_proposals(owner_id,world_id,brand_name,headline,landing_url,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(user.id,worldId,brandName,headline,normalized,now()).lastInsertRowid;
    send(res,201,{id:Number(id),status:'pending',paid:false,verification:'not-verified'});return;
   }
   const reviewSponsor=route.match(/^\/api\/mod\/sponsors\/([1-9][0-9]{0,14})\/review$/);
   if(method==='POST'&&reviewSponsor){
    check(user.role==='moderator',403,'Нет прав модератора');
    check(body.decision==='approved'||body.decision==='rejected',400,'Неверное решение');
    const id=int(reviewSponsor[1]);
    const application=db.prepare("SELECT owner_id FROM sponsor_proposals WHERE id=? AND status='pending'").get(id);
    check(application,404,'Заявка не найдена');
    check(application.owner_id!==user.id,403,'Нельзя проверять собственную заявку');
    const result=db.prepare("UPDATE sponsor_proposals SET status=?,reviewer_id=?,reviewed_at=? WHERE id=? AND status='pending'")
     .run(body.decision,user.id,now(),id);
    check(result.changes===1,409,'Заявка уже рассмотрена');
    send(res,200,{id,status:body.decision,paid:false});return;
   }
   if(method==='POST'&&route==='/api/worlds'){
    const title=str(body.title),slug=str(body.slug).toLowerCase(),description=str(body.description);
    check(title.length>=3&&title.length<=70,400,'Название мира: 3–70 символов');
    check(/^[a-z][a-z0-9-]{2,39}$/.test(slug),400,'Неверный адрес мира');
    check(description.length<=400,400,'Описание слишком длинное');
    const n=db.prepare('SELECT count(*) AS n FROM worlds WHERE owner_id=?').get(user.id).n;
    check(n<3,409,'Лимит: три мира');
    const id=randomUUID();
    try{db.prepare('INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)').run(id,user.id,slug,title,description,now());}
    catch{throw new HttpError(409,'Адрес мира занят');}
    send(res,201,{id,slug,title,description});return;
   }
   if(method==='POST'&&route==='/api/posts'){
    throttle('post:'+user.id,25,3600000);
    const worldId=str(body.worldId),text=str(body.body),status=body.status||'draft';
    check(text.length>=1&&text.length<=2000,400,'Текст: 1–2000 символов');
    check(status==='draft'||status==='published',400,'Неверный статус');
    check(db.prepare('SELECT id FROM worlds WHERE id=? AND owner_id=?').get(worldId,user.id),403,'Нет прав на этот мир');
    const id=db.prepare('INSERT INTO posts(world_id,author_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(worldId,user.id,text,status,now(),now()).lastInsertRowid;
    send(res,201,{id:Number(id),status,worldId});return;
   }
   const item=route.match(/^\/api\/posts\/([1-9][0-9]{0,14})$/);
   if(item&&(method==='PATCH'||method==='DELETE')){
    const id=int(item[1]);check(id>0,400,'Неверный ID');
    const post=db.prepare('SELECT id,body,status FROM posts WHERE id=? AND author_id=?').get(id,user.id);
    check(post,404,'Запись не найдена');
    if(method==='DELETE'){
     db.prepare('DELETE FROM posts WHERE id=? AND author_id=?').run(id,user.id);
     send(res,200,{deleted:true});return;
    }
    check(post.status!=='hidden',409,'Публикация скрыта модерацией');
    const text=body.body===undefined?post.body:str(body.body),status=body.status===undefined?post.status:body.status;
    check(text.length>=1&&text.length<=2000,400,'Текст: 1–2000 символов');
    check(status==='draft'||status==='published',400,'Неверный статус');
    db.prepare('UPDATE posts SET body=?,status=?,updated_at=? WHERE id=? AND author_id=?').run(text,status,now(),id,user.id);
    send(res,200,{id,body:text,status});return;
   }
   if(method==='POST'&&route==='/api/reports'){
    const postId=int(body.postId),reason=body.reason,detail=str(body.detail);
    check(postId>0&&REASONS.has(reason)&&detail.length<=500,400,'Некорректная жалоба');
    const post=db.prepare("SELECT author_id FROM posts WHERE id=? AND status='published'").get(postId);
    check(post,404,'Запись не найдена');
    check(post.author_id!==user.id,403,'На собственную запись пожаловаться нельзя');
    try{db.prepare('INSERT INTO reports(post_id,reporter_id,reason,detail,created_at) VALUES(?,?,?,?,?)').run(postId,user.id,reason,detail,now());}
    catch{throw new HttpError(409,'Жалоба уже принята');}
    send(res,201,{received:true});return;
   }
   const hide=route.match(/^\/api\/mod\/posts\/([1-9][0-9]{0,14})\/hide$/);
   if(method==='POST'&&hide){
    check(user.role==='moderator',403,'Доступ запрещён');
    const id=int(hide[1]);
    const result=db.prepare("UPDATE posts SET status='hidden',updated_at=? WHERE id=? AND status='published'").run(now(),id);
    check(result.changes===1,404,'Запись не найдена');
    db.prepare("UPDATE reports SET status='reviewed' WHERE post_id=?").run(id);
    send(res,200,{hidden:true});return;
   }
   if(method==='DELETE'&&route==='/api/account'){
    check(body.confirm==='DELETE',400,'Требуется подтверждение DELETE');
    const stored=stmt.email.get(user.email);
    check(await passwordMatches(typeof body.password==='string'?body.password:'',stored),403,'Неверный пароль');
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    send(res,200,{deleted:true},{'Set-Cookie':cookie('',0)});return;
   }
   throw new HttpError(404,'Маршрут не найден');
  }catch(e){
   if(res.headersSent){res.destroy();return;}
   if(!(e instanceof HttpError))console.error('R28 request failed:',e?.message||'unknown');
   send(res,e instanceof HttpError?e.status:500,{error:e instanceof HttpError?e.message:'Внутренняя ошибка'});
  }
 }
 const server=createServer((req,res)=>{void handle(req,res);});
 return{server,db,close:()=>new Promise((ok,bad)=>server.close(err=>{db.close();err?bad(err):ok();}))};
}
if(process.argv[1]&&resolve(process.argv[1])===file){
 const host=process.env.HOST||'127.0.0.1';
 if(!['127.0.0.1','localhost','::1'].includes(host)){
  console.error('R28 is loopback-only. Refusing external network bind.');process.exit(1);
 }
 const app=createApp({databasePath:process.env.MARCOSA_DB_PATH||':memory:',inviteCode:process.env.MARCOSA_INVITE_CODE||''});
 const port=Number(process.env.PORT||8787);
 app.server.listen(port,host,()=>console.log('MARCOSA R28 LAB at http://'+host+':'+app.server.address().port));
}
