import { backup } from 'node:sqlite';
import { openDatabase } from '../lib/database.js';
import { mkdirSync,chmodSync,existsSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
process.umask(0o077);
const source=process.env.DB_PATH||'./data/cerro-amigo.sqlite';
const target=process.argv[2]||'./backups/cerro-amigo-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
if(!existsSync(source))throw Error('No existe la base de datos de origen');
if(resolve(source)===resolve(target)||existsSync(target))throw Error('El destino debe ser nuevo y diferente del origen');
mkdirSync(dirname(target),{recursive:true,mode:0o700});
const db=openDatabase(source);
try{await backup(db,target);chmodSync(target,0o600);const restored=openDatabase(target);try{const result=restored.prepare('PRAGMA integrity_check').get();if(result.integrity_check!=='ok')throw Error('Falló la verificación del respaldo');console.log('Respaldo verificado: '+target);}finally{restored.close();}}finally{db.close();}
