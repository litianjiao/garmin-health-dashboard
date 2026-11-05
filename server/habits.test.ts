import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthHistory } from './history';
import { habitContrast } from '../src/habitComparison';
import { offsetDate, type HistoryDay, type HabitDay } from '../src/personalHistory';
const sqlite = await import('node:sqlite').catch(()=>null);
const asOf = '2024-03-01';
test('lag by one day, include only observed pairs, and never turn missing logs into no', () => {
  const days:HistoryDay[]=[], habits:HabitDay[]=[];
  for (let i=1;i<=14;i++) {
    const date=offsetDate(asOf,-i), yes=i%2===1;
    habits.push({date,lateCaffeine:yes});
    days.push({date:offsetDate(date,1),hrv:yes?40:60,restingHeartRate:i===1?null:(yes?65:55)});
  }
  // Unlabelled outcomes, and an exposure on the as-of date with a *future* reading, must not enter either group.
  days.push({date:offsetDate(asOf,-20),hrv:900,restingHeartRate:999});
  habits.push({date:asOf,lateCaffeine:true}); days.push({date:offsetDate(asOf,1),hrv:999,restingHeartRate:999});
  assert.deepEqual(habitContrast(days,habits,asOf,'hrv'),{yesCount:7,noCount:7,yes:40,no:60});
  assert.deepEqual(habitContrast(days,habits,asOf,'restingHeartRate'),{yesCount:6,noCount:7,yes:null,no:null});
});
test('an explicit no persists and clearing the flag returns it to unknown', {skip:!sqlite}, () => {
  const s=new HealthHistory(new sqlite!.DatabaseSync(':memory:'));
  try {
    s.recordHabit(asOf,false); assert.deepEqual(s.readHabits(asOf,asOf),[{date:asOf,lateCaffeine:false}]);
    s.recordHabit(asOf,true); assert.deepEqual(s.readHabits(asOf,asOf),[{date:asOf,lateCaffeine:true}]);
    s.recordHabit(asOf,null); assert.deepEqual(s.readHabits(asOf,asOf),[]);
  } finally { s.close(); }
});
