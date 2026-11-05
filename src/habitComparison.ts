import { offsetDate, type HabitDay, type HistoryDay } from './personalHistory';
export const MIN_GROUP = 7, HABIT_WINDOW = 56;
const median = (a:number[]) => {
  a.sort((x,y)=>x-y); const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
};
// Pair a deliberately logged evening with the NEXT calendar day's observation. No entry is not "no".
export function habitContrast(days:HistoryDay[], habits:HabitDay[], asOf:string, field:'hrv'|'restingHeartRate') {
  const from = offsetDate(asOf,-HABIT_WINDOW);
  const values = new Map(days.map(d=>[d.date,d[field]])), yes:number[]=[], no:number[]=[];
  for (const [date,flag] of new Map(habits.map(h=>[h.date,h.lateCaffeine]))) {
    if (date<from || date>=asOf) continue;
    const v = values.get(offsetDate(date,1));
    if (typeof v === 'number' && Number.isFinite(v) && v>0) (flag?yes:no).push(v);
  }
  const ready = yes.length>=MIN_GROUP && no.length>=MIN_GROUP;
  return {yesCount:yes.length,noCount:no.length, yes:ready?median(yes):null, no:ready?median(no):null};
}
