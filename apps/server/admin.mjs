import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {openDatabase} from './storage.mjs';
import {passwordHash} from '../worker/src/crypto.ts';

export async function createAdministrator({dataDir=process.env.SITE_TALK_DATA_DIR??'data',email,name}) {
  if(typeof email!=='string'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof name!=='string'||!name.trim()||name.length>80) throw new Error('Valid --email and --name are required');
  const db=openDatabase(dataDir);
  let receipt;
  try {
    const normalized=email.trim().toLowerCase();
    if(await db.prepare('SELECT id FROM users WHERE email=?').bind(normalized).first()) throw new Error('Account already exists; no password or role changed');
    const account={id:randomUUID(),email:normalized,name:name.trim(),role:'admin',password:randomBytes(24).toString('base64url')};
    const encoded=await passwordHash(account.password);
    const directory=path.join(dataDir,'accounts');await mkdir(directory,{recursive:true,mode:0o700});
    receipt=path.join(directory,`${account.id}.json`);
    await writeFile(receipt,JSON.stringify({...account,status:'created'},null,2),{mode:0o600,flag:'wx'});
    await db.prepare('INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(account.id,account.email,account.name,account.role,encoded,Date.now()).run();
    return receipt;
  } catch(error) {if(receipt) await unlink(receipt);throw error;}
  finally {db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {values}=parseArgs({options:{email:{type:'string'},name:{type:'string'}}});
    console.log(`Administrator created. Private login details: ${await createAdministrator(values)}`);
  } catch {console.error('Administrator creation failed. Check arguments, existing account and private data volume.');process.exitCode=1;}
}
