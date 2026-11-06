import webpush, { type PushSubscription } from 'web-push';
import type { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';

// Subscription endpoints come from clients. Do not let them turn the Mac into an arbitrary HTTP client.
function endpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value), h = u.hostname;
    const vendor = h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com'
      || h === 'push.apple.com' || h.endsWith('.push.apple.com') || h.endsWith('.notify.windows.com');
    return vendor && u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && u.pathname !== '/' ? u.href : null;
  } catch { return null; }
}
function key(value: unknown, length: number) {
  if (typeof value !== 'string' || value.length > 90 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const b = Buffer.from(value, 'base64url');
  return b.length === length && (length !== 65 || b[0] === 4) && b.toString('base64url') === value;
}
export function normalizeSub(input: unknown): PushSubscription | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Partial<PushSubscription>, url = endpoint(s.endpoint), keys = s.keys;
  if (!url || !keys || !key(keys.p256dh,65) || !key(keys.auth,16)) return null;
  return { endpoint:url, keys:{p256dh:keys.p256dh, auth:keys.auth} };
}
type Send = (subscription: PushSubscription, kind: 'briefing' | 'test') => Promise<unknown>;
export class PhonePush {
  private running = false;
  constructor(private db: DatabaseSync, readonly publicKey: string, private send: Send) {
    db.exec('CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, lastDay TEXT) STRICT');
  }
  add(s: PushSubscription): boolean {
    if (!this.db.prepare('SELECT 1 FROM subscriptions WHERE endpoint=?').get(s.endpoint) &&
        Number(this.db.prepare('SELECT count(*) AS n FROM subscriptions').get()!.n) >= 16) return false;
    this.db.prepare(`INSERT INTO subscriptions(endpoint,p256dh,auth) VALUES(?,?,?) ON CONFLICT(endpoint)
      DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`).run(s.endpoint,s.keys.p256dh,s.keys.auth);
    return true;
  }
  remove(url:string) { this.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(url); }
  private async deliver(s: PushSubscription, kind:'briefing'|'test') {
    try { await this.send(s,kind); return 'accepted' as const; }
    catch (e) {
      const code = (e as {statusCode?:number})?.statusCode;
      if (code === 404 || code === 410) { this.remove(s.endpoint); return 'gone' as const; }
      return 'retry' as const;
    }
  }
  async test(url:string) {
    const s = this.db.prepare('SELECT p256dh,auth FROM subscriptions WHERE endpoint=?').get(url);
    if (!s) return 'gone';
    return this.deliver({endpoint:url,keys:{p256dh:String(s.p256dh),auth:String(s.auth)}},'test');
  }
  async daily(date:string) {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.db.prepare('SELECT endpoint,p256dh,auth FROM subscriptions WHERE lastDay IS NULL OR lastDay < ?').all(date);
      for (const row of due) {
        const s = { endpoint:String(row.endpoint), keys:{p256dh:String(row.p256dh),auth:String(row.auth)} };
        if (await this.deliver(s,'briefing') === 'accepted')
          this.db.prepare('UPDATE subscriptions SET lastDay=? WHERE endpoint=?').run(date,s.endpoint);
      }
    } finally { this.running = false; }
  }
  close() { this.db.close(); }
}
export async function openPhonePush(env:NodeJS.ProcessEnv): Promise<PhonePush|null> {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim(), privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim(), subject = env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject || !env.DASHBOARD_PASSWORD || !env.SESSION_SECRET?.trim())
    throw new Error('启用手机推送需要完整的 WEB_PUSH_* 配置，并且必须启用仪表盘登录。');
  // Validate configuration without contacting a push service or logging the keys.
  try { webpush.setVapidDetails(subject,publicKey,privateKey); }
  catch { throw new Error('WEB_PUSH_SUBJECT 或 VAPID 密钥格式无效'); }
  const { DatabaseSync } = await import('node:sqlite').catch(() => { throw new Error('手机推送需要含 node:sqlite 的 Node.js 22.13+'); });
  const root = resolve(env.WEB_PUSH_DIR || '.moru-push');
  mkdirSync(root,{recursive:true,mode:0o700});
  const file = join(root,'subscriptions.sqlite');
  closeSync(openSync(file,'a',0o600));
  return new PhonePush(new DatabaseSync(file),publicKey,(sub,kind) =>
    webpush.sendNotification(sub,JSON.stringify({kind}),{ TTL:3600, timeout:10_000, topic:kind, urgency:'normal',
      vapidDetails:{subject,publicKey,privateKey} }));
}

export function registerPushRouter(app:Express, push:PhonePush|null) {
  app.get('/api/push/config', (_req,res) => res.set('Cache-Control','no-store').json({publicKey:push?.publicKey ?? null}));
  app.use('/api/push', rateLimit({ windowMs:60_000, limit:20, standardHeaders:'draft-8' }), (req,res,next) => {
    if (!push) return res.status(409).json({error:'服务端未启用手机推送'});
    if (!req.is('application/json')) return res.status(415).json({error:'需要 JSON'});
    next();
  });
  app.post('/api/push/subscription', (req,res) => {
    const s = normalizeSub(req.body);
    if (!s) return res.status(400).json({error:'订阅无效或该推送服务暂不支持'});
    if (!push!.add(s)) return res.status(409).json({error:'已达到 16 个设备的上限'});
    res.sendStatus(204);
  });
  app.delete('/api/push/subscription', (req,res) => {
    const url = endpoint(req.body?.endpoint);
    if (!url) return res.status(400).json({error:'订阅无效'});
    push!.remove(url); res.sendStatus(204);
  });
  app.post('/api/push/test', async (req,res) => {
    const url = endpoint(req.body?.endpoint);
    if (!url) return res.status(400).json({error:'订阅无效'});
    const status = await push!.test(url);
    if (status !== 'accepted') return res.status(status==='gone' ? 410 : 503).json({error:status==='gone' ? '订阅已失效，请重新订阅' : '推送服务暂时不可用'});
    res.json({accepted:true}); // Accepted by the push service is not proof of device delivery.
  });
}
export function startPhonePush(push:PhonePush|null, readyDate:()=>Promise<string|null>) {
  if (!push) return;
  const tick = async () => {
    try { const date = await readyDate(); if (date) await push.daily(date); }
    catch { console.error('[push] 本轮未完成，将在下一轮重试'); }
  };
  void tick();
  setInterval(() => { void tick(); }, 300_000).unref();
}
