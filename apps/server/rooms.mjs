import {WebSocketServer,WebSocket} from 'ws';
import {RoomService} from '../worker/src/room-service.ts';

export function roomRuntime(env,upgrades,background) {
  // shortcut: room ordering is process-local; add shared coordination before running replicas.
  const rooms=new Map();
  const wss=new WebSocketServer({noServer:true,maxPayload:200,perMessageDeflate:false});
  const namespace={idFromName:id=>id,get(id) {
    if(!rooms.has(id)) {
      const sockets=new Set();let queue=Promise.resolve();
      const state={sockets,active:0,touched:Date.now()};
      const context={
        getWebSockets:tag=>[...sockets].filter(socket=>!tag||socket.deserializeAttachment().userId===tag),
        blockConcurrencyWhile(action) {const result=queue.then(action);queue=result.catch(()=>{});return result;},
        waitUntil(promise) {background.add(promise);promise.finally(()=>background.delete(promise)).catch(()=>console.error('background_failed'));},
        connect(request,connection) {
          const upgrade=upgrades.get(request);
          if(!upgrade) return new Response('WebSocket upgrade required',{status:426});
          wss.handleUpgrade(upgrade.request,upgrade.socket,upgrade.head,ws=>{
            upgrade.accepted=true;
            let attachment=connection;
            const socket={
              send(value) {if(ws.readyState!==WebSocket.OPEN) throw new Error('Closed socket');ws.send(value);},
              close:(code=1000,reason='')=>ws.close(code,reason),
              serializeAttachment:value=>{attachment=structuredClone(value);},
              deserializeAttachment:()=>attachment,
            };
            sockets.add(socket);
            ws.on('message',(raw,binary)=>{void state.service.webSocketMessage(socket,binary?new ArrayBuffer(0):String(raw));});
            ws.on('close',()=>{sockets.delete(socket);state.touched=Date.now();});
            ws.on('error',()=>{state.service.webSocketError(socket);});
            ws.on('pong',()=>{ws.alive=true;});ws.alive=true;
          });
          // The Node upgrade is already written; Fetch cannot represent status 101.
          return new Response(null,{status:204});
        },
      };
      state.service=new RoomService(context,env);rooms.set(id,state);
    }
    const state=rooms.get(id);
    return {async fetch(request) {state.active++;state.touched=Date.now();try{return await state.service.fetch(request);}finally{state.active--;}}};
  }};
  const heartbeat=setInterval(()=>{
    for(const ws of wss.clients) {if(!ws.alive) {ws.terminate();continue;}ws.alive=false;ws.ping();}
    for(const [id,state] of rooms) if(!state.active&&!state.sockets.size&&Date.now()-state.touched>300_000) rooms.delete(id);
  },30_000);heartbeat.unref();
  return {namespace,close() {clearInterval(heartbeat);for(const ws of wss.clients) ws.terminate();wss.close();}};
}
