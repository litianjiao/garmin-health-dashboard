import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type express from 'express';
import type { DashboardData, DashboardExtended } from '../src/types';
import { makeSummary } from '../src/summary';
import { currentAiModel } from './aiModels';
import { garminDayToolData, garminTrendsToolData } from '../src/aiTools';

// ===== 数据结构 =====
export interface BriefingInsight { label: string; text: string; tone: 'good' | 'warn' | 'neutral' }
export interface DailyBriefing {
  date: string;              // 数据日期（前一天）
  forDate: string;           // 简报面向的日期（今天）
  generatedAt: string;
  source: 'ai' | 'rules';
  dataSource?: DashboardData['source']; // Absent in older saved briefings; don't push those automatically.
  model: string | null;
  headline: string;
  summary: string;
  insights: BriefingInsight[];
  trainingAdvice: string;
  recoveryAdvice: string;
  attention: string;
  error?: string;
}
interface BriefingConfig {
  enabled: boolean;
  hour: number;              // 生成时间（本地小时），默认 10
  browserNotify: boolean;
}
interface BriefingStore {
  config: BriefingConfig;
  history: DailyBriefing[];  // 最近 14 天
}

const STORE_FILE = join(process.cwd(), '.briefings.json');
const DEFAULT_CONFIG: BriefingConfig = { enabled: true, hour: 10, browserNotify: true };
const MAX_HISTORY = 14;

let storeCache: BriefingStore | null = null;
async function readStore(): Promise<BriefingStore> {
  if (storeCache) return storeCache;
  try {
    const p = JSON.parse(await readFile(STORE_FILE, 'utf8'));
    storeCache = {
      config: { ...DEFAULT_CONFIG, ...(p.config || {}) },
      history: Array.isArray(p.history) ? p.history : [],
    };
  } catch { storeCache = { config: { ...DEFAULT_CONFIG }, history: [] }; }
  return storeCache!;
}
async function writeStore(s: BriefingStore) {
  storeCache = s;
  await writeFile(STORE_FILE, JSON.stringify(s, null, 2)).catch(() => undefined);
}

const dateStr = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); };
const today = () => dateStr(new Date());

// ===== 本地规则降级简报（AI 不可用时也总有内容） =====
function rulesBriefing(d: DashboardData, t: DashboardExtended | null, pmc: { ctl: number | null; tsb: number | null; zone: string | null } | null, date: string): DailyBriefing {
  const insights: BriefingInsight[] = [];
  const h = d.sleep.hours;
  const score = d.sleep.score;
  const steps = d.activity.steps;
  const goal = d.activity.goal;
  const hrv = d.hrv.lastNight;
  const hrvBase = d.hrv.baselineLow;
  const bb = d.bodyBattery;
  const stress = d.stress.average;

  if (h !== null) insights.push({ label: '睡眠', text: `睡了 ${h.toFixed(1)} 小时${score !== null ? `，评分 ${score}` : ''}`, tone: h >= 7 ? 'good' : h >= 6 ? 'neutral' : 'warn' });
  if (hrv !== null) insights.push({ label: 'HRV', text: `昨晚 ${hrv} ms${hrvBase !== null ? `，基线 ${hrvBase}` : ''}`, tone: hrvBase !== null && hrv < hrvBase ? 'warn' : 'good' });
  if (bb !== null) insights.push({ label: '身体电量', text: `晨起/当前 ${bb}`, tone: bb >= 50 ? 'good' : bb >= 25 ? 'neutral' : 'warn' });
  if (steps !== null && goal) insights.push({ label: '活动', text: `${steps.toLocaleString()} 步，达成目标 ${Math.round(steps / goal * 100)}%`, tone: steps >= goal ? 'good' : 'neutral' });
  if (stress !== null) insights.push({ label: '压力', text: `平均压力 ${stress}`, tone: stress > 50 ? 'warn' : 'good' });
  if (pmc?.tsb !== null && pmc?.tsb !== undefined) insights.push({ label: '训练状态', text: `状态值 ${pmc.tsb}（${pmc.zone || '—'}）`, tone: pmc.tsb < -10 ? 'warn' : 'good' });

  const poorSleep = h !== null && h < 6.5;
  const lowRecovery = (bb !== null && bb < 30) || (pmc?.tsb !== null && pmc?.tsb !== undefined && pmc.tsb < -10);
  const trainingAdvice = lowRecovery || poorSleep
    ? '恢复不足，今天建议低强度：轻松步行、拉伸或瑜伽 20–30 分钟，避免高强度间歇和大重量。'
    : '状态允许正常训练；若有计划，可做中等强度有氧或力量，注意热身与补水。';
  const recoveryAdvice = poorSleep ? '今晚尽量提前 30–60 分钟上床，睡前减少屏幕与咖啡因。' : '维持当前作息，睡前保持放松节奏。';
  const attention = d.spo2.min !== null && d.spo2.min < 90 ? '夜间血氧曾有偏低读数，若持续或伴随不适应咨询医生。' : '数据仅供趋势参考，不构成医疗建议；身体不适请优先休息。';

  const headline = lowRecovery || poorSleep ? '今天先照顾好自己' : '状态不错，可以动起来';
  return {
    date, forDate: today(), generatedAt: new Date().toISOString(), source: 'rules', model: null,
    headline,
    summary: `昨天睡了 ${h !== null ? h.toFixed(1) + ' 小时' : '—'}，HRV ${hrv ?? '—'} ms，身体电量 ${bb ?? '—'}，走了 ${steps?.toLocaleString() ?? '—'} 步。`,
    insights, trainingAdvice, recoveryAdvice, attention,
  };
}

