/* Private messages and attachments are never stored in a service-worker cache. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json() || {}; } catch { payload = { body: '새로운 메시지가 도착했습니다.' }; }
  const roomPath = payload.url || (payload.room_id ? `/rooms/${encodeURIComponent(payload.room_id)}` : '/');
  const url = new URL(roomPath, self.location.origin);
  const safePath = url.origin === self.location.origin && /^\/rooms\/[^/]+$/.test(url.pathname) ? url.pathname : '/';
  event.waitUntil(self.registration.showNotification(payload.title || 'Site Talk', {
    body: payload.body || '새로운 메시지가 도착했습니다.', icon: '/icon-192.png', badge: '/icon-192.png',
    tag: payload.tag || payload.room_id || 'site-talk', data: { url: safePath },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (client) { await client.navigate(path); return client.focus(); }
    return self.clients.openWindow(path);
  }));
});
