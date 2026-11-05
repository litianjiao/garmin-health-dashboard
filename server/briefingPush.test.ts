import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoData } from '../src/demo';

test('only real, nonempty, previous-day briefings qualify for mobile delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(),'moru-brief-')), old = process.cwd();
  const ai = process.env.AI_BASE_URL;
  try {
    process.chdir(dir); process.env.AI_BASE_URL = '';
    const {generateBriefing,phoneBriefingDate} = await import('./briefing');
    const dateString = (d:Date) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    const today = new Date(), prev = new Date(today); prev.setDate(prev.getDate()-1);
    const date = dateString(prev), data = demoData(date);
    const fetcher = async (requested:string) => { assert.equal(requested,date); return {day:data,trends:null,pmcRows:null}; };
    await generateBriefing(date,fetcher,true); assert.equal(await phoneBriefingDate(),null);
    data.source = 'garmin';
    const empty = {...data, hrv:{...data.hrv,lastNight:null}, restingHeartRate:null, sleep:{...data.sleep,hours:null},
      activity:{...data.activity,steps:null},bodyBattery:null,stress:{...data.stress,average:null},spo2:{...data.spo2,latest:null}};
    await assert.rejects(generateBriefing(date,async()=>({day:empty,trends:null,pmcRows:null}),true),/没有足够/);
    await generateBriefing(date,fetcher,true); assert.equal(await phoneBriefingDate(),dateString(today));
  } finally {
    process.chdir(old); if(ai === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL=ai;
    await rm(dir,{recursive:true,force:true});
  }
});