// ===== AI 简报 =====
async function aiBriefing(d: DashboardData, t: DashboardExtended | null, pmc: ReturnType<typeof pmcLatest>, date: string): Promise<DailyBriefing> {
  const baseUrl = String(process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('AI 未配置');
  const model = await currentAiModel();
  const summary = makeSummary(d, pmc);
  const trendDigest = t ? `近 ${t.range} 天均值：睡眠 ${t.averages.sleepHours ?? '—'} 小时、步数 ${t.averages.steps ?? '—'}、HRV ${t.averages.hrv ?? '—'} ms、压力 ${t.averages.stress ?? '—'}、静息心率 ${t.averages.restingHeartRate ?? '—'} bpm。` : '';

  const system = `你是用户的私人健康与健身教练，风格轻巧、真诚、略带一点毒舌但真正关心用户。基于用户昨天的 Garmin 真实数据，生成一份给"今天"看的每日简报。
只输出 JSON，不要任何解释或 Markdown 代码块，格式：
{"headline":"不超过12字的中文短句标题","summary":"2-3句中文总评","insights":[{"label":"标签","text":"一句洞察","tone":"good|warn|neutral"}],"trainingAdvice":"今天的健身/训练建议（具体到强度、时长、类型）","recoveryAdvice":"恢复/睡眠建议","attention":"需要留意的一点（含'不作医疗诊断'的克制表述）"}
规则：insights 给 3-5 条；数值必须来自数据，null/暂无表示未记录，不要编造；建议要结合恢复状态（睡眠、HRV、身体电量、TSB）；不作医疗诊断。`;
  const user = `今天是 ${today()}，以下是昨天（${date}）的数据：\n\n${summary}\n\n趋势：${trendDigest}\n\n训练负荷：CTL ${pmc?.ctl ?? '—'}，ATL ${pmc?.atl ?? '—'}，TSB ${pmc?.tsb ?? '—'}（${pmc?.zone ?? '—'}）。`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`AI 返回 ${res.status}`);
  const j = await res.json();
  let raw = j.choices?.[0]?.message?.content || '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(raw);
  return {
    date, forDate: today(), generatedAt: new Date().toISOString(), source: 'ai', model: j.model || model,
    headline: String(parsed.headline || '今日健康简报').slice(0, 40),
    summary: String(parsed.summary || ''),
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 6).map((x: Record<string, unknown>) => ({
      label: String(x.label ?? ''), text: String(x.text ?? ''),
      tone: ['good', 'warn', 'neutral'].includes(String(x.tone)) ? x.tone as BriefingInsight['tone'] : 'neutral',
    })) : [],
    trainingAdvice: String(parsed.trainingAdvice || ''),
    recoveryAdvice: String(parsed.recoveryAdvice || ''),
    attention: String(parsed.attention || '数据仅供参考，不作医疗诊断。'),
  };
}

function pmcLatest(pmcRows: Array<{ date: string; ctl: number; atl: number; tsb: number }> | null) {
  if (!pmcRows || !pmcRows.length) return null;
  const last = pmcRows[pmcRows.length - 1];
  const pct = last.ctl ? (last.tsb / last.ctl) * 100 : 0;
  const zone = pct > 25 ? '休息较多' : pct > 5 ? '恢复较好' : pct > -10 ? '负荷平衡' : pct > -30 ? '训练积累' : '疲劳偏高';
  return { ctl: last.ctl, atl: last.atl, tsb: last.tsb, zone, ramp: null };
}

// 由外部注入的数据获取器
export interface BriefingPmcRow { date: string; ctl: number; atl: number; tsb: number }
export type BriefingDataFetcher = (date: string) => Promise<{
  day: DashboardData; trends: DashboardExtended | null; pmcRows: BriefingPmcRow[] | null;
}>;

