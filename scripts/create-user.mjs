import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { passwordHash } from '../apps/worker/src/crypto.ts';

const { values } = parseArgs({ options: { email: { type:'string' }, name: { type:'string' }, company: { type:'string',default:'' }, department: { type:'string',default:'' }, admin: { type:'boolean',default:false }, remote: { type:'boolean',default:false } } });
if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || values.email.length>254 || !values.name?.trim() || values.name.length>80 || values.company.length>100 || values.department.length>100) {
  throw new Error('Usage: node scripts/create-user.mjs --email name@company.com --name "이름" [--admin] [--remote]');
}
const user = { id:randomUUID(), email:values.email.trim().toLowerCase(), name:values.name.trim(), role:values.admin ? 'admin':'member', password:randomBytes(24).toString('base64url') };
const hash = await passwordHash(user.password);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
await mkdir('.wrangler/accounts',{recursive:true,mode:0o700});
const receipt=`.wrangler/accounts/${user.id}.json`, sqlPath=`.wrangler/accounts/${user.id}.sql`;
await writeFile(receipt,JSON.stringify({...user,environment:values.remote?'remote':'local',status:'pending'},null,2),{mode:0o600});
await writeFile(sqlPath,`INSERT INTO users(id,email,name,role,password_hash,company,department,created_at) VALUES(${[user.id,user.email,user.name,user.role,hash,values.company,values.department,Date.now()].map(quote).join(',')});`,{mode:0o600});
try {
  execFileSync('npx',['wrangler','d1','execute','site-talk',values.remote?'--remote':'--local',`--file=${sqlPath}`],{stdio:'pipe'});
  await writeFile(receipt,JSON.stringify({...user,environment:values.remote?'remote':'local',status:'created'},null,2),{mode:0o600});
  console.log(`User created. Private login details: ${receipt}`);
} catch { throw new Error(`User creation was not confirmed. Inspect D1 before retrying. Pending private details: ${receipt}`); }
finally { await unlink(sqlPath); }
