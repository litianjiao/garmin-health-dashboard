import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMetric, dailyHint } from '../src/baseline';
import { offsetDate, type HistoryDay } from '../src/personalHistory';

const day = '2024-03-01';
const history = (n: number): HistoryDay[] => Array.from({length:n},(_,i)=>({
  date:offsetDate(day,-i-1), hrv:50, restingHeartRate:56,
}));
test('21 distinct previous days qualify; selected day, future and older rows cannot leak into the window', () => {
  const rows = history(21);
  rows.push({...rows[0]}, {date:day, hrv:40, restingHeartRate:65},
    {date:offsetDate(day,-29),hrv:999,restingHeartRate:1}, {date:offsetDate(day,1),hrv:999,restingHeartRate:1});
  const hrv = compareMetric(rows,day,'hrv'), heart = compareMetric(rows,day,'restingHeartRate');
  assert.deepEqual([hrv.count,hrv.median,hrv.low,hrv.high,hrv.position],[21,50,50,50,'below']);
  assert.equal(heart.position,'above'); assert.match(dailyHint(hrv,heart),/不凭一次读数/);
});
test('missing metrics never become zero or borrow samples from the other metric', () => {
  const rows = history(21); rows[0].hrv = null;
  rows.push({date:day,hrv:50,restingHeartRate:null});
  const hrv = compareMetric(rows,day,'hrv'), heart = compareMetric(rows,day,'restingHeartRate');
  assert.equal(hrv.position,'learning'); assert.equal(hrv.median,null); assert.equal(hrv.count,20);
  assert.equal(heart.position,'missing'); assert.equal(heart.count,21); assert.match(dailyHint(hrv,heart),/没有读数/);
});
test('percentiles interpolate and equal boundaries remain in range', () => {
  const rows = history(22); rows.forEach((r,i)=>{ r.hrv=40+i; });
  rows.push({date:day,hrv:42.1,restingHeartRate:56});
  const v = compareMetric(rows,day,'hrv');
  assert.equal(v.low,42.1); assert.equal(v.high,58.9); assert.equal(v.median,50.5); assert.equal(v.position,'within');
});
