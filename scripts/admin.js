import { openDatabase, passwordHash, transaction, audit } from '../lib/database.js';
import { emitKeypressEvents } from 'node:readline';
process.umask(0o077);
const username=process.argv[2];const reset=process.argv.includes('--reset');
if(!username||!/^[a-zA-Z0-9._-]{3,60}$/.test(username)){console.error('Uso: npm run admin -- nombre_usuario [--reset]');process.exit(1);}
async function readPassword(){
  if(!process.stdin.isTTY){let value='';for await(const chunk of process.stdin){value+=chunk;if(value.length>256)throw Error('Contraseña demasiado larga');}return value.replace(/\r?\n$/,'');}
  process.stderr.write('Contraseña (mínimo 12 caracteres, no se mostrará): ');
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';function done(error){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.removeListener('keypress',onKey);process.stderr.write('\n');error?reject(error):resolve(value);}
    function onKey(text,key){if(key?.ctrl&&key.name==='c')return done(Error('Cancelado'));if(key?.name==='return')return done();if(key?.name==='backspace'){value=value.slice(0,-1);return;}if(text&&!key?.ctrl&&value.length<128)value+=text;}
    process.stdin.on('keypress',onKey);
  });
}
try{
  const password=await readPassword();if(password.length<12||password.length>128||password.trim()!==password||/[\x00-\x1f]/.test(password))throw Error('Usá entre 12 y 128 caracteres, sin espacios en los extremos ni caracteres de control');
  const db=openDatabase(process.env.DB_PATH||'./data/cerro-amigo.sqlite');
  try{
    transaction(db,()=>{const old=db.prepare('SELECT id FROM users WHERE username=?').get(username);
      if(old&&!reset)throw Error('El usuario existe; --reset permite restablecer su acceso');
      if(!old&&reset)throw Error('El usuario no existe');
      if(old){db.prepare("UPDATE users SET password_hash=?,active=1 WHERE id=?").run(passwordHash(password),old.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(old.id);audit(db,old.id,'user.local_reset','user:'+old.id,{});}
      else{const r=db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,'admin',?)").run(username,passwordHash(password),new Date().toISOString());audit(db,Number(r.lastInsertRowid),'user.bootstrap','user:'+r.lastInsertRowid,{});}
    });console.log(reset?'Acceso restablecido.':'Administrador creado.');
  }finally{db.close();}
}catch(error){console.error(error.message);process.exitCode=1;}
