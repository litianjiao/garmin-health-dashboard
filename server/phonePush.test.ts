import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import webpush from 'web-push';
import { normalizeSub, openPhonePush, PhonePush } from './phonePush';

const point = createECDH('prime256v1'); point.generateKeys();
const keys = {p256dh:point.getPublicKey().toString('base64url'), auth:randomBytes(16).toString('base64url')};
const sub = {endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys};
const sqlite = await import('node:sqlite').catch(()=>null);
test('push is opt-in; passwordless servers and arbitrary callback URLs are rejected', async () => {
  assert.equal(await openPhonePush({}),null);
  await assert.rejects(openPhonePush({ WEB_PUSH_PUBLIC_KEY:'test' }),/登录/);
  for (const url of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://web.push.apple.com.evil.test/x',
    'https://evil.test@fcm.googleapis.com/x','https://fcm.googleapis.com:9443/x']) {
    assert.equal(normalizeSub({...sub,endpoint:url}),null);
  }
  assert.equal(normalizeSub({...sub,keys:{...keys,auth:'bogus'}}),null);
  assert.deepEqual(normalizeSub(sub),sub);
});
test('generate a real VAPID-authorized encrypted request without contacting a vendor', () => {
  const request = webpush.generateRequestDetails(sub,'{"kind":"briefing"}',{vapidDetails:{
    ...webpush.generateVAPIDKeys(), subject:'mailto:test@example.invalid',
  }});
  assert.equal(request.headers['Content-Encoding'],'aes128gcm');
  assert.match(String(request.headers.Authorization),/^vapid /);
  assert.ok(Buffer.isBuffer(request.body) && !request.body.includes('briefing'));
});
test('daily delivery deduplicates accepted devices, retries failures and removes expired subscriptions', {skip:!sqlite}, async () => {
  const calls = new Map<string,number>();
  const push = new PhonePush(new sqlite!.DatabaseSync(':memory:'),'public',async s => {
    const id = s.endpoint.split('/').at(-1)!; const n=(calls.get(id)??0)+1; calls.set(id,n);
    if (id==='gone') throw {statusCode:410};
    if (id==='retry' && n===1) throw {statusCode:503};
  });
  try {
    for (const id of ['one','retry','gone']) push.add({...sub,endpoint:sub.endpoint+'/'+id});
    await Promise.all([push.daily('2025-04-01'),push.daily('2025-04-01')]); await push.daily('2025-04-01');
    assert.deepEqual([...calls.entries()],[['one',1],['retry',2],['gone',1]]);
    assert.equal(await push.test(sub.endpoint+'/gone'),'gone');
    push.remove(sub.endpoint+'/one'); await push.daily('2025-04-02');
    assert.equal(calls.get('one'),1); assert.equal(calls.get('retry'),3);
  } finally { push.close(); }
});
test('the service worker reveals no health data and opens only the local briefing', async () => {
  type Event = {data?: {json:()=>unknown}; notification?: {close:()=>void}; waitUntil:(p:Promise<unknown>)=>void};
  const listeners = new Map<string,(e:Event)=>void>(), notices:string[] = [], opened:string[] = [];
  let pending: Promise<unknown> | undefined;
  const waitUntil = (p:Promise<unknown>)=>{ pending=p; };
  runInNewContext(await readFile(new URL('../public/moru-sw.js',import.meta.url),'utf8'),{URL,self:{
    addEventListener:(name:string,fn:(e:Event)=>void)=>listeners.set(name,fn), location:{origin:'https://example.test'},
    registration:{showNotification:async (title:string,opts:{body:string})=>{ notices.push(title+' '+opts.body); }},
    clients:{ matchAll:async()=>[],openWindow:async(u:string)=>{ opened.push(u); }},
  }});
  listeners.get('push')!({data:{json:()=>({kind:'briefing',text:'fixture-private-data'})},waitUntil}); await pending;
  assert.deepEqual(notices,['MORU 今日简报已就绪，点开查看。']);
  listeners.get('notificationclick')!({notification:{close:()=>{}},waitUntil}); await pending;
  assert.deepEqual(opened,['https://example.test/?view=briefing']); assert.ok(!listeners.has('fetch'));
});

test('restart preserves subscriptions and the last accepted briefing day', {skip:!sqlite}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'moru-phone-'));
  const file = join(dir,'subscriptions.sqlite'); let sends = 0;
  const open = () => new PhonePush(new sqlite!.DatabaseSync(file),'public',async()=>{ sends++; });
  try {
    let push = open(); push.add(sub); await push.daily('2025-04-01'); push.close();
    push = open();
    try { await push.daily('2025-04-01'); assert.equal(sends,1); await push.daily('2025-04-02'); assert.equal(sends,2); }
    finally { push.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
