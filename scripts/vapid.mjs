const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
await mkdir('.wrangler',{recursive:true,mode:0o700});
await writeFile('.wrangler/vapid.env',`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\n`,{mode:0o600,flag:'wx'});
console.log('VAPID keys saved privately in .wrangler/vapid.env. Existing keys are never overwritten.');
import { mkdir, writeFile } from 'node:fs/promises';
