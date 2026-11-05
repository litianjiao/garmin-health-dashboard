import type { DashboardExtended, DayDetail } from '../src/types';
import { GarminOfficialApi } from './garminOfficial';

export interface PmcRow {
  date: string;
  load: number | null;
  ctl: number;
  atl: number;
  tsb: number;
  weight: number | null;
  bodyFat: number | null;
  projected: boolean;
}

export interface PmcData {
  endDate: string;
  hasLoad: boolean;
  rows: PmcRow[];
  latest: { ctl: number | null; atl: number | null; tsb: number | null; zone: string | null; ramp: number | null };
}

// 与 APK assets/training/load.js 中的常数一致：CTL 42 天、ATL 7 天指数衰减
const KC = Math.exp(-1 / 42);
const KA = Math.exp(-1 / 7);

const ZONES: Array<{ key: string; lo: number; hi: number; color: string }> = [
  { key: '休息较多', lo: 25, hi: Infinity, color: '#b7791f' },
  { key: '恢复较好', lo: 5, hi: 25, color: '#2563eb' },
  { key: '负荷平衡', lo: -10, hi: 5, color: '#64748b' },
  { key: '训练积累', lo: -30, hi: -10, color: '#15983f' },
  { key: '疲劳偏高', lo: -Infinity, hi: -30, color: '#dc2626' },
];
const zoneOf = (tsb: number, ctl: number) => {
  if (!Number.isFinite(tsb) || !Number.isFinite(ctl) || ctl < 8) return null;
  const p = (tsb / ctl) * 100;
  return ZONES.find(z => p >= z.lo && p < z.hi) ?? ZONES[2];
};

export class PmcService {
  constructor(private api: GarminOfficialApi) {}

  async compute(endDate: string, days: number, projectDays = 14): Promise<PmcData> {
    const start = new Date(`${endDate}T12:00:00`);
    start.setDate(start.getDate() - (days - 1));
    const startDate = start.toISOString().slice(0, 10);

    const activities = await this.api.getActivities(startDate, endDate);
    const weight = await this.api.getWeight(endDate, Math.max(days, 182));

    // 按本地日期累加每日训练负荷
    const loadByDate = new Map<string, number>();
    for (const activity of activities) {
      const day = (typeof activity.startTimeLocal === 'string' ? activity.startTimeLocal : '').slice(0, 10);
      if (!day) continue;
      const load = typeof activity.activityTrainingLoad === 'number' ? activity.activityTrainingLoad : null;
      if (load !== null) loadByDate.set(day, (loadByDate.get(day) ?? 0) + load);
    }
    const weightByDate = new Map<string, { kg: number; bodyFat: number | null }>();
    for (const raw of asObjectArray(weight.dailyWeightSummaries)) {
      const d = raw as Record<string, unknown>;
      const lw = asRecord(d.latestWeight);
      const day = typeof lw.calendarDate === 'string' ? lw.calendarDate : (typeof d.summaryDate === 'string' ? d.summaryDate : null);
      const grams = typeof lw.weight === 'number' ? lw.weight : null;
      if (day && grams !== null) weightByDate.set(day, { kg: Math.round(grams / 100) / 10, bodyFat: typeof lw.bodyFat === 'number' ? lw.bodyFat : null });
    }

    const rows: PmcRow[] = [];
    let ctl = 0, atl = 0;
    let seenLoad = false;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(`${endDate}T12:00:00`);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const rawLoad = loadByDate.get(date) ?? null;
      const load = rawLoad !== null ? Math.round(rawLoad * 10) / 10 : 0;
      if (rawLoad !== null) seenLoad = true;
      ctl = ctl * KC + load * (1 - KC);
      atl = atl * KA + load * (1 - KA);
      const w = weightByDate.get(date) ?? null;
      rows.push({ date, load: rawLoad, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10, weight: w?.kg ?? null, bodyFat: w?.bodyFat ?? null, projected: false });
    }

    // 预测：后续无新负荷时的衰减轨迹
    if (seenLoad && projectDays > 0) {
      let c = ctl, a = atl;
      let last = rows.at(-1)!.date;
      for (let i = 0; i < projectDays; i++) {
        const next = new Date(`${last}T12:00:00`);
        next.setDate(next.getDate() + 1);
        const date = next.toISOString().slice(0, 10);
        c = c * KC;
        a = a * KA;
        rows.push({ date, load: null, ctl: Math.round(c * 10) / 10, atl: Math.round(a * 10) / 10, tsb: Math.round((c - a) * 10) / 10, weight: null, bodyFat: null, projected: true });
        last = date;
      }
    }

    const actualRows = rows.filter(r => !r.projected);
    const last = actualRows.at(-1) ?? null;
    const weekAgo = actualRows.at(-8) ?? actualRows[0] ?? null;
    const ramp = last && weekAgo ? Math.round((last.ctl - weekAgo.ctl) * 10) / 10 : null;
    return {
      endDate,
      hasLoad: seenLoad,
      rows,
      latest: {
        ctl: last?.ctl ?? null,
        atl: last?.atl ?? null,
        tsb: last?.tsb ?? null,
        zone: last ? zoneOf(last.tsb, last.ctl)?.key ?? null : null,
        ramp,
      },
    };
  }
}

const asObjectArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
export const PMC_ZONES = ZONES;
export type { DashboardExtended };
