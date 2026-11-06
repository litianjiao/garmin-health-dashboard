import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { openHealthHistory, registerHistoryRouter } from './history';
import { demoData } from '../src/demo';
import { isHistoryDate, offsetDate, type HistoryDay } from '../src/personalHistory';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
test('no opt-in or no real source never touches storage', async () => {
  assert.equal(await openHealthHistory('', 'official:test'), null);
  assert.equal(await openHealthHistory('unused', null), null);
  assert.equal(isHistoryDate('2024-02-29'), true);
  assert.equal(isHistoryDate('2025-02-29'), false);
  assert.equal(offsetDate('2024-03-01', -1), '2024-02-29');
});
test('real observations survive restart; partial syncs, demo and other accounts cannot overwrite them', { skip: !hasSqlite }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moru-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = (await openHealthHistory(dir, 'mcp:person-a'))!;
  const day = demoData('2024-02-29');
  a.recordDay(day);
  assert.deepEqual(a.read('2024-01-01', day.date), []);
  day.source = 'garmin'; day.hrv.lastNight = 55; day.restingHeartRate = 51;
  a.recordDay(day); a.recordDay(day);
  a.upsert([{ date: day.date, hrv: 60, restingHeartRate: null },
    { date: '2024-02-28', hrv: null, restingHeartRate: 0 }, { date: '2024-03-01', hrv: 99, restingHeartRate: 70 }]);
  a.close();
  const reopened = (await openHealthHistory(dir, 'mcp:person-a'))!;
  try { assert.deepEqual(reopened.read('2024-02-01', day.date), [{date: day.date, hrv: 60, restingHeartRate: 51}]); }
  finally { reopened.close(); }
  const b = (await openHealthHistory(dir, 'mcp:person-b'))!;
  try { assert.deepEqual(b.read('2024-01-01','2024-03-01'), []); } finally { b.close(); }
  assert.ok((await readdir(dir)).every(name => !name.includes('person-')));
});
test('backfill imports only the requested window and preserves history on upstream failure', { skip: !hasSqlite }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moru-history-'));
  const store = (await openHealthHistory(dir, 'official:fixture'))!;
  const app = express(); app.use(express.json());
  let offline = false;
  registerHistoryRouter(app, store, true, async () => {
    if (offline) throw new Error('fixture offline');
    return ['2024-01-30','2024-01-31','2024-02-29','2024-03-01'].map(date => ({date, hrv: 60, restingHeartRate: null}));
  }, () => undefined);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const addr = server.address(); assert.ok(addr && typeof addr === 'object');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(dir,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${addr.port}/api/history`;
  const sync = () => fetch(base+'/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date:'2024-02-29'}) });
  assert.equal((await fetch(base+'?date=2024-02-30')).status, 400);
  assert.equal((await (await sync()).json()).validDays, 2);
  offline = true;
  assert.equal((await sync()).status,503);
  const view = await (await fetch(base+'?date=2024-02-29')).json();
  assert.equal(view.canSync,true);
  assert.deepEqual(view.days.map((r: HistoryDay) => r.date), ['2024-01-31','2024-02-29']);
});
