import test from 'node:test';
import assert from 'node:assert/strict';
import { demoData } from '../src/demo';
import { makeSummary } from '../src/summary';

test('demo data is explicitly marked and respects the date', () => {
  const data = demoData('2026-01-02');
  assert.equal(data.source, 'demo');
  assert.equal(data.date, '2026-01-02');
  assert.ok(makeSummary(data).includes('演示数据，非真实健康记录'));
});

test('missing metrics stay empty rather than receiving fabricated values', () => {
  const data = demoData();
  data.activity.steps = null;
  data.sleep.score = null;
  assert.match(makeSummary(data), /步数 暂无/);
  assert.match(makeSummary(data), /评分 暂无/);
  assert.doesNotMatch(makeSummary(data), /16,393/);
});
