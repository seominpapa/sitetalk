import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, hkdfSync, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { encryptPush, createVapidAuthorization, validatePushSubscription } from '../apps/worker/src/push.ts';

const receiver = createECDH('prime256v1');
receiver.generateKeys();
const auth = Buffer.alloc(16, 19);
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };

test('subscription validation rejects SSRF URLs and malformed key material', () => {
  assert.equal(validatePushSubscription(subscription).endpoint, subscription.endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://user@fcm.googleapis.com/a', 'https://fcm.googleapis.com:444/a', 'https://fcm.googleapis.com/a#fragment']) {
    assert.throws(() => validatePushSubscription({ ...subscription, endpoint }));
  }
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { p256dh: 'x', auth: 'x' } }));
  assert.throws(() => validatePushSubscription(null));
  assert.throws(() => validatePushSubscription({ endpoint: 42 }));
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { p256dh: 1, auth: null } }));
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: '@' } }));
});

test('aes128gcm push decrypts independently using receiver ECDH + HKDF', async () => {
  const payload = JSON.stringify({ title: 'Site Talk', body: '굴착을 중지합니다.', url: '/rooms/one' });
  const encrypted = Buffer.from(await encryptPush(validatePushSubscription(subscription), payload));
  const salt = encrypted.subarray(0, 16);
  assert.equal(encrypted.readUInt32BE(16), 4096);
  assert.equal(encrypted[20], 65);
  const serverPublic = encrypted.subarray(21, 86);
  const shared = receiver.computeSecret(serverPublic);
  const ikm = hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), serverPublic]), 32);
  const key = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', key, Buffer.from(nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  const clear = Buffer.concat([decipher.update(encrypted.subarray(86, -16)), decipher.final()]);
  assert.equal(clear.at(-1), 2);
  assert.equal(clear.subarray(0, -1).toString(), payload);
  await assert.rejects(encryptPush(validatePushSubscription(subscription), '한'.repeat(2000)), /payload/i);
});

test('VAPID JWT is ES256 signed with correct push origin and expiry', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  const authorization = await createVapidAuthorization(subscription.endpoint, publicKey, jwk.d, 'mailto:admin@example.com', 1_700_000_000);
  const token = authorization.match(/^vapid t=(.*), k=/)[1];
  const [head, body, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1_700_043_200, sub: 'mailto:admin@example.com' });
  assert.equal(verify('sha256', Buffer.from(`${head}.${body}`), { key: createPublicKey({ key: { ...jwk, d: undefined }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  await assert.rejects(createVapidAuthorization(subscription.endpoint, publicKey, jwk.d, 'invalid-contact'), /VAPID/);
});
