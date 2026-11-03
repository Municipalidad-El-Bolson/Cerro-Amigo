'use strict';
const $=selector=>document.querySelector(selector);
const categories={adult:'Adultos',child:'Menores',senior:'Jubilados / pensionados'};
const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value/100);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Salta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let user=null,tariffs=null,page=0,selected=null,syncing=false,saving=false,serverReachable=false;
function notice(text,error=false){$('#notice').hidden=false;$('#notice').className=error?'error':'';$('#notice').textContent=text;}
function connection(ok){serverReachable=ok;$('#connection').textContent=ok?'Conectado':'Sin conexión confirmada';}
async function api(path,method='GET',data){
  let response;
  try{response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...(user?{'X-CSRF-Token':user.csrf}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});connection(true);}
  catch(error){connection(false);throw Object.assign(new Error('Sin conexión con el servidor. Los pendientes se conservan.'),{network:true});}
  const result=await response.json();
  if(!response.ok){if(response.status===401&&path!=='/login'){user=null;$('#workspace').hidden=true;$('#login').hidden=false;$('#detail').close();}throw Object.assign(new Error(result.error||'No se pudo completar la operación'),{status:response.status});}
  return result;
}
function safe(fn){return async event=>{try{await fn(event);}catch(error){notice(error.message,true);}};}
const formData=form=>Object.fromEntries(new FormData(form));
function queueKey(){if(!user)throw Error('Iniciá sesión para acceder a los pendientes');return 'cerro-amigo-pending-v1-'+user.id;}
function readQueue(){const value=JSON.parse(localStorage.getItem(queueKey())||'[]');if(!Array.isArray(value))throw Error('La cola local no es válida; no borres los datos del navegador');return value;}
function saveQueue(queue){localStorage.setItem(queueKey(),JSON.stringify(queue));renderQueue();}
function estimate(visit){return ['adult','child','senior'].reduce((sum,k)=>sum+Number(visit[k]||0)*tariffs[k],0);}
function counters(){
  $('#counters').innerHTML=Object.entries(categories).map(([key,label])=>'<div class="counter"><div><strong>'+label+'</strong><small>'+money(tariffs?.[key]||0)+' por persona</small></div><div class="stepper"><button type="button" class="ghost" data-counter="'+key+'" data-delta="-1" aria-label="Quitar '+label+'">−</button><input aria-label="Cantidad de '+label+'" name="'+key+'" type="number" min="0" max="1000" step="1" value="'+(key==='adult'?1:0)+'" required><button type="button" class="ghost" data-counter="'+key+'" data-delta="1" aria-label="Agregar '+label+'">+</button></div></div>').join('');
  $('#save-visit').disabled=saving||!tariffs?.configured;
  $('#tariff-hint').textContent=tariffs?.configured?'Tarifas versión '+tariffs.version+' · El importe se valida en el servidor.':'Administración debe configurar las tarifas antes del primer registro.';
  calculate();
}
function calculate(){if(!tariffs)return;const data=formData($('#visit-form'));$('#people-total').textContent=['adult','child','senior'].reduce((n,k)=>n+Number(data[k]||0),0);$('#money-total').textContent=money(estimate(data));}
async function loadTariffs(){tariffs=await api('/tariffs');for(const key of Object.keys(categories))$('#tariff-form').elements[key].value=(tariffs[key]/100).toFixed(2);}
async function enter(){
  $('#login').hidden=true;$('#workspace').hidden=false;$('#identity').textContent=user.username+' · '+(user.role==='admin'?'Administración':'Operador');$('#admin-tab').hidden=user.role!=='admin';$('#export').hidden=user.role!=='admin';
  await loadTariffs();counters();renderQueue();await tab('register');
}
async function tab(name){
  if(name==='admin'&&user?.role!=='admin')return;
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==name);
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='history')await history();if(name==='dashboard')await stats();if(name==='admin')await administration();if(name==='queue')renderQueue();
}
function tags(v){return '<span class="tag">'+(v.registration_status==='cancelled'?'Anulado':'Registrado')+'</span><span class="tag '+(v.payment_status==='paid'?'paid':'pending')+'">'+(v.payment_status==='paid'?'Efectivo confirmado':'Pago pendiente')+'</span><span class="tag">Fiscal: no emitido</span>';}
function filters(){return new URLSearchParams(formData($('#filters')));}
async function history(){
  const params=filters();params.set('page',page);const data=await api('/visits?'+params);
  $('#history-info').textContent=data.total+' registros · Página '+(page+1);$('#previous').disabled=page===0;$('#next').disabled=(page+1)*50>=data.total;
  $('#visit-list').innerHTML=data.rows.length?data.rows.map(v=>'<article class="visit"><div><h3>'+escape(v.name)+'</h3><p>'+escape(v.locality)+' · '+escape(v.business_day)+' · '+(v.adult+v.child+v.senior)+' visitantes</p>'+tags(v)+'</div><div><p><strong>'+money(v.total)+'</strong></p><button class="ghost" data-visit="'+v.id+'">Ver detalle</button></div></article>').join(''):'<p>No hay visitas en este período.</p>';
}
async function detail(id){
  selected=await api('/visits/'+id);const v=selected;
  $('#detail-content').innerHTML='<p class="muted">Registro '+escape(v.id)+'</p><h2>'+escape(v.name)+'</h2><p>'+escape(v.locality)+' · '+escape(v.business_day)+'</p>'+tags(v)+'<dl>'+Object.entries(categories).map(([k,l])=>'<dt>'+l+'</dt><dd>'+v[k]+'</dd>').join('')+'<dt>Total de visitantes</dt><dd>'+(v.adult+v.child+v.senior)+'</dd><dt>Importe total</dt><dd>'+money(v.total)+'</dd><dt>Recibido por el servidor</dt><dd>'+escape(new Date(v.received_at).toLocaleString('es-AR'))+'</dd></dl><div class="warning">Este registro no es un comprobante fiscal.</div><div class="actions">'+(v.registration_status==='registered'&&v.payment_status==='pending'?'<button id="cash">Confirmar efectivo recibido</button>':'')+(user.role==='admin'&&v.registration_status==='registered'?'<button class="ghost" id="edit-visit">Corregir nombre / localidad</button>':'')+(user.role==='admin'&&v.registration_status==='registered'&&v.payment_status==='pending'?'<button class="danger" id="cancel-visit">Anular registro</button>':'')+'</div>';
  if(!$('#detail').open)$('#detail').showModal();
}
function renderQueue(){
  if(!user)return;const queue=readQueue();$('#queue-count').textContent=queue.length;
  $('#queue-list').innerHTML=queue.length?queue.map(v=>'<article class="visit"><div><h3>'+escape(v.name)+'</h3><p>'+escape(v.locality)+' · '+(v.adult+v.child+v.senior)+' visitantes</p><p>Registro pendiente de validación · Pago no confirmado · Fiscal no emitido</p><p>'+escape(v.error||'Listo para sincronizar')+'</p></div>'+(v.tariffConflict?'<button class="ghost" data-reprice="'+v.id+'">Revisar nueva tarifa</button>':'')+'</article>').join(''):'<p>No hay registros pendientes en esta cuenta y tablet.</p>';
}
async function syncQueue(){
  if(syncing||!user)return;syncing=true;$('#sync').disabled=true;let sent=0;
  try{
    for(const item of readQueue()){
      const {error,tariffConflict,...payload}=item;
      try{await api('/visits','POST',payload);saveQueue(readQueue().filter(v=>v.id!==item.id));sent++;}
      catch(err){if(!user)throw err;const queue=readQueue();const current=queue.find(v=>v.id===item.id);if(current){current.error=err.message;current.tariffConflict=err.status===409&&err.message.startsWith('Las tarifas cambiaron');saveQueue(queue);}if(err.network||err.status===401)break;}
    }
    notice(sent+' registro(s) sincronizado(s). '+(user?readQueue().length:0)+' pendiente(s). No se confirmó ningún cobro automáticamente.');
  }finally{syncing=false;$('#sync').disabled=false;}
}
async function stats(){
  const data=await api('/stats?'+filters());const s=data.summary;
  const names={day:'Por día de visita',month:'Por mes de visita',locality:'Por procedencia',category:'Por categoría',method:'Por medio de pago'};
  const labels={...categories,cash:'Efectivo',pending:'Pendiente'};
  $('#stats').innerHTML='<div class="metrics">'+[['Visitantes',s.visitors],['Registros',s.registrations],['Cobrado',money(s.collected)],['Pendiente de cobro',money(s.pending)]].map(([label,n])=>'<div class="metric">'+label+'<strong>'+n+'</strong></div>').join('')+'</div><p>'+escape(data.basis)+'. Se excluyen registros anulados.</p>'+Object.entries(data.groups).map(([kind,group])=>'<h2>'+names[kind]+'</h2><div class="table-wrap"><table><thead><tr><th>Grupo</th><th>Visitantes</th><th>Cobrado ARS</th></tr></thead><tbody>'+Object.entries(group).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>'<tr><td>'+escape(Object.hasOwn(labels,key)?labels[key]:key)+'</td><td>'+val.visitors+'</td><td>'+money(val.revenue)+'</td></tr>').join('')+'</tbody></table></div>').join('');
}
async function administration(){
  await loadTariffs();const users=await api('/users');
  $('#users').innerHTML=users.map(u=>'<article class="visit"><div><strong>'+escape(u.username)+'</strong><p>'+escape(u.role)+' · '+(u.active?'Activo':'Deshabilitado')+'</p></div>'+(u.id!==user.id?'<button class="ghost" data-user="'+u.id+'" data-active="'+u.active+'">'+(u.active?'Deshabilitar':'Habilitar')+'</button>':'')+'</article>').join('');await audit();
}
async function audit(){const rows=await api('/audit');$('#audit').innerHTML='<table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escape(new Date(r.at).toLocaleString('es-AR'))+'</td><td>'+escape(r.username)+'</td><td>'+escape(r.action)+'</td><td>'+escape(r.details)+'</td></tr>').join('')+'</tbody></table>';}
$('#login-form').addEventListener('submit',safe(async e=>{e.preventDefault();user=await api('/login','POST',formData(e.target));e.target.reset();await enter();notice('Sesión iniciada.');}));
$('#logout').addEventListener('click',safe(async()=>{
  if(syncing||saving)throw Error('Esperá a que termine el guardado o la sincronización');
  if(!confirm('Cerrar sesión'+(readQueue().length?' dejando pendientes en esta tablet, accesibles al volver a ingresar con esta cuenta':'')+'?'))return;
  await api('/logout','POST',{});user=null;tariffs=null;$('#workspace').hidden=true;$('#login').hidden=false;$('#visit-form').reset();for(const id of ['visit-list','queue-list','stats','users','audit','detail-content'])$('#'+id).replaceChildren();$('#detail').close();notice('Sesión cerrada.');
}));
document.querySelector('nav').addEventListener('click',safe(async e=>{const button=e.target.closest('[data-tab]');if(button)await tab(button.dataset.tab);}));
$('#counters').addEventListener('click',e=>{const b=e.target.closest('[data-counter]');if(!b)return;const input=$('#visit-form').elements[b.dataset.counter];input.value=Math.max(0,Math.min(1000,Number(input.value)+Number(b.dataset.delta)));calculate();});
$('#visit-form').addEventListener('input',calculate);
$('#visit-form').addEventListener('submit',safe(async e=>{
  e.preventDefault();const button=$('#save-visit');if(button.disabled||saving)return;saving=true;button.disabled=true;
  try{
    const data=formData(e.target);const visit={id:crypto.randomUUID(),name:data.name.trim(),locality:data.locality.trim(),adult:Number(data.adult),child:Number(data.child),senior:Number(data.senior),occurred_at:new Date().toISOString(),tariff_version:tariffs.version};
    if(!visit.name||!visit.locality||visit.adult+visit.child+visit.senior===0)throw Error('Completá los datos e ingresá al menos un visitante');
    const queue=readQueue();if(queue.length>=500)throw Error('Límite de 500 pendientes alcanzado. Sincronizá antes de continuar');
    saveQueue([...queue,visit]);e.target.reset();counters();notice('Registro guardado en la tablet. Pendiente de validación; pago no confirmado.');
    if(navigator.onLine){await syncQueue();if(user&&!readQueue().some(v=>v.id===visit.id))await detail(visit.id);}
  }finally{saving=false;button.disabled=!tariffs?.configured;}
}));
$('#filters').addEventListener('submit',safe(async e=>{e.preventDefault();page=0;await history();}));
$('#previous').addEventListener('click',safe(async()=>{page=Math.max(0,page-1);await history();}));$('#next').addEventListener('click',safe(async()=>{page++;await history();}));
$('#visit-list').addEventListener('click',safe(async e=>{const b=e.target.closest('[data-visit]');if(b)await detail(b.dataset.visit);}));
$('#close-detail').addEventListener('click',()=>$('#detail').close());
$('#detail-content').addEventListener('click',safe(async e=>{
  const id=e.target.id;if(!['cash','edit-visit','cancel-visit'].includes(id))return;
  const v=selected;e.target.disabled=true;
  try{
    if(id==='cash'){if(!confirm('¿Recibiste '+money(v.total)+' en efectivo? No confirmes si el dinero no fue recibido.'))return;await api('/visits/'+v.id+'/cash','POST',{version:v.version,confirmed:true});}
    if(id==='cancel-visit'){const reason=prompt('Motivo de anulación (no se borra el historial):');if(!reason)return;await api('/visits/'+v.id+'/cancel','POST',{version:v.version,reason});}
    if(id==='edit-visit'){const name=prompt('Nombre y apellido:',v.name);if(name===null)return;const locality=prompt('Localidad:',v.locality);if(locality===null)return;const reason=prompt('Motivo de la corrección:');if(!reason)return;await api('/visits/'+v.id,'PATCH',{version:v.version,name,locality,reason});}
    await detail(v.id);notice('Cambio guardado y auditado.');
  }finally{e.target.disabled=false;}
}));
$('#sync').addEventListener('click',safe(syncQueue));
$('#queue-list').addEventListener('click',safe(async e=>{
  const b=e.target.closest('[data-reprice]');if(!b)return;await loadTariffs();const queue=readQueue();const item=queue.find(v=>v.id===b.dataset.reprice);if(!item?.tariffConflict)return;
  if(confirm('La nueva tarifa da un importe de '+money(estimate(item))+'. ¿Actualizar este pendiente y volver a validar?')){item.tariff_version=tariffs.version;delete item.error;delete item.tariffConflict;saveQueue(queue);await syncQueue();}
}));
$('#export').addEventListener('click',safe(async()=>{
  const response=await fetch('/api/export.csv?'+filters());if(!response.ok)throw Error((await response.json()).error);const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='cerro-amigo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}));
$('#refresh-stats').addEventListener('click',safe(stats));$('#refresh-audit').addEventListener('click',safe(audit));
$('#tariff-form').addEventListener('submit',safe(async e=>{
  e.preventDefault();const data=formData(e.target);const values={version:tariffs.version,reason:data.reason};
  for(const key of Object.keys(categories))values[key]=Math.round(Number(data[key])*100);
  tariffs=await api('/tariffs','PUT',values);e.target.elements.reason.value='';counters();notice('Tarifas guardadas. Los registros existentes conservan sus importes.');
}));
$('#user-form').addEventListener('submit',safe(async e=>{e.preventDefault();await api('/users','POST',formData(e.target));e.target.reset();await administration();notice('Usuario creado.');}));
$('#users').addEventListener('click',safe(async e=>{const b=e.target.closest('[data-user]');if(!b)return;const reason=prompt('Motivo del cambio de acceso:');if(!reason)return;await api('/users/'+b.dataset.user,'PATCH',{active:b.dataset.active!=='1',reason});await administration();}));
window.addEventListener('offline',()=>connection(false));window.addEventListener('online',()=>{notice('Conexión de red recuperada. Sincronizá los pendientes para validar los registros.');});
$('#today').textContent=new Date().toLocaleDateString('es-AR',{dateStyle:'long',timeZone:'America/Argentina/Salta'});$('#filters').elements.from.value=day().slice(0,7)+'-01';$('#filters').elements.to.value=day();
(async()=>{try{user=await api('/me');await enter();}catch(error){if(error.status!==401)notice(error.message,true);}if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>notice('No se pudo activar el modo sin conexión. Usá HTTPS o localhost.',true));})();
