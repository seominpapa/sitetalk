import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { RoomService } from './room-service.ts';

export class ChatRoom extends DurableObject<Env> {
  private service: RoomService;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx,env);
    this.service=new RoomService({
      blockConcurrencyWhile: action=>ctx.blockConcurrencyWhile(action),
      getWebSockets: tag=>ctx.getWebSockets(tag),
      waitUntil: action=>ctx.waitUntil(action),
      connect: (_request,connection)=>{
        const [client,server]=Object.values(new WebSocketPair());
        ctx.acceptWebSocket(server,[connection.userId]);
        server.serializeAttachment(connection);
        return new Response(null,{status:101,webSocket:client});
      },
    },env);
  }
  fetch(request: Request) { return this.service.fetch(request); }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) { return this.service.webSocketMessage(ws,raw); }
  webSocketClose(ws: WebSocket) { this.service.webSocketClose(ws); }
  webSocketError(ws: WebSocket) { this.service.webSocketError(ws); }
}
