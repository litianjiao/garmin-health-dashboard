import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { isHistoryDate, offsetDate, type HabitDay, type HistoryDay, type HistoryView } from '../src/personalHistory';
import type { DashboardData } from '../src/types';

const positive = (n: number | null) => n !== null && Number.isFinite(n) && n > 0 ? n : null;

export class HealthHistory {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS daily_metrics (
      date TEXT PRIMARY KEY, hrv REAL, restingHeartRate REAL
    ) STRICT`);
    db.exec('CREATE TABLE IF NOT EXISTS habit_log (date TEXT PRIMARY KEY, lateCaffeine INTEGER NOT NULL CHECK(lateCaffeine IN (0,1))) STRICT');
  }
  recordDay(data: DashboardData) {
    if (data.source === 'garmin') this.upsert([{ date: data.date, hrv: data.hrv.lastNight, restingHeartRate: data.restingHeartRate }]);
  }
  upsert(rows: HistoryDay[]): number {
    const put = this.db.prepare(`INSERT INTO daily_metrics(date, hrv, restingHeartRate) VALUES (?,?,?)
      ON CONFLICT(date) DO UPDATE SET hrv=coalesce(excluded.hrv,daily_metrics.hrv),
      restingHeartRate=coalesce(excluded.restingHeartRate,daily_metrics.restingHeartRate)`);
    this.db.exec('BEGIN');
    try {
      let count = 0;
      for (const row of rows) {
        const hrv = positive(row.hrv), rhr = positive(row.restingHeartRate);
        if (!isHistoryDate(row.date) || (hrv === null && rhr === null)) continue;
        put.run(row.date, hrv, rhr); count++;
      }
      this.db.exec('COMMIT');
      return count; // Days containing an observation, not necessarily new rows.
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  read(from: string, to: string): HistoryDay[] {
    return this.db.prepare('SELECT date, hrv, restingHeartRate FROM daily_metrics WHERE date BETWEEN ? AND ? ORDER BY date')
      .all(from, to).map(r => ({ date: String(r.date), hrv: r.hrv as number | null, restingHeartRate: r.restingHeartRate as number | null }));
  }
  recordHabit(date:string, flag:boolean|null) {
    if (flag === null) this.db.prepare('DELETE FROM habit_log WHERE date=?').run(date);
    else this.db.prepare('INSERT INTO habit_log(date,lateCaffeine) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET lateCaffeine=excluded.lateCaffeine')
      .run(date, flag ? 1 : 0);
  }
  readHabits(from:string, to:string): HabitDay[] {
    return this.db.prepare('SELECT date,lateCaffeine FROM habit_log WHERE date BETWEEN ? AND ? ORDER BY date')
      .all(from,to).map(r => ({date:String(r.date), lateCaffeine:r.lateCaffeine===1}));
  }
  close() { this.db.close(); }
}

// No directory, database or SQLite import unless a user explicitly opts in with a real data source.
export async function openHealthHistory(dir: string, account: string | null): Promise<HealthHistory | null> {
  if (!dir.trim() || !account) return null;
  const { DatabaseSync } = await import('node:sqlite').catch(() => {
    throw new Error('启用 HEALTH_HISTORY_DIR 需要含 node:sqlite 的 Node.js 22.13 或更新版本');
  });
  const root = resolve(dir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // Scope data to the active identity, not just the installation. Never persist the key or username.
  const id = createHash('sha256').update('moru-history-v1\0' + account).digest('hex').slice(0, 32);
  const file = join(root, `history-${id}.sqlite`);
  closeSync(openSync(file, 'a', 0o600));
  return new HealthHistory(new DatabaseSync(file));
}

export function registerHistoryRouter(app: Express, store: HealthHistory | null, optIn: boolean,
  fetchRange: ((end: string) => Promise<HistoryDay[]>) | null, warning: () => string | undefined) {
  app.get('/api/history', (req, res) => {
    const date = req.query.date;
    if (!isHistoryDate(date)) return res.status(400).json({ error: '请选择有效的日历日期' });
    const view: HistoryView = { status: store ? 'ready' : optIn ? 'no-source' : 'off', date,
      canSync: Boolean(store && fetchRange), days: store?.read(offsetDate(date, -89), date) ?? [],
      habits: store?.readHabits(offsetDate(date,-56),date) ?? [], warning: warning() };
    res.set('Cache-Control', 'no-store').json(view);
  });
  app.put('/api/history/habits/:date', (req,res) => {
    const date = req.params.date, flag = req.body?.lateCaffeine;
    if (!isHistoryDate(date) || (flag !== null && typeof flag !== 'boolean')) return res.status(400).json({error:'请选择有效日期，并明确指定有 / 无 / 未记录'});
    if (!store) return res.status(409).json({error:'请先开启本机真实数据历史'});
    try { store.recordHabit(date,flag); res.sendStatus(204); }
    catch { res.status(503).json({error:'习惯记录未保存，请检查本机存储'}); }
  });
  app.post('/api/history/sync', async (req, res) => {
    const date = req.body?.date;
    if (!isHistoryDate(date)) return res.status(400).json({ error: '请选择有效的日历日期' });
    if (!store || !fetchRange) return res.status(409).json({ error: '补历史需开启 SQLite 并配置官方 Garmin 数据源' });
    try {
      const from = offsetDate(date, -29);
      const rows = (await fetchRange(date)).filter(r => r.date >= from && r.date <= date);
      res.set('Cache-Control', 'no-store').json({ date, from, validDays: store.upsert(rows) });
    } catch {
      res.status(503).json({ error: '同步失败；请检查 Garmin 连接及本地目录权限。已有历史保留。' });
    }
  });
}
