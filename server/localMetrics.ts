import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type express from 'express';
import type { DayDetail } from '../src/types';

const LOCAL_FILE = join(process.cwd(), '.local-metrics.json');

interface LocalEntry { date: string; weightKg?: number; bodyFat?: number; note?: string }
let cache: LocalEntry[] | null = null;

export async function loadLocalEntries(): Promise<LocalEntry[]> {
  if (cache) return cache;
  try { cache = JSON.parse(await readFile(LOCAL_FILE, 'utf8')); } catch { cache = []; }
  return cache!;
}
async function save(entries: LocalEntry[]) {
  cache = entries;
  await writeFile(LOCAL_FILE, JSON.stringify(entries, null, 2)).catch(() => undefined);
}

// Garmin Personal API 不支持写入体重/体脂（均为只读端点），因此本地记录保存在项目目录
export function registerMetricsRouter(app: express.Express) {
  app.get('/api/metrics/local', async (_req, res) => res.json(await loadLocalEntries()));

  app.post('/api/metrics/local', async (req, res) => {
    const body = req.body || {};
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
    if (!date) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
    const weightKg = typeof body.weightKg === 'number' && body.weightKg > 20 && body.weightKg < 400 ? body.weightKg : undefined;
    const bodyFat = typeof body.bodyFat === 'number' && body.bodyFat > 2 && body.bodyFat < 70 ? body.bodyFat : undefined;
    if (weightKg === undefined && bodyFat === undefined) return res.status(400).json({ error: '请填写体重（20–400kg）或体脂（2–70%）' });
    const entries = await loadLocalEntries();
    const existing = entries.find(e => e.date === date);
    if (existing) {
      if (weightKg !== undefined) existing.weightKg = weightKg;
      if (bodyFat !== undefined) existing.bodyFat = bodyFat;
      if (typeof body.note === 'string') existing.note = body.note;
    } else {
      entries.push({ date, weightKg, bodyFat, note: typeof body.note === 'string' ? body.note : undefined });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    await save(entries);
    res.json({ ok: true, entries });
  });

  app.delete('/api/metrics/local', async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const entries = await loadLocalEntries();
    await save(entries.filter(e => e.date !== date));
    res.json({ ok: true, entries: cache });
  });
}

export function applyLocalMetrics(days: DayDetail[], entries: LocalEntry[]): DayDetail[] {
  const byDate = new Map(entries.map(e => [e.date, e]));
  return days.map(d => {
    const e = byDate.get(d.date);
    if (!e) return d;
    return { ...d, weightKg: e.weightKg ?? null, bodyFatPercent: e.bodyFat ?? null };
  });
}
