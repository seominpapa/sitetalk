import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
export function staticAssets(directory) {
  return {async fetch(request) {
    if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    let pathname;
    try {pathname=decodeURIComponent(new URL(request.url).pathname);} catch {return new Response('Not found',{status:404});}
    if(pathname.includes('\0')||pathname.split('/').some(part=>part.startsWith('.'))) return new Response('Not found',{status:404});
    const root=await realpath(directory);
    let filename=path.resolve(root,`.${pathname}`),handle;
    if(filename!==root&&!filename.startsWith(root+path.sep)) return new Response('Not found',{status:404});
    try {
      filename=await realpath(filename);
      if(filename!==root&&!filename.startsWith(root+path.sep)) return new Response('Not found',{status:404});
      handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
      if(!(await handle.stat()).isFile()) {await handle.close();handle=undefined;}
    } catch(error) {if(!['ENOENT','EISDIR','ENOTDIR'].includes(error.code)) throw error;}
    if(!handle) {
      if(path.extname(pathname)) return new Response('Not found',{status:404});
      filename=path.join(root,'index.html');handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    }
    const size=(await handle.stat()).size;
    const headers={'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Content-Length':String(size),'X-Content-Type-Options':'nosniff','Cache-Control':filename.includes(path.sep+'assets'+path.sep)?'public, max-age=31536000, immutable':'no-cache'};
    if(request.method==='HEAD') {await handle.close();return new Response(null,{headers});}
    return new Response(Readable.toWeb(handle.createReadStream()),{headers});
  }};
}