let lastGeneratedFor: string | null = null;

export async function generateBriefing(date: string, fetcher: BriefingDataFetcher, force = false): Promise<DailyBriefing> {
  const store = await readStore();
  const existing = store.history.find(b => b.forDate === today() && b.date === date);
  if (existing && !force) return existing;

  let data: Awaited<ReturnType<BriefingDataFetcher>>;
  try { data = await fetcher(date); }
  catch (e) { throw new Error(`获取 Garmin 数据失败：${e instanceof Error ? e.message : '未知错误'}`); }
  const { day, trends, pmcRows } = data;
  if (day.source === 'garmin' && [day.hrv.lastNight, day.restingHeartRate, day.sleep.hours, day.activity.steps,
    day.bodyBattery, day.stress.average, day.spo2.latest].every(x => x === null)) {
    throw new Error('该日没有足够的 Garmin 读数，暂不生成或推送简报。');
  }
  const pmc = pmcLatest(pmcRows);

  let briefing: DailyBriefing;
  try {
    briefing = await aiBriefing(day, trends, pmc, date);
  } catch (e) {
    briefing = rulesBriefing(day, trends, pmc, date);
    briefing.error = `AI 生成失败，已用本地规则简报：${e instanceof Error ? e.message : '未知错误'}`;
  }

  briefing.dataSource = day.source;
  store.history = [briefing, ...store.history.filter(b => !(b.forDate === briefing.forDate && b.date === briefing.date))].slice(0, MAX_HISTORY);
  await writeStore(store);
  lastGeneratedFor = briefing.forDate;
  return briefing;
}

export async function phoneBriefingDate(): Promise<string|null> {
  const store = await readStore();
  if (!store.config.enabled || !store.config.browserNotify) return null;
  return store.history.find(b => b.forDate === today() && b.date === yesterday() && b.dataSource === 'garmin')?.forDate ?? null;
}

export function registerBriefingRouter(app: express.Express, fetcher: BriefingDataFetcher) {
  // 今日简报（不触发重新生成，除非 missing）
  app.get('/api/briefing/today', async (_req, res) => {
    const store = await readStore();
    const b = store.history.find(x => x.forDate === today());
    res.json({ briefing: b ?? null, config: store.config });
  });

  // 历史简报列表
  app.get('/api/briefing/history', async (_req, res) => {
    const store = await readStore();
    res.json({ history: store.history, config: store.config });
  });

  // 手动（重新）生成：默认对昨天数据
  app.post('/api/briefing/generate', async (req, res) => {
    const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : yesterday();
    try {
      const b = await generateBriefing(date, fetcher, true);
      res.json({ ok: true, briefing: b });
    } catch (e) { res.status(503).json({ error: e instanceof Error ? e.message : '生成失败' }); }
  });

  // 配置读写
  app.post('/api/briefing/config', async (req, res) => {
    const store = await readStore();
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') store.config.enabled = b.enabled;
    if (typeof b.hour === 'number') store.config.hour = Math.max(0, Math.min(23, Math.round(b.hour)));
    if (typeof b.browserNotify === 'boolean') store.config.browserNotify = b.browserNotify;
    await writeStore(store);
    res.json({ ok: true, config: store.config });
  });

  // 供前端轮询：最近一次简报是否有更新
  app.get('/api/briefing/status', async (_req, res) => {
    const store = await readStore();
    res.json({ latestForDate: store.history[0]?.forDate ?? null, count: store.history.length, enabled: store.config.enabled, hour: store.config.hour });
  });
}

// ===== 定时调度 =====
export function startBriefingScheduler(fetcher: BriefingDataFetcher, notify: (b: DailyBriefing) => void) {
  let running = false;
  const maybeGenerate = async (reason: string) => {
    if (running) return;
    const store = await readStore();
    if (!store.config.enabled) return;
    const now = new Date();
    const targetDate = yesterday();
    const todayKey = today();
    if (store.history.some(b => b.forDate === todayKey && b.date === targetDate)) return;
    // 到达设定小时之后（或服务启动后的补生成）才执行
    if (now.getHours() < store.config.hour) return;
    running = true;
    try {
      const b = await generateBriefing(targetDate, fetcher);
      console.log(`[briefing] generated for ${b.forDate} (${reason}, source=${b.source})`);
      notify(b);
    } catch (e) {
      console.error('[briefing] generation failed:', e instanceof Error ? e.message : e);
    } finally { running = false; }
  };

  // 启动 5 秒后补生成；之后每 5 分钟检查一次
  setTimeout(() => { void maybeGenerate('startup catch-up'); }, 5000);
  const timer = setInterval(() => { void maybeGenerate('scheduled'); }, 300_000);
  timer.unref?.();
  return timer;
}
