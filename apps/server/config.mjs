import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';

function realLocation(value) {
  const absolute=path.resolve(value);
  try {return realpathSync(absolute);} catch(error) {
    if(error.code!=='ENOENT') throw error;
    return path.join(realLocation(path.dirname(absolute)),path.basename(absolute));
  }
}

export function configuration(options={}) {
  const source=options.environment??process.env;
  const secret=name=>{
    if (source[name] && source[`${name}_FILE`]) throw new Error(`Set either ${name} or ${name}_FILE`);
    return source[`${name}_FILE`]?readFileSync(source[`${name}_FILE`],'utf8').trim():source[name];
  };
  const encryptionKey=options.encryptionKey??secret('AI_SETTINGS_ENCRYPTION_KEY');
  if (!encryptionKey || !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) || Buffer.from(encryptionKey,'base64').length!==32) throw new Error('A stable 32-byte base64 encryption key is required');
  const origin=options.publicOrigin??source.PUBLIC_ORIGIN;
  let url;
  try {url=new URL(origin);} catch {throw new Error('PUBLIC_ORIGIN must be an explicit HTTPS origin');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.origin!==origin || url.username || url.password || (!['https:'].includes(url.protocol) && !(local&&url.protocol==='http:'))) throw new Error('PUBLIC_ORIGIN requires HTTPS (HTTP is allowed only for loopback development)');
  const port=options.port??Number(source.PORT??3000);
  if (!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid PORT');
  const secrets={AI_SETTINGS_ENCRYPTION_KEY:encryptionKey};
  for(const name of ['OPENAI_API_KEY','OPENAI_MODEL','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT']) {
    const value=secret(name); if(value) secrets[name]=value;
  }
  const dataDir=realLocation(options.dataDir??source.SITE_TALK_DATA_DIR??'data'),assetsDir=realLocation(options.assetsDir??'dist');
  if(dataDir===assetsDir||dataDir.startsWith(assetsDir+path.sep)||assetsDir.startsWith(dataDir+path.sep)) throw new Error('Private data and public assets must use separate, non-overlapping directories');
  return {dataDir,assetsDir,publicOrigin:url.origin,port,host:options.host??source.HOST??'127.0.0.1',secrets};
}
