import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, readFileSync, readdirSync, constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

function privateDirectory(directory) {
  const path=resolve(directory);
  mkdirSync(path,{recursive:true,mode:0o700});
  const stat=lstatSync(path);
  if(stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Storage directory cannot be a symlink or non-directory');
  return path;
}
function regularFile(path) {
  try {
    const stat=lstatSync(path);
    if(stat.isSymbolicLink() || !stat.isFile()) throw new Error('Storage file cannot be a symlink or non-file');
    return true;
  } catch(error) { if(error.code==='ENOENT') return false; throw error; }
}
function migrate(database,migrationsDir) {
  database.exec('CREATE TABLE IF NOT EXISTS _sitetalk_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
  const filenames=readdirSync(migrationsDir).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).sort();
  const applied=database.prepare('SELECT name,checksum FROM _sitetalk_migrations').all();
  if(applied.some(row=>!filenames.includes(row.name))) throw new Error('Applied migration file is missing');
  for(const name of filenames) {
    const sql=readFileSync(join(migrationsDir,name),'utf8');
    const checksum=createHash('sha256').update(sql).digest('hex');
    const previous=applied.find(row=>row.name===name);
    if(previous) { if(previous.checksum!==checksum) throw new Error(`Applied migration changed: ${name}`); continue; }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO _sitetalk_migrations(name,checksum) VALUES(?,?)').run(name,checksum);
      database.exec('COMMIT');
    } catch(error) { database.exec('ROLLBACK'); throw error; }
  }
}

export function openDatabase(dataDir,{migrationsDir=new URL('../../database/migrations/',import.meta.url)}={}) {
  const path=join(privateDirectory(dataDir),'site-talk.sqlite');
  regularFile(path);
  const database=new DatabaseSync(path);
  try {
    chmodSync(path,0o600);
    database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    migrate(database,migrationsDir instanceof URL ? fileURLToPath(migrationsDir) : resolve(migrationsDir));
  } catch(error) { database.close(); throw error; }
  const executions=new WeakMap();
  const changes=database.prepare('SELECT total_changes() AS n');
  const createStatement=(sql,parameters=[])=>{
    const execute=()=>{
      if(parameters.some(value=>value!==null && typeof value!=='string' && !(typeof value==='number' && Number.isFinite(value)))) throw new TypeError('Invalid SQL parameter');
      const statement=database.prepare(sql), before=changes.get().n;
      const results=statement.columns().length ? statement.all(...parameters) : (statement.run(...parameters),[]);
      return {results,meta:{changes:changes.get().n-before}};
    };
    const statement=Object.freeze({
      bind:(...values)=>createStatement(sql,[...values]),
      async first(){return execute().results[0] || null;},
      async all(){return execute();},
      async run(){return execute();},
    });
    executions.set(statement,execute);
    return statement;
  };
  let closed=false;
  return Object.freeze({
    prepare(sql){if(typeof sql!=='string') throw new TypeError('SQL must be a string');return createStatement(sql);},
    async batch(statements){
      if(!Array.isArray(statements) || statements.some(statement=>!executions.has(statement))) throw new TypeError('Batch requires statements from this database');
      database.exec('BEGIN IMMEDIATE');
      try { const results=statements.map(statement=>executions.get(statement)());database.exec('COMMIT');return results; }
      catch(error){database.exec('ROLLBACK');throw error;}
    },
    close(){if(!closed){closed=true;database.close();}},
  });
}

export function createFileStore(directory) {
  const root=privateDirectory(directory);
  const objectPath=key=>{
    if(typeof key!=='string' || !key || key.length>2048 || /[\x00-\x1f\\]/.test(key) || key.startsWith('/') || key.split('/').some(part=>!part || part==='.' || part==='..')) throw new TypeError('Invalid object key');
    return join(root,createHash('sha256').update(key).digest('hex'));
  };
  return Object.freeze({
    async put(key,value){
      const target=objectPath(key);
      regularFile(target);
      const bytes=typeof value==='string' ? Buffer.from(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer,value.byteOffset,value.byteLength) : null;
      if(!bytes || bytes.byteLength>64*1024*1024) throw new TypeError('Object must be a string or bytes no larger than 64MB');
      const temporary=`${target}.${randomUUID()}.tmp`;
      const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try {
        await file.writeFile(bytes);await file.sync();await file.close();
        await rename(temporary,target);
      } catch(error) { await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error; }
    },
    async get(key){
      const path=objectPath(key);
      if(!regularFile(path)) return null;
      let file;
      try { file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW); }
      catch(error){if(error.code==='ENOENT')return null;throw error;}
      try {
        const stat=await file.stat();
        if(!stat.isFile()) throw new Error('Object is not a regular file');
        return {body:Readable.toWeb(file.createReadStream()),size:stat.size};
      } catch(error){await file.close();throw error;}
    },
    async delete(key){
      const path=objectPath(key);
      if(!regularFile(path))return;
      try { await unlink(path); } catch(error){if(error.code!=='ENOENT')throw error;}
    },
  });
}
