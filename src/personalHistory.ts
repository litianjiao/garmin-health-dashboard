// Calendar dates, not local midnight instants: crossing a DST / month boundary must not skip a day.
export function isHistoryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
export const offsetDate = (day: string, offset: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);

export interface HistoryDay { date: string; hrv: number | null; restingHeartRate: number | null }
export interface HabitDay { date:string; lateCaffeine:boolean }
export interface HistoryView {
  status: 'off' | 'no-source' | 'ready';
  date: string;
  canSync: boolean;
  days: HistoryDay[];
  habits?: HabitDay[];
  warning?: string;
}
