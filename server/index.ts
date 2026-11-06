import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { GarminMcp } from './garmin';
import { GarminOfficialApi } from './garminOfficial';
import { demoData } from '../src/demo';
import { demoTrends } from '../src/demoTrends';
import { openHealthHistory, registerHistoryRouter } from './history';
import { PmcService } from './pmc';
import { registerAiRouter } from './ai';
import { registerAiModelRouter } from './aiModels';
import { registerMetricsRouter, loadLocalEntries } from './localMetrics';
import { registerBriefingRouter, startBriefingScheduler, type BriefingDataFetcher, type DailyBriefing } from './briefing';
import { execFile } from 'node:child_process';

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const historyDir = (process.env.HEALTH_HISTORY_DIR || '').trim();
// With history enabled, the collector keeps its bearer only in this account's process.
const official = new GarminOfficialApi(!historyDir);
const pmc = new PmcService(official);
const garmin = new GarminMcp();
const useMcp = process.env.GARMIN_TRANSPORT === 'mcp';
const configured = official.configured || Boolean(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD);
const password = process.env.DASHBOARD_PASSWORD || '';
const secret = process.env.SESSION_SECRET || 'local-only-moru-session';
const CACHE_TTL_MS = 600_000; // 10 分钟缓存，与 APK 行为一致；仅手动刷新才强制重新获取
const cache = new Map<string, { time: number; data: unknown }>();
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } } }));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.disable('x-powered-by');
registerAiRouter(app, cache);
registerAiModelRouter(app);
registerMetricsRouter(app);

// 每日简报的数据获取器：复用缓存，避免重复调用 Garmin API
const briefingFetcher: BriefingDataFetcher = async () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const locals = await loadLocalEntries();
  const day = configured && !useMcp ? await official.dashboard(date, locals) : demoData(date);
  let trends = null;
  try { trends = await official.extended(date, 7); } catch { /* 趋势不可用时简报仍可生成 */ }
  let pmcRows = null;
  try { const p = await pmc.compute(date, 42, 0); pmcRows = p.rows.map(r => ({ date: r.date, ctl: r.ctl, atl: r.atl, tsb: r.tsb })); } catch { /* 同上 */ }
  return { day, trends, pmcRows };
};
registerBriefingRouter(app, briefingFetcher);

function desktopNotify(b: DailyBriefing) {
  if (process.platform !== 'win32') return;
  const title = `MORU · ${b.headline}`.replace(/'/g, "''");
  const body = b.summary.replace(/["'`\\]/g, '').slice(0, 180).replace(/'/g, "''");
  const balloon = `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle='${title}'; $n.BalloonTipText='${body}'; $n.Visible=$true; $n.ShowBalloonTip(10000); Start-Sleep -Seconds 12; $n.Dispose()`;
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', balloon], { windowsHide: true }, () => undefined);
}
startBriefingScheduler(briefingFetcher, desktopNotify);

function signature(value: string) { return createHmac('sha256', secret).update(value).digest('base64url'); }
function safeEqual(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function validSession(value?: string) {
  if (!password) return true;
  if (!value) return false;
  const [expires, sig] = value.split('.');
  return Boolean(expires && Number(expires) > Date.now() && sig && safeEqual(signature(expires), sig));
}
app.use('/api', (req, res, next) => {
  if (req.path === '/session' || validSession(req.cookies.moru_session)) return next();
  res.status(401).json({ error: '请先登录', authRequired: true });
});
app.post('/api/session', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8' }), (req, res) => {
  if (!password) return res.json({ authenticated: true });
  const supplied = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(supplied, password)) return res.status(401).json({ error: '密码不正确' });
  const expires = String(Date.now() + 7 * 86400_000);
  res.cookie('moru_session', `${expires}.${signature(expires)}`, { httpOnly: true, sameSite: 'strict', secure: process.env.SECURE_COOKIES === 'true', maxAge: 7 * 86400_000, path: '/' });
  res.json({ authenticated: true });
});
app.delete('/api/session', (_req, res) => { res.clearCookie('moru_session', { path: '/' }); res.json({ authenticated: false }); });
const historyAccount = useMcp
  ? (process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD ? `mcp:${process.env.GARMIN_USERNAME.trim().toLowerCase()}` : null)
  : (official.configured ? `official:${process.env.GARMIN_API_KEY!.trim()}` : null);
if (historyDir && ((!password && !['localhost','127.0.0.1','::1'].includes(host)) || (password && !process.env.SESSION_SECRET?.trim()))) {
  throw new Error('网络模式下启用本地历史需同时设置 DASHBOARD_PASSWORD 和 SESSION_SECRET');
}
const history = await openHealthHistory(historyDir, historyAccount);
let historyWarning: string | undefined;
registerHistoryRouter(app, history, Boolean(historyDir), official.configured && !useMcp ? date => official.personalHistory(date) : null, () => historyWarning);
if (history) process.once('exit', () => history.close());

app.get('/api/config', (_req, res) => res.json({ configured, demo: !configured, authEnabled: Boolean(password) }));
app.get('/api/trends', async (req, res) => {
  const requested = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  const range = req.query.range === '30' ? 30 : 7;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const key = `trend:${requested}:${range}`;
  const hit = cache.get(key);
  if (req.query.refresh !== '1' && hit && Date.now() - hit.time < CACHE_TTL_MS) return res.json(hit.data);
  try {
    const data = configured && !useMcp ? await official.extended(requested, range) : demoTrends(range);
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Garmin trends request failed:', message);
    res.status(503).json({ error: message || '暂时无法获取趋势数据。' });
  }
});
app.get('/api/pmc', async (req, res) => {
  const requested = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  const days = [42, 91, 182].includes(Number(req.query.days)) ? Number(req.query.days) : 91;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  if (!configured || useMcp) return res.status(503).json({ error: '训练负荷需要官方 Garmin API key，且不支持 MCP 备用通道。' });
  const key = `pmc:${requested}:${days}`;
  const hit = cache.get(key);
  if (req.query.refresh !== '1' && hit && Date.now() - hit.time < CACHE_TTL_MS) return res.json(hit.data);
  try {
    const data = await pmc.compute(requested, days);
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PMC request failed:', message);
    res.status(503).json({ error: message || '暂时无法计算训练负荷。' });
  }
});
app.get('/api/dashboard', async (req, res) => {
  const requested = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const useDemo = !configured;
  if (req.query.demo === '1' && !password && configured) return res.status(403).json({ error: '配置 Garmin 后仅展示真实数据' });
  if (useMcp && !configured) return res.status(400).json({ error: 'GARMIN_TRANSPORT=mcp 需要 .env 中配置 GARMIN_USERNAME / GARMIN_PASSWORD' });
  const key = `${requested}:${useDemo}`;
  const hit = cache.get(key);
  if (req.query.refresh !== '1' && hit && Date.now() - hit.time < CACHE_TTL_MS) return res.json(hit.data);
  try {
    const locals = await loadLocalEntries();
    const data = useDemo ? demoData(requested)
      : useMcp ? await garmin.dashboard(requested)
      : await official.dashboard(requested, locals);
    if (history) {
      try { history.recordDay(data); historyWarning = undefined; }
      catch { historyWarning = '本次数据未写入本地历史；请检查目录权限与剩余空间。'; }
    }
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Garmin data request failed:', message);
    res.status(503).json({ error: message || '暂时无法连接 Garmin，请稍后重试。', canUseDemo: true });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist');
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
const server = app.listen(port, host, () => console.log(`MORU dashboard: http://${host}:${port} (${configured ? 'Garmin' : 'demo'} mode)`));
async function shutdown() { server.close(); await garmin.close(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
