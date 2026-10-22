import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import handler from '../worker/src/handler.ts';
import {fail,HttpError} from '../worker/src/http.ts';
import {configuration} from './config.mjs';
import {openDatabase,createFileStore} from './storage.mjs';
import {staticAssets} from './assets.mjs';
import {roomRuntime} from './rooms.mjs';
import {dailyScheduler} from './scheduler.mjs';

export async function startServer(options={}) {
  const config=configuration(options);
  const DB=openDatabase(config.dataDir);
  const env={...config.secrets,DB,FILES:createFileStore(path.join(config.dataDir,'objects')),ASSETS:staticAssets(config.assetsDir)};
  const upgrades=new WeakMap(),background=new Set();
  const rooms=roomRuntime(env,upgrades,background);env.ROOMS=rooms.namespace;
  function incoming(message) {
    if(!message.url?.startsWith('/')||message.url.startsWith('//')) throw new HttpError(400,'INVALID_URL','잘못된 요청 주소입니다.');
    const headers=new Headers();
    for(let index=0;index<message.rawHeaders.length;index+=2) headers.append(message.rawHeaders[index],message.rawHeaders[index+1]);
    // Never trust client-supplied proxy/provider headers for origin, cookie security or rate limits.
    headers.set('CF-Connecting-IP',message.socket.remoteAddress??'unknown');
    const body=['GET','HEAD'].includes(message.method)?undefined:Readable.toWeb(message);
    return new Request(config.publicOrigin+message.url,{method:message.method,headers,...(body?{body,duplex:'half'}:{})});
  }
  async function dispatch(message,response) {
    try {
      let result;
      try {result=await handler.fetch(incoming(message),env);} catch(error) {result=fail(error);}
      response.writeHead(result.status,Object.fromEntries(result.headers));
      if(result.body) await pipeline(Readable.fromWeb(result.body),response);else response.end();
    } catch {response.destroy();console.error('http_transport_failed');}
  }
  const server=createServer({requestTimeout:60_000,headersTimeout:15_000,maxHeaderSize:16_384},(message,response)=>{void dispatch(message,response);});
  server.on('upgrade',(message,socket,head)=>{
    socket.on('error',()=>{});
    void (async()=>{
      const state={request:message,socket,head,accepted:false};
      try {
        const request=incoming(message);upgrades.set(request,state);
        const response=await handler.fetch(request,env);
        if(!state.accepted) {
          await response.body?.cancel();
          socket.end(`HTTP/1.1 ${response.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        }
      } catch {if(!state.accepted) socket.destroy();}
    })();
  });
  const tick=dailyScheduler(env);
  const runTick=()=>{const action=tick().catch(()=>console.error('schedule_failed'));background.add(action);action.finally(()=>background.delete(action));};
  let interval;
  try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});}
  catch(error) {rooms.close();DB.close();throw error;}
  if(options.schedule!==false) {runTick();interval=setInterval(runTick,30_000);interval.unref();}
  return {server,env,tick,async close() {
    clearInterval(interval);rooms.close();
    await new Promise(resolve=>server.close(resolve));
    await Promise.allSettled([...background]);DB.close();
  }};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const application=await startServer();console.log(`Site Talk listening on port ${application.server.address().port}`);
    let closing=false;
    const stop=async()=>{if(closing)return;closing=true;const force=setTimeout(()=>process.exit(1),25_000);force.unref();await application.close();clearTimeout(force);};
    process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
  } catch(error) {console.error('Site Talk startup failed:',error.message);process.exitCode=1;}
}
