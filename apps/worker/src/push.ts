import type { Env } from './env';

export interface PushSubscriptionData { endpoint: string; p256dh: string; auth: string }
const encoder = new TextEncoder();
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid push key');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
const concat = (...values: Uint8Array[]) => new Uint8Array(values.flatMap(value => [...value]));

export function validatePushSubscription(body: unknown): PushSubscriptionData {
  if (!body || typeof body !== 'object') throw new Error('Invalid push subscription');
  const value = body as Record<string, unknown>;
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new Error('Invalid push endpoint');
  const url = new URL(value.endpoint);
  const hostAllowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !hostAllowed) throw new Error('Unsupported push endpoint');
  const keys = (value.keys ?? value) as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 100 || keys.auth.length > 30) throw new Error('Invalid push keys');
  const publicKey = decode(keys.p256dh);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || decode(keys.auth).length !== 16) throw new Error('Invalid push keys');
  return { endpoint: url.href, p256dh: keys.p256dh, auth: keys.auth };
}

async function hkdf(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// RFC 8291: one aes128gcm record; notification previews are capped by the caller.
export async function encryptPush(subscription: PushSubscriptionData, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const plain = encoder.encode(payload);
  if (plain.length > 3993) throw new Error('Push payload too large');
  const receiverRaw = decode(subscription.p256dh);
  const receiver = await crypto.subtle.importKey('raw', receiverRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, sender.privateKey, 256));
  const ikm = await hkdf(shared, decode(subscription.auth), concat(encoder.encode('WebPush: info\0'), receiverRaw, senderRaw), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 16, 0, 65]), senderRaw, cipher);
}

export async function createVapidAuthorization(endpoint: string, publicKey: string, privateKey: string, subject: string, now = Math.floor(Date.now() / 1000)) {
  const publicRaw = decode(publicKey);
  if (publicRaw.length !== 65 || publicRaw[0] !== 4 || decode(privateKey).length !== 32 || !/^(mailto:|https:\/\/)/.test(subject)) throw new Error('Invalid VAPID configuration');
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: encode(publicRaw.slice(1, 33)), y: encode(publicRaw.slice(33)), d: privateKey,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = encode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = encode(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 43_200, sub: subject })));
  const token = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(token)));
  return `vapid t=${token}.${encode(signature)}, k=${publicKey}`;
}

export async function sendRoomPush(env: Env, roomId: string, senderId: string, message: { content: string; user_name: string }, visibleUserIds: string[]) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const room = await env.DB.prepare('SELECT title FROM rooms WHERE id=?').bind(roomId).first<{ title: string }>();
  if (!room) return;
  const { results } = await env.DB.prepare(`SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps JOIN room_members rm ON rm.user_id=ps.user_id
    JOIN users u ON u.id=ps.user_id WHERE rm.room_id=? AND ps.user_id<>? AND u.notification_enabled=1`)
    .bind(roomId, senderId).all<PushSubscriptionData & { id: string; user_id: string }>();
  const targets = results.filter(subscription => !visibleUserIds.includes(subscription.user_id));
  const payload = JSON.stringify({ title: 'Site Talk', body: `[${room.title.slice(0, 120)}]\n${message.user_name.slice(0, 80)}: ${message.content.slice(0, 240)}`, url: `/rooms/${encodeURIComponent(roomId)}`, tag: roomId });
  for (let start = 0; start < targets.length; start += 5) {
    await Promise.all(targets.slice(start, start + 5).map(async subscription => {
      try {
        const validated = validatePushSubscription(subscription);
        const body = await encryptPush(validated, payload);
        const authorization = await createVapidAuthorization(validated.endpoint, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!, env.VAPID_SUBJECT!);
        const response = await fetch(validated.endpoint, { method: 'POST', headers: { Authorization: authorization, TTL: '86400', 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', Urgency: 'normal' }, body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(subscription.id).run();
        else if (!response.ok) console.warn('push_delivery_failed', { subscriptionId: subscription.id, status: response.status });
        await response.body?.cancel();
      } catch {
        // Endpoint tokens, payloads and VAPID credentials must never enter logs.
        console.warn('push_delivery_failed', { subscriptionId: subscription.id });
      }
    }));
  }
}
