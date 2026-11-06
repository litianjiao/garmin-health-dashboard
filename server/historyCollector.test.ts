import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the history collector requests two date ranges and keeps each source separate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moru-collector-')), cwd = process.cwd();
  const oldBase = process.env.GARMIN_API_BASE, oldKey = process.env.GARMIN_API_KEY;
  const calls: string[] = [];
  const fake = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    if (req.method === 'POST') return void res.end(auth.endsWith('A') ? 'token-A' : 'token-B');
    calls.push(req.url!); res.setHeader('Content-Type', 'application/json');
    if (req.url?.includes('/hrv/daily/')) res.end(JSON.stringify({hrvSummaries: [
      {calendarDate: '2024-02-28', lastNightAvg: auth === 'Bearer token-A' ? 47 : 61},
      {calendarDate: '2024-03-01', lastNightAvg: 99},
    ]}));
    else res.end(JSON.stringify({data: [{calendarDate:'2024-02-29',heartRate:{restingValue:54}}]}));
  });
  try {
    process.chdir(root); fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
    const address = fake.address(); assert.ok(address && typeof address === 'object');
    process.env.GARMIN_API_BASE = `http://127.0.0.1:${address.port}`;
    const {GarminOfficialApi} = await import('./garminOfficial');
    for (const [key, expected] of [['A',47],['B',61]] as const) {
      process.env.GARMIN_API_KEY = key;
      const rows = await new GarminOfficialApi(false).personalHistory('2024-02-29');
      assert.deepEqual(rows, [
        {date:'2024-02-28',hrv:expected,restingHeartRate:null},
        {date:'2024-02-29',hrv:null,restingHeartRate:54},
      ]);
    }
    assert.equal(calls.length,4);
    assert.ok(calls.every(path=>path.includes('2024-01-31') && path.includes('2024-02-29')));
    assert.deepEqual(await readdir(root),[]);
  } finally {
    await new Promise<void>(done=>fake.close(()=>done()));
    process.chdir(cwd);
    if (oldBase===undefined) delete process.env.GARMIN_API_BASE; else process.env.GARMIN_API_BASE=oldBase;
    if (oldKey===undefined) delete process.env.GARMIN_API_KEY; else process.env.GARMIN_API_KEY=oldKey;
    await rm(root,{recursive:true,force:true});
  }
});
