import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase, passwordHash, verifyPassword, transaction, audit } from './lib/database.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const str = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) fail(400, 'Texto inválido');
  return value.trim();
};
const integer = (value, max) => { if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(400, 'Cantidad o importe inválido'); return value; };
export const businessDay = date => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Argentina/Salta', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(date));
const tariff = db => JSON.parse(db.prepare("SELECT value FROM settings WHERE key='tariffs'").get().value);
const view = row => { if (!row) fail(404, 'Registro no encontrado'); const {request_hash, ...rest} = row; return {...rest, tariffs:JSON.parse(row.tariffs)}; };
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Se requiere JSON');
  let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 16384) fail(413, 'Solicitud demasiado grande'); }
  try { const value = JSON.parse(data); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { fail(400, 'JSON inválido'); }
}
export function createApp({dbPath = process.env.DB_PATH || './data/cerro-amigo.sqlite', origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3080'} = {}) {
  const db = openDatabase(dbPath);
  const appOrigin = new URL(origin).origin;
  const secure = appOrigin.startsWith('https:');
  const attempts = new Map();
  const dummyHash = passwordHash(randomBytes(32).toString('hex'));
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
  const assets = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
  const mime = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
    if (!token) fail(401, 'Iniciá sesión');
    const row = db.prepare('SELECT s.*, u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires>? AND active=1').get(sha(token), Date.now());
    if (!row) fail(401, 'La sesión venció. Iniciá sesión nuevamente'); return row;
  }
  function filter(url) {
    const from = url.searchParams.get('from') || businessDay(Date.now()).slice(0,7)+'-01';
    const to = url.searchParams.get('to') || businessDay(Date.now());
    if (![from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d) || from > to) fail(400,'Rango de fechas inválido');
    const q = (url.searchParams.get('q') || '').slice(0,120);
    return {sql:'business_day BETWEEN ? AND ? AND (instr(lower(name),lower(?))>0 OR instr(lower(locality),lower(?))>0)',args:[from,to,q,q]};
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    const send = (status, value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value));};
    try {
      const url = new URL(req.url,'http://localhost'); const path = url.pathname;
      if (req.method === 'GET' && assets[path]) {
        const file = assets[path]; res.writeHead(200, {'Content-Type':mime[file.split('.').pop()]}); res.end(readFileSync(resolve(publicDir,file))); return;
      }
      if (!path.startsWith('/api/')) fail(404,'No encontrado');
      const mutating = !['GET','HEAD'].includes(req.method);
      if (mutating && req.headers.origin !== appOrigin) fail(403,'Origen no permitido');
      if (path === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const count = attempts.get(ip) || {n:0,until:now+15*60*1000};
        if (count.n >= 10 || attempts.size > 10000) {res.setHeader('Retry-After','900'); fail(429,'Demasiados intentos. Esperá 15 minutos');}
        count.n++; attempts.set(ip,count);
        const data = await body(req); const username = str(data.username,60); const password = str(data.password,256);
        const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
        const valid = verifyPassword(password,user?.password_hash || dummyHash);
        if (!user || !valid) fail(401,'Usuario o contraseña incorrectos');
        attempts.delete(ip);
        const token = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
        db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sha(token),user.id,csrf,now+8*60*60*1000);
        res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(secure?'; Secure':''));
        audit(db,user.id,'login','user:'+user.id,{});
        send(200,{id:user.id,username:user.username,role:user.role,csrf}); return;
      }
      const user = session(req);
      if (mutating && req.headers['x-csrf-token'] !== user.csrf) fail(403,'Token de sesión inválido');
      const admin = () => {if (user.role !== 'admin') fail(403,'Acceso exclusivo de administración');};
      if (path === '/api/me' && req.method === 'GET') {send(200,{id:user.user_id,username:user.username,role:user.role,csrf:user.csrf}); return;}
      if (path === '/api/logout' && req.method === 'POST') {db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash); res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(secure?'; Secure':'')); send(200,{ok:true}); return;}
      if (path === '/api/tariffs') {
        if (req.method === 'GET') {send(200,tariff(db)); return;}
        if (req.method === 'PUT') {
          admin(); const data = await body(req); const reason = str(data.reason,300);
          const result = transaction(db,()=>{
            const old = tariff(db); if (data.version !== old.version) fail(409,'Las tarifas cambiaron. Recargá');
            const next = {adult:integer(data.adult,100000000),child:integer(data.child,100000000),senior:integer(data.senior,100000000),version:old.version+1,configured:true};
            db.prepare("UPDATE settings SET value=? WHERE key='tariffs'").run(JSON.stringify(next));
            audit(db,user.user_id,'tariffs.update','tariffs',{old,next,reason}); return next;
          }); send(200,result); return;
        }
      }
      if (path === '/api/visits' && req.method === 'POST') {
        const data = await body(req); const id = str(data.id,36);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) fail(400,'Identificador inválido');
        const payload = {id,name:str(data.name),locality:str(data.locality),adult:integer(data.adult,1000),child:integer(data.child,1000),senior:integer(data.senior,1000),occurred_at:str(data.occurred_at,40),tariff_version:integer(data.tariff_version,1000000)};
        const hash = sha(JSON.stringify(payload));
        const result = transaction(db,()=>{
          const existing = db.prepare('SELECT * FROM visits WHERE id=?').get(id);
          if (existing) {if (existing.user_id !== user.user_id || existing.request_hash !== hash) fail(409,'Identificador ya usado con otros datos'); return {created:false,visit:view(existing)};}
          if (payload.adult+payload.child+payload.senior === 0) fail(400,'Ingresá al menos un visitante');
          const date = Date.parse(payload.occurred_at);
          if (!Number.isFinite(date) || date > Date.now()+5*60000 || date < Date.now()-30*86400000) fail(400,'Fecha fuera del rango permitido (30 días)');
          const tariffs = tariff(db);
          if (!tariffs.configured) fail(409,'Administración debe configurar las tarifas');
          if (tariffs.version !== payload.tariff_version) fail(409,'Las tarifas cambiaron. Revisá el importe antes de reenviar');
          const total = payload.adult*tariffs.adult+payload.child*tariffs.child+payload.senior*tariffs.senior;
          db.prepare('INSERT INTO visits(id,user_id,request_hash,received_at,occurred_at,business_day,name,locality,adult,child,senior,tariffs,total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id,user.user_id,hash,new Date().toISOString(),new Date(date).toISOString(),businessDay(date),payload.name,payload.locality,payload.adult,payload.child,payload.senior,JSON.stringify(tariffs),total);
          audit(db,user.user_id,'visit.create',id,{total,tariff_version:tariffs.version});
          return {created:true,visit:view(db.prepare('SELECT * FROM visits WHERE id=?').get(id))};
        }); send(result.created?201:200,result.visit); return;
      }
      const match = path.match(/^\/api\/visits\/([a-f0-9-]{36})(?:\/(cash|cancel))?$/i);
      if (match) {
        const [,id,action] = match;
        if (req.method === 'GET' && !action) {send(200,view(db.prepare('SELECT * FROM visits WHERE id=?').get(id)));return;}
        if (req.method === 'PATCH' && !action) {
          admin(); const data = await body(req); const name=str(data.name), locality=str(data.locality), reason=str(data.reason,300);
          const result = transaction(db,()=>{
            const old=view(db.prepare('SELECT * FROM visits WHERE id=?').get(id));
            if (old.version !== data.version) fail(409,'El registro cambió. Recargá');
            if (old.registration_status !== 'registered') fail(409,'Registro anulado');
            db.prepare('UPDATE visits SET name=?,locality=?,version=version+1 WHERE id=?').run(name,locality,id);
            audit(db,user.user_id,'visit.edit',id,{before:{name:old.name,locality:old.locality},after:{name,locality},reason});
            return view(db.prepare('SELECT * FROM visits WHERE id=?').get(id));
          });send(200,result);return;
        }
        if (req.method === 'POST' && action) {
          const data = await body(req); if(action==='cancel') admin();
          const result = transaction(db,()=>{
            const old=view(db.prepare('SELECT * FROM visits WHERE id=?').get(id));
            if (action==='cash' && old.payment_status==='paid' && old.payment_method==='cash') return old;
            if (action==='cancel' && old.registration_status==='cancelled') return old;
            if (old.version!==data.version) fail(409,'El registro cambió. Recargá');
            if (old.registration_status!=='registered' || old.payment_status!=='pending') fail(409,'Estado incompatible');
            if (action==='cash') {
              if (data.confirmed !== true) fail(400,'Confirmá que recibiste el efectivo');
              db.prepare("UPDATE visits SET payment_status='paid',payment_method='cash',paid_at=?,version=version+1 WHERE id=?").run(new Date().toISOString(),id);
              audit(db,user.user_id,'payment.cash',id,{total:old.total});
            } else {
              const reason = str(data.reason,300);
              db.prepare("UPDATE visits SET registration_status='cancelled',version=version+1 WHERE id=?").run(id);
              audit(db,user.user_id,'visit.cancel',id,{reason});
            }
            return view(db.prepare('SELECT * FROM visits WHERE id=?').get(id));
          });send(200,result);return;
        }
      }
      if (path === '/api/visits' && req.method === 'GET') {
        const {sql,args}=filter(url); const page=integer(Number(url.searchParams.get('page')||0),100000);
        const total=db.prepare('SELECT count(*) as n FROM visits WHERE '+sql).get(...args).n;
        const rows=db.prepare('SELECT * FROM visits WHERE '+sql+' ORDER BY received_at DESC,id LIMIT 50 OFFSET ?').all(...args,page*50);
        send(200,{total,page,rows:rows.map(view)});return;
      }
      if (path === '/api/export.csv' && req.method === 'GET') {
        admin(); const {sql,args}=filter(url);
        if (db.prepare('SELECT count(*) AS n FROM visits WHERE '+sql).get(...args).n>10000) fail(400,'Exportación limitada a 10000 registros; reducí el período');
        const rows=db.prepare('SELECT * FROM visits WHERE '+sql+' ORDER BY business_day,id').all(...args);
        const cell = value => {let s=String(value??''); if (/^[\s]*[=+@-]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"';};
        const headers=['ID','Fecha visita','Fecha cobro','Nombre','Procedencia','Adultos','Menores','Jubilados/pensionados','Total ARS','Registro','Pago','Medio','Fiscal'];
        const lines=[headers,...rows.map(r=>[r.id,r.business_day,r.paid_at,r.name,r.locality,r.adult,r.child,r.senior,(r.total/100).toFixed(2),r.registration_status,r.payment_status,r.payment_method,r.fiscal_status])];
        audit(db,user.user_id,'visits.export','visits',{count:rows.length,from:args[0],to:args[1]});
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="cerro-amigo.csv"'});res.end('\ufeff'+lines.map(row=>row.map(cell).join(';')).join('\r\n'));return;
      }
      if (path === '/api/stats' && req.method === 'GET') {
        const {sql,args}=filter(url);
        const rows=db.prepare("SELECT * FROM visits WHERE registration_status='registered' AND "+sql).all(...args);
        const summary={registrations:rows.length,visitors:0,expected:0,collected:0,pending:0};
        const groups={day:{},month:{},locality:{},category:{},method:{}};
        const add=(kind,key,visitors,revenue)=>{const group=groups[kind][key] ||= {visitors:0,revenue:0};group.visitors+=visitors;group.revenue+=revenue;};
        // Null-prototype dictionaries avoid user-controlled locality keys mutating prototypes.
        for(const key of Object.keys(groups)) groups[key]=Object.create(null);
        for (const r of rows) {
          const n=r.adult+r.child+r.senior, revenue=r.payment_status==='paid'?r.total:0;
          summary.visitors+=n;summary.expected+=r.total;summary.collected+=revenue;if(r.payment_status==='pending')summary.pending+=r.total;
          add('day',r.business_day,n,revenue);add('month',r.business_day.slice(0,7),n,revenue);add('locality',r.locality,n,revenue);add('method',r.payment_method||'pending',n,revenue);
          const t=JSON.parse(r.tariffs);for(const cat of ['adult','child','senior']) add('category',cat,r[cat],r.payment_status==='paid'?r[cat]*t[cat]:0);
        }
        send(200,{summary,groups,basis:'Ingresos cobrados de visitas del período seleccionado (no cierre de caja por fecha de cobro)'});return;
      }
      if (path === '/api/users') {
        admin();
        if(req.method==='GET'){send(200,db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY username').all());return;}
        if(req.method==='POST'){
          const data=await body(req);const username=str(data.username,60), password=str(data.password,256);
          if(!/^[a-zA-Z0-9._-]{3,60}$/.test(username)||password.length<12||!['admin','operator'].includes(data.role))fail(400,'Usuario inválido o contraseña menor a 12 caracteres');
          if(db.prepare('SELECT id FROM users WHERE username=?').get(username))fail(409,'El usuario ya existe');
          const hash=passwordHash(password);
          const id=transaction(db,()=>{const r=db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run(username,hash,data.role,new Date().toISOString());audit(db,user.user_id,'user.create','user:'+r.lastInsertRowid,{username,role:data.role});return Number(r.lastInsertRowid);});send(201,{id,username,role:data.role});return;
        }
      }
      const um=path.match(/^\/api\/users\/(\d+)$/);
      if(um && req.method==='PATCH'){
        admin();const id=Number(um[1]),data=await body(req);if(id===user.user_id)fail(400,'No podés modificar tu propio acceso desde aquí');
        if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))fail(404,'Usuario no encontrado');
        const reason=str(data.reason,300);const active=data.active;if(typeof active!=='boolean')fail(400,'Estado inválido');
        let hash=null;if(data.password){const password=str(data.password,256);if(password.length<12)fail(400,'Contraseña mínima: 12 caracteres');hash=passwordHash(password);}
        transaction(db,()=>{db.prepare('UPDATE users SET active=?,password_hash=coalesce(?,password_hash) WHERE id=?').run(Number(active),hash,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(db,user.user_id,'user.update','user:'+id,{active,passwordChanged:!!hash,reason});});send(200,{ok:true});return;
      }
      if(path==='/api/audit' && req.method==='GET'){admin();send(200,db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').all());return;}
      fail(404,'Función no disponible. Point y facturación fiscal no están habilitados');
    } catch(error) {
      if(!error.status) console.error('Error interno:',error.code || error.name);
      if(!res.headersSent) send(error.status||500,{error:error.status?error.message:'Error interno. No repitas un cobro sin comprobar su estado'});
      else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,db};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||3080);
  const {server,db}=createApp();
  server.listen(port,host,()=>console.log('Cerro Amigo: '+(process.env.APP_ORIGIN||'http://127.0.0.1:'+port)));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
