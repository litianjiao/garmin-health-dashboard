// No fetch handler: never cache authenticated pages, API replies or health records on the phone.
self.addEventListener('push', event => {
  let test = false;
  try { test = event.data?.json()?.kind === 'test'; } catch { /* still show a user-visible notification */ }
  event.waitUntil(self.registration.showNotification('MORU', {
    body: test ? '手机推送测试成功。' : '今日简报已就绪，点开查看。',
    icon: '/moru-192.png', tag: test ? 'moru-test' : 'moru-briefing',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/?view=briefing', self.location.origin).href;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      const window = await client.navigate(url);
      if (window) { await window.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
