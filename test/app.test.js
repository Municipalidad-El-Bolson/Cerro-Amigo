import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp,businessDay } from '../server.js';
import { passwordHash,openDatabase } from '../lib/database.js';
const dir=mkdtempSync(join(tmpdir(),'cerro-amigo-test-'));const dbPath=join(dir,'test.sqlite');
const origin='http://localhost:3080';let app,base,admin,operator;const password='Test-only-not-real-2026!';
async function request(path,{method='GET',data,auth=admin,customOrigin=origin,csrf=true}={}){
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','Origin':customOrigin,...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrf}:{})}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';const value=type.includes('application/json')?await response.json():await response.text();return {status:response.status,value,headers:response.headers};
}
async function login(username){const r=await request('/login',{method:'POST',data:{username,password},auth:null});assert.equal(r.status,200);return {...r.value,cookie:r.headers.get('set-cookie').split(';')[0]};}
const newVisit=(extra={})=>({id:randomUUID(),name:'Visitante de prueba',locality:'El Bolsón',adult:2,child:1,senior:1,occurred_at:new Date().toISOString(),tariff_version:1,...extra});
before(async()=>{
  app=createApp({dbPath,origin});app.db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('admin',passwordHash(password),'admin',new Date().toISOString());
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;admin=await login('admin');
});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(dir,{recursive:true,force:true});});
test('autenticación, cookie y protección CSRF/origen',async()=>{
  assert.equal((await request('/visits',{auth:null})).status,401);
  assert.equal((await request('/login',{method:'POST',auth:null,data:{username:'admin',password:'incorrecta'}})).status,401);
  assert.equal((await request('/tariffs',{method:'PUT',data:{},csrf:false})).status,403);
  assert.equal((await request('/tariffs',{method:'PUT',data:{},customOrigin:'https://evil.example'})).status,403);
  const r=await request('/login',{method:'POST',auth:null,data:{username:'admin',password}});assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('tarifas requieren configuración y usan control de versión',async()=>{
  assert.equal((await request('/visits',{method:'POST',data:newVisit({tariff_version:0})})).status,409);
  const r=await request('/tariffs',{method:'PUT',data:{adult:100000,child:50000,senior:25000,version:0,reason:'Tarifas de prueba'}});assert.equal(r.status,200);assert.equal(r.value.version,1);
  assert.equal((await request('/tariffs',{method:'PUT',data:{adult:-1,child:0,senior:0,version:1,reason:'Inválido'}})).status,400);
  assert.equal((await request('/tariffs',{method:'PUT',data:{adult:0,child:0,senior:0,version:0,reason:'Versión vieja'}})).status,409);
});
test('roles, creación y revocación de sesiones',async()=>{
  const r=await request('/users',{method:'POST',data:{username:'operador',password,role:'operator'}});assert.equal(r.status,201);operator=await login('operador');
  assert.equal((await request('/tariffs',{method:'PUT',auth:operator,data:{}})).status,403);
  assert.equal((await request('/audit',{auth:operator})).status,403);
  assert.equal((await request('/export.csv',{auth:operator})).status,403);
  assert.equal((await request('/users',{method:'POST',auth:operator,data:{}})).status,403);
  assert.equal((await request('/users/'+admin.id,{method:'PATCH',data:{active:false,reason:'Prueba'}})).status,400);
});
test('alta idempotente, tarifa histórica, importes del servidor y cobro seguro',async()=>{
  const data=newVisit({total:1,payment_status:'paid',fiscal_status:'issued'});
  const r=await request('/visits',{method:'POST',auth:operator,data});assert.equal(r.status,201);assert.equal(r.value.total,275000);assert.equal(r.value.payment_status,'pending');assert.equal(r.value.fiscal_status,'not_issued');
  assert.equal((await request('/visits',{method:'POST',auth:operator,data})).status,200);
  assert.equal((await request('/visits',{method:'POST',auth:operator,data:{...data,name:'Otra persona'}})).status,409);
  assert.equal((await request('/visits',{method:'POST',data})).status,409);
  assert.equal((await request('/visits/'+data.id+'/cash',{method:'POST',auth:operator,data:{version:1}})).status,400);
  const paid=await request('/visits/'+data.id+'/cash',{method:'POST',auth:operator,data:{version:1,confirmed:true}});assert.equal(paid.status,200);assert.equal(paid.value.payment_status,'paid');assert.equal(paid.value.fiscal_status,'not_issued');
  assert.equal((await request('/visits/'+data.id+'/cash',{method:'POST',data:{version:1,confirmed:true}})).status,200);
  assert.equal((await request('/visits/'+data.id+'/cancel',{method:'POST',data:{version:paid.value.version,reason:'Prueba'}})).status,409);
  assert.equal(app.db.prepare("SELECT count(*) n FROM audit WHERE entity=? AND action='payment.cash'").get(data.id).n,1);
});
test('validación de cantidades, fechas, texto y tarifa offline',async()=>{
  for(const extra of [{adult:-1},{adult:1.5},{adult:1001},{adult:0,child:0,senior:0},{name:''},{locality:'\nMal'},{occurred_at:'invalid'},{occurred_at:new Date(Date.now()+86400000).toISOString()}]) assert.equal((await request('/visits',{method:'POST',data:newVisit(extra)})).status,400);
  assert.equal((await request('/visits',{method:'POST',data:newVisit({tariff_version:0})})).status,409);
  assert.equal((await request('/visits',{method:'POST',data:newVisit({occurred_at:new Date(Date.now()-31*86400000).toISOString()})})).status,400);
});
test('edición auditada, anulación y concurrencia optimista',async()=>{
  const data=newVisit();await request('/visits',{method:'POST',data});
  assert.equal((await request('/visits/'+data.id,{method:'PATCH',auth:operator,data:{}})).status,403);
  const edited=await request('/visits/'+data.id,{method:'PATCH',data:{name:'Corregido',locality:'Lago Puelo',version:1,reason:'Corrección de escritura'}});assert.equal(edited.status,200);assert.equal(edited.value.version,2);
  assert.equal((await request('/visits/'+data.id,{method:'PATCH',data:{name:'Obsoleto',locality:'Otro',version:1,reason:'Viejo'}})).status,409);
  assert.equal((await request('/visits/'+data.id+'/cancel',{method:'POST',data:{version:2,reason:'Prueba de anulación'}})).status,200);
  assert.equal((await request('/visits/'+data.id+'/cash',{method:'POST',data:{version:3,confirmed:true}})).status,409);
  assert.equal(app.db.prepare("SELECT count(*) n FROM audit WHERE entity=? AND action='visit.edit'").get(data.id).n,1);
});
test('búsqueda, CSV seguro para Excel, estadísticas y claves hostiles',async()=>{
  await request('/visits',{method:'POST',data:newVisit({name:'=1+1',locality:'__proto__',adult:1,child:0,senior:0})});
  const r=await request('/visits?q='+encodeURIComponent('=1+1'));assert.equal(r.value.total,1);
  const csv=await request('/export.csv?q='+encodeURIComponent('=1+1'));assert.equal(csv.status,200);assert.ok(csv.value.includes("\"'=1+1\""));assert.match(csv.value,/Fecha cobro/);
  const stats=await request('/stats');assert.equal(stats.status,200);assert.equal(stats.value.summary.collected,275000);assert.equal(stats.value.summary.visitors,5);assert.equal(stats.value.groups.locality.__proto__.visitors,1);
  assert.equal((await request('/visits?page=-1')).status,400);assert.equal((await request('/visits?from=wrong')).status,400);
});
test('cambio de tarifas no modifica registros previos ni rompe reintentos',async()=>{
  const data=newVisit();await request('/visits',{method:'POST',data});
  await request('/tariffs',{method:'PUT',data:{adult:200000,child:50000,senior:0,version:1,reason:'Segunda tarifa'}});
  const old=await request('/visits/'+data.id);assert.equal(old.value.total,275000);assert.equal(old.value.tariffs.version,1);
  assert.equal((await request('/visits',{method:'POST',data})).status,200);
  assert.equal((await request('/visits',{method:'POST',data:newVisit()})).status,409);
});
test('deshabilitar usuario invalida la sesión existente',async()=>{
  assert.equal((await request('/users/'+operator.id,{method:'PATCH',data:{active:false,reason:'Fin de prueba'}})).status,200);
  assert.equal((await request('/me',{auth:operator})).status,401);
});
test('respaldo consistente, restauración y persistencia',async()=>{
  const target=join(dir,'backup.sqlite');const r=spawnSync(process.execPath,['scripts/backup.js',target],{env:{...process.env,DB_PATH:dbPath},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const restored=openDatabase(target);try{assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('SELECT count(*) n FROM visits').get().n,app.db.prepare('SELECT count(*) n FROM visits').get().n);assert.equal(restored.prepare('SELECT count(*) n FROM audit').get().n,app.db.prepare('SELECT count(*) n FROM audit').get().n);}finally{restored.close();}
  const reopened=openDatabase(dbPath);try{assert.equal(reopened.prepare("SELECT value FROM settings WHERE key='tariffs'").get().value.includes('200000'),true);}finally{reopened.close();}
  assert.equal(spawnSync(process.execPath,['scripts/backup.js',target],{env:{...process.env,DB_PATH:dbPath},encoding:'utf8'}).status,1);
});
test('frontend servido, CSP, APIs nunca cacheadas y recursos privados inaccesibles',async()=>{
  const r=await fetch(base+'/');assert.equal(r.status,200);assert.match(await r.text(),/Planilla|PLANILLA/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const path of ['/server.js','/data/cerro-amigo.sqlite','/.git/config'])assert.equal((await fetch(base+path)).status,404);
  const sw=readFileSync('public/sw.js','utf8');assert.match(sw,/!SHELL.includes/);assert.equal(sw.includes("'/api/"),false);
  assert.equal((await request('/visits/'+randomUUID()+'/fiscal',{method:'POST',data:{}})).status,404);
});
test('zona horaria argentina y logout efectivo',async()=>{
  assert.equal(businessDay('2026-11-03T01:00:00Z'),'2026-11-02');
  assert.equal((await request('/logout',{method:'POST',data:{}})).status,200);assert.equal((await request('/me')).status,401);
});
