import { offsetDate, type HistoryDay } from './personalHistory';

export const WINDOW_DAYS = 28, MIN_DAYS = 21;
type Position = 'missing' | 'learning' | 'below' | 'within' | 'above';
export interface Comparison {
  current: number | null; count: number; median: number | null; low: number | null; high: number | null; position: Position;
}
function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i);
  return Number((sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo)).toFixed(8));
}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
export function compareMetric(rows: HistoryDay[], date: string, field: 'hrv' | 'restingHeartRate'): Comparison {
  const from = offsetDate(date, -WINDOW_DAYS);
  const unique = new Map(rows.map(row => [row.date, row[field]]));
  const values = [...unique].filter(([d, v]) => d >= from && d < date && valid(v))
    .map(([,v]) => v!).sort((a,b) => a-b);
  const today = unique.get(date), current = valid(today) ? today : null;
  const count = values.length;
  if (count < MIN_DAYS) return { current, count, median: null, low: null, high: null, position: current === null ? 'missing' : 'learning' };
  const low = quantile(values, .1), high = quantile(values, .9), median = quantile(values, .5);
  return { current, count, median, low, high, position: current === null ? 'missing' : current < low ? 'below' : current > high ? 'above' : 'within' };
}
export function dailyHint(hrv: Comparison, heart: Comparison): string {
  if (hrv.position === 'missing' || heart.position === 'missing') return '当天至少一项没有读数。可先确认手表已同步，不用另一项替它下结论。';
  if (hrv.position === 'learning' || heart.position === 'learning') return '可补同步最近 30 天，或继续积累记录；样本不够，暂不判断偏离。';
  if (hrv.position === 'below' && heart.position === 'above') return 'HRV 低于你近期区间，静息心率高于区间。先回看昨晚睡眠、近期活动和自己的感受，不凭一次读数调整训练。';
  if (hrv.position === 'within' && heart.position === 'within') return '两项都在你近期常见区间内。保留今天的记录，看接下来几天是否仍然相近。';
  return '有读数落在你近期常见区间以外。可记下当天背景，等后续几天的数据再比较；单日差异不等于异常。';
}
