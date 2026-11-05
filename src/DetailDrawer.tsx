import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { DayDetail, DashboardExtended } from './types';

export type TrendKey = 'steps' | 'sleepHours' | 'hrv' | 'stress' | 'caloriesTotal' | 'caloriesActive' | 'restingHeartRate' | 'sleepScore' | 'sleepDeepMin' | 'sleepRemMin' | 'sleepLightMin' | 'sleepAwakeMin' | 'floors' | 'heartRateMax' | 'stressMax' | 'intensityMinutes' | 'sleepNapMin'
  | 'weightKg' | 'batteryCharged' | 'batteryDrained' | 'batteryHighest' | 'batteryLowest'
  | 'sedentarySec' | 'activeSec' | 'highlyActiveSec' | 'sleepingSec'
  | 'stressRestSec' | 'stressLowSec' | 'stressMediumSec' | 'stressHighSec';

// 秒 → 小时/分钟的换算，让趋势图读数直观
const TREND_SCALE: Partial<Record<TrendKey, number>> = {
  sedentarySec: 1 / 3600, activeSec: 1 / 3600, sleepingSec: 1 / 3600, highlyActiveSec: 1 / 60,
  stressRestSec: 1 / 3600, stressLowSec: 1 / 3600, stressMediumSec: 1 / 3600, stressHighSec: 1 / 3600,
};
const scaleValue = (key: TrendKey, value: number | null) =>
  value === null ? null : Math.round(value * (TREND_SCALE[key] ?? 1) * 100) / 100;
const emptyDay = (date: string): DayDetail => ({
  date, steps: null, stepGoal: null, distanceKm: null, floors: null,
  caloriesResting: null, caloriesActive: null, caloriesTotal: null,
  restingHeartRate: null, heartRateMax: null, stress: null, stressMax: null, hrv: null,
  intensityMinutes: null, intensityGoal: null,
  sleepHours: null, sleepScore: null, sleepDeepMin: null, sleepRemMin: null,
  sleepLightMin: null, sleepAwakeMin: null, sleepNapMin: null,
  sleepSpO2: null, sleepRespiration: null, sleepStart: null, sleepEnd: null,
  sleepAvgHeartRate: null, sleepAvgStress: null, sleepAwakeCount: null, sleepNeedMin: null,
  sleepFeedback: null, sleepRespirationLow: null, sleepRespirationHigh: null, sleepSpO2High: null,
  weightKg: null, bodyFatPercent: null,
  batteryCharged: null, batteryDrained: null, batteryHighest: null, batteryLowest: null,
  batteryAtWakeTime: null, batteryDuringSleep: null,
  sedentarySec: null, activeSec: null, highlyActiveSec: null, sleepingSec: null,
  stressRestSec: null, stressLowSec: null, stressMediumSec: null, stressHighSec: null,
  respirationAvg: null,
});
const fmt = (v: number | null, n = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(n) : '—');
const mean = (values: Array<number | null>, divide = 1) => {
  const list = values.filter((v): v is number => v !== null);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length / divide : null;
};

export interface DetailSpec {
  key: string;
  title: string;
  headline: (t: DashboardExtended) => string;
  unit: string;
  series: TrendKey[];
  labels: Record<string, string>;
  bars?: boolean;
}

export const DETAIL_SPECS: Record<string, DetailSpec> = {
  weight: {
    key: 'weight', title: '体重', unit: 'kg',
    headline: () => '体重记录与变化',
    series: ['weightKg'], labels: { weightKg: '体重 (kg)' },
  },
  battery: {
    key: 'battery', title: '身体电量', unit: '',
    headline: () => '身体电量趋势',
    series: ['batteryHighest', 'batteryLowest', 'batteryCharged', 'batteryDrained'],
    labels: { batteryHighest: '最高', batteryLowest: '最低', batteryCharged: '充能', batteryDrained: '消耗' },
  },
  intensity: {
    key: 'intensity', title: '活动强度', unit: '分钟',
    headline: () => '活动强度趋势',
    series: ['sedentarySec', 'activeSec', 'highlyActiveSec', 'sleepingSec'],
    labels: { sedentarySec: '久坐 (小时)', activeSec: '活动 (小时)', highlyActiveSec: '高强度 (分钟)', sleepingSec: '睡眠 (小时)' },
  },
  stressdist: {
    key: 'stressdist', title: '压力分布', unit: '分钟',
    headline: () => '压力趋势',
    series: ['stress', 'stressMax', 'stressRestSec', 'stressLowSec', 'stressMediumSec', 'stressHighSec'],
    labels: { stress: '平均压力', stressMax: '峰值压力', stressRestSec: '休息 (小时)', stressLowSec: '低 (小时)', stressMediumSec: '中 (小时)', stressHighSec: '高 (小时)' },
  },
  fitness: {
    key: 'fitness', title: '健身年龄', unit: '岁',
    headline: t => `${t.averages.sleepScore ?? '—'}`,
    series: [], labels: {},
  },
  oxygen: {
    key: 'oxygen', title: '血氧', unit: '%',
    headline: t => `7 天睡眠血氧均值见睡眠详情`,
    series: [], labels: {},
  },
  hrv: {
    key: 'hrv', title: 'HRV', unit: 'ms',
    headline: t => `${t.averages.hrv ?? '—'}`,
    series: ['hrv'], labels: { hrv: 'HRV (ms)' },
  },
  sleep: {
    key: 'sleep', title: '睡眠', unit: '小时',
    headline: t => `${t.averages.sleepHours ?? '—'}`,
    series: ['sleepHours', 'sleepDeepMin', 'sleepRemMin', 'sleepLightMin', 'sleepAwakeMin'],
    labels: { sleepHours: '总睡眠 (小时)', sleepDeepMin: '深睡 (分)', sleepRemMin: 'REM (分)', sleepLightMin: '浅睡 (分)', sleepAwakeMin: '清醒 (分)' },
  },
  stress: {
    key: 'stress', title: '压力', unit: '',
    headline: t => `${t.averages.stress ?? '—'}`,
    series: ['stress', 'stressMax'], labels: { stress: '平均压力', stressMax: '峰值压力' },
  },
  activity: {
    key: 'activity', title: '活动', unit: '步',
    headline: t => `${t.averages.steps?.toLocaleString() ?? '—'}`,
    series: ['steps', 'floors', 'intensityMinutes'], labels: { steps: '步数', floors: '爬楼 (层)', intensityMinutes: '强度分钟' },
  },
  calories: {
    key: 'calories', title: '卡路里', unit: 'kcal',
    headline: t => `${t.averages.caloriesTotal ?? '—'}`,
    series: ['caloriesTotal', 'caloriesActive'], labels: { caloriesTotal: '总消耗 (kcal)', caloriesActive: '活动消耗 (kcal)' },
  },
  heart: {
    key: 'heart', title: '心率', unit: 'bpm',
    headline: t => `${t.averages.restingHeartRate ?? '—'}`,
    series: ['restingHeartRate', 'heartRateMax'], labels: { restingHeartRate: '静息心率', heartRateMax: '最高心率' },
  },
};

function TrendChart({ days, fields, labels, bars }: { days: DayDetail[]; fields: TrendKey[]; labels: Record<string, string>; bars?: boolean }) {
  const [active, setActive] = useState(fields[0]);
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(() => days.map(d => scaleValue(active, (d[active] as number | null) ?? null)), [days, active]);
  const valid = values.filter((v): v is number => v !== null);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const range = max - min || 1;
  const w = 640, h = 180, padX = 34, padY = 22;
  const x = (i: number) => padX + (i * (w - padX * 2)) / Math.max(1, days.length - 1);
  const y = (v: number) => h - padY - ((v - min) / range) * (h - padY * 2);
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const barW = Math.max(3, (w - padX * 2) / days.length - 3);
  const hoverValue = hover !== null ? values[hover] : null;
  const hoverDate = hover !== null ? days[hover]?.date : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * w;
    const step = (w - padX * 2) / Math.max(1, days.length - 1);
    const idx = Math.round((svgX - padX) / step);
    setHover(idx >= 0 && idx < days.length ? idx : null);
  };
  return <div className="trend-chart">
    <div className="trend-legend">
      {fields.map(f => <button key={f} className={f === active ? 'on' : ''} onClick={() => setActive(f)}>{labels[f]}</button>)}
    </div>
    <div className="trend-plot">
      <svg viewBox={`0 0 ${w} ${h}`} className="trend-svg" preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(t => <line key={t} x1={padX} x2={w - padX} y1={padY + t * (h - padY * 2)} y2={padY + t * (h - padY * 2)} stroke="#d9ded3" strokeWidth="1" />)}
        {bars
          ? values.map((v, i) => v === null ? null : <rect key={i} x={x(i) - barW / 2} y={y(v)} width={barW} height={h - padY - y(v)} rx="2.5" fill={hover === i ? '#8fa27e' : i === days.length - 1 ? '#a9ba93' : '#c8d4bd'} />)
          : pts.length > 1 ? <>
            <path d={`${line} L ${pts.at(-1)![0]} ${h - padY} L ${pts[0][0]} ${h - padY} Z`} fill="#aebd9c22" />
            <path d={line} fill="none" stroke="#7e936c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </> : null}
        {hover !== null && values[hover] !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={padY - 6} y2={h - padY} stroke="#9daf8b" strokeWidth="1" strokeDasharray="3 3" />
          {!bars && <circle cx={x(hover)} cy={y(values[hover]!)} r="4.5" fill="#fff" stroke="#5f7350" strokeWidth="2.5" />}
        </>}
      </svg>
      {hover !== null && hoverValue !== null && <div className="trend-tooltip" style={{ left: `${x(hover) / w * 100}%` }}>
        <b>{hoverValue.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}{bars ? '' : ''}</b>
        <span>{hoverDate?.slice(5)}</span>
      </div>}
    </div>
    <div className="trend-axis">
      {days.map((d, i) => (days.length > 14 ? i % 5 === 0 : true) ? <span key={d.date}>{d.date.slice(5)}</span> : <span key={d.date} />)}
    </div>
    <div className="trend-range-labels"><span>低 {min.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</span><span>高 {max.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</span></div>
  </div>;
}

export function DetailDrawer({ spec, date, onClose }: { spec: DetailSpec; date: string; onClose: () => void }) {
  const [range, setRange] = useState<7 | 30>(7);
  const [data, setData] = useState<DashboardExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 体重记录稀疏，用后端返回的完整记录（不受 7/30 天窗口截断）
  const weightRows: DayDetail[] = (data?.allWeights ?? []).map(w => ({
    ...emptyDay(w.date), weightKg: w.kg, bodyFatPercent: w.bodyFat,
  }));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(`/api/trends?date=${date}&range=${range}`)
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error || '加载失败'); if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '网络错误'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, range]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const isDemo = date === new Date().toISOString().slice(0, 10) && false;
  return <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="drawer" role="dialog" aria-label={`${spec.title}详情`}>
      <header>
        <div>
          <h2>{spec.title}</h2>
          <span>{data ? `${range} 天 · 截至 ${data.endDate}` : '加载中'}</span>
        </div>
        <div className="drawer-controls">
          <div className="range-toggle">
            <button className={range === 7 ? 'on' : ''} onClick={() => setRange(7)}>7 天</button>
            <button className={range === 30 ? 'on' : ''} onClick={() => setRange(30)}>30 天</button>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="关闭详情"><X size={18} /></button>
        </div>
      </header>
      {loading && <div className="drawer-loading">正在从 Garmin 读取 {range} 天数据…</div>}
      {error && <div className="drawer-error">{error}<button onClick={() => setRange(range)}>重试</button></div>}
      {data && <>
        <div className="drawer-averages">
          {spec.key === 'weight' ? <>
            <div><b>{weightRows.length}</b><span>全部记录次数</span></div>
            <div><b>{fmt(weightRows.at(-1)?.weightKg ?? null)}</b><span>最新体重 (kg)</span></div>
            <div><b>{fmt(weightRows.at(0)?.weightKg ?? null)}</b><span>最早体重 (kg)</span></div>
            {weightRows.length >= 2 && <div><b>{(weightRows.at(-1)!.weightKg! - weightRows.at(0)!.weightKg!).toFixed(1)}</b><span>累计变化 (kg)</span></div>}
          </> : spec.key === 'battery' ? <>
            <div><b>{fmt(mean(data.days.map(d => d.batteryCharged)), 0)}</b><span>日均充能</span></div>
            <div><b>{fmt(mean(data.days.map(d => d.batteryDrained)), 0)}</b><span>日均消耗</span></div>
            <div><b>{fmt(data.days.filter(d => d.batteryLowest !== null).length ? Math.min(...data.days.filter(d => d.batteryLowest !== null).map(d => d.batteryLowest!)) : null, 0)}</b><span>区间最低值</span></div>
            <div><b>{fmt(data.days.filter(d => d.batteryHighest !== null).length ? Math.max(...data.days.filter(d => d.batteryHighest !== null).map(d => d.batteryHighest!)) : null, 0)}</b><span>区间最高值</span></div>
          </> : spec.key === 'intensity' ? <>
            <div><b>{fmt(mean(data.days.map(d => d.sedentarySec), 3600))}</b><span>日均久坐 (小时)</span></div>
            <div><b>{fmt(mean(data.days.map(d => d.activeSec), 60))}</b><span>日均活动 (分钟)</span></div>
            <div><b>{fmt(mean(data.days.map(d => d.highlyActiveSec), 60))}</b><span>日均高强度 (分钟)</span></div>
          </> : spec.key === 'stressdist' ? <>
            <div><b>{data.averages.stress ?? '—'}</b><span>平均压力</span></div>
            <div><b>{fmt(mean(data.days.map(d => d.stressRestSec), 3600))}</b><span>日均休息 (小时)</span></div>
            <div><b>{fmt(mean(data.days.map(d => d.stressHighSec), 60))}</b><span>日均高压 (分钟)</span></div>
          </> : spec.key === 'sleep' ? <>
            <div><b>{data.averages.sleepHours ?? '—'}</b><span>平均睡眠 (小时)</span></div>
            <div><b>{data.averages.sleepScore ?? '—'}</b><span>平均评分</span></div>
            <div><b>{data.averages.deepMin !== null ? (data.averages.deepMin / 60).toFixed(1) : '—'}</b><span>平均深睡 (小时)</span></div>
            <div><b>{data.averages.remMin !== null ? (data.averages.remMin / 60).toFixed(1) : '—'}</b><span>平均 REM (小时)</span></div>
            <div><b>{data.averages.lightMin !== null ? (data.averages.lightMin / 60).toFixed(1) : '—'}</b><span>平均浅睡 (小时)</span></div>
            <div><b>{data.averages.awakeMin !== null ? (data.averages.awakeMin / 60).toFixed(1) : '—'}</b><span>平均清醒 (小时)</span></div>
          </> : spec.key === 'activity' ? <>
            <div><b>{data.averages.steps?.toLocaleString() ?? '—'}</b><span>平均步数</span></div>
            <div><b>{data.averages.floors ?? '—'}</b><span>平均爬楼 (层)</span></div>
          </> : spec.key === 'hrv' ? <div><b>{data.averages.hrv ?? '—'}</b><span>平均 HRV (ms)</span></div>
          : spec.key === 'stress' ? <div><b>{data.averages.stress ?? '—'}</b><span>平均压力</span></div>
          : spec.key === 'calories' ? <>
            <div><b>{data.averages.caloriesTotal ?? '—'}</b><span>日均总消耗 (kcal)</span></div>
            <div><b>{data.averages.caloriesActive ?? '—'}</b><span>日均活动消耗 (kcal)</span></div>
          </> : spec.key === 'heart' ? <div><b>{data.averages.restingHeartRate ?? '—'}</b><span>平均静息心率 (bpm)</span></div>
          : null}
        </div>
        {spec.series.length > 0 && <TrendChart
          days={spec.key === 'weight' ? weightRows : data.days}
          fields={spec.series} labels={spec.labels} bars={spec.bars} />}
        {spec.key === 'weight' && weightRows.length > 0 && <div className="drawer-hint">体重记录间隔较长，这里显示的是全部 {weightRows.length} 条记录（不受 {range} 天窗口限制）。</div>}
        {spec.series.length > 0 && spec.key !== 'weight' && !data.days.some(d => spec.series.some(f => (d[f] as number | null) !== null)) && <div className="drawer-hint">这个区间内该指标没有数据。</div>}
        {spec.key === 'weight' && !weightRows.length && <div className="drawer-hint">没有体重记录。可在「自定义卡片」面板顶部手动填写，或用 Garmin 体脂秤同步。</div>}
        {spec.key === 'sleep' && <div className="drawer-hint timeline-note">Garmin 官方 Personal API 未提供逐分钟的睡眠阶段时间线数据（App 内的睡眠时间线图来自私有接口），因此这里以官方返回的阶段总量与夜间指标呈现。每晚会列出时长、评分、阶段分布与心率/血氧/呼吸范围。</div>}
        {spec.key === 'sleep' && <SleepNightDetails days={data.days} />}
        {spec.key === 'sleep' && <SleepStagesTable days={data.days} />}
        {spec.key !== 'sleep' && spec.series.length > 0 && <DayTable
          days={spec.key === 'weight' ? weightRows : data.days}
          fields={spec.series} labels={spec.labels} unit={spec.unit} />}
        {(spec.key === 'fitness' || spec.key === 'oxygen') && <div className="drawer-hint">此指标的详细趋势由当日卡片直接展示；睡眠期间的血氧与呼吸数据可在「睡眠」详情中查看。</div>}
      </>}
    </aside>
  </div>;
}

const FEEDBACK_TEXT: Record<string, string> = {
  POSITIVE_RECOVERING: '正向恢复中',
  POSITIVE: '正向',
  NEUTRAL: '一般',
  NEGATIVE: '需要关注',
};
function SleepNightDetails({ days }: { days: DayDetail[] }) {
  const rows = days.filter(d => d.sleepHours !== null).slice().reverse();
  if (!rows.length) return null;
  return <div className="night-grid">
    {rows.slice(0, 7).map(d => <div className="night-card" key={d.date}>
      <div className="night-head"><b>{d.date === data_currentDate() ? '今晚' : d.date.slice(5)}</b><span>{FEEDBACK_TEXT[d.sleepFeedback || ''] || ''}</span></div>
      <div className="night-metrics">
        <div><i>时长</i><b>{d.sleepHours?.toFixed(1) ?? '—'} 小时{d.sleepNeedMin !== null ? ` / 需求 ${Math.round(d.sleepNeedMin / 60 * 10) / 10} 小时` : ''}</b></div>
        <div><i>夜间平均心率</i><b>{d.sleepAvgHeartRate !== null ? `${d.sleepAvgHeartRate} bpm` : '—'}</b></div>
        <div><i>睡眠压力</i><b>{d.sleepAvgStress ?? '—'}</b></div>
        <div><i>醒来次数</i><b>{d.sleepAwakeCount !== null ? `${d.sleepAwakeCount} 次` : '—'}</b></div>
        <div><i>呼吸范围</i><b>{d.sleepRespirationLow !== null ? `${d.sleepRespirationLow}–${d.sleepRespirationHigh ?? '—'} rpm` : '—'}</b></div>
        <div><i>血氧范围</i><b>{d.sleepSpO2 !== null ? `${d.sleepSpO2}–${d.sleepSpO2High ?? '—'}%` : '—'}</b></div>
      </div>
    </div>)}
  </div>;
}
function data_currentDate() { return new Date().toISOString().slice(0, 10); }
function SleepStagesTable({ days }: { days: DayDetail[] }) {
  const rows = days.filter(d => d.sleepHours !== null).slice().reverse();
  if (!rows.length) return <div className="drawer-hint">这个区间内没有睡眠记录。</div>;
  return <div className="day-table-wrap">
    <table className="day-table">
      <thead><tr><th>日期</th><th>起止</th><th>时长 (小时)</th><th>评分</th><th>深睡</th><th>REM</th><th>浅睡</th><th>清醒</th><th>小睡</th><th>血氧</th><th>呼吸</th></tr></thead>
      <tbody>{rows.map(d => <tr key={d.date}>
        <td>{d.date.slice(5)}</td>
        <td>{d.sleepStart ?? '—'}–{d.sleepEnd ?? '—'}</td>
        <td>{d.sleepHours !== null ? d.sleepHours.toFixed(1) : '—'}</td>
        <td>{d.sleepScore ?? '—'}</td>
        <td className="stage-deep">{d.sleepDeepMin ?? '—'}</td>
        <td className="stage-rem">{d.sleepRemMin ?? '—'}</td>
        <td className="stage-light">{d.sleepLightMin ?? '—'}</td>
        <td>{d.sleepAwakeMin ?? '—'}</td>
        <td>{d.sleepNapMin ?? '—'}</td>
        <td>{d.sleepSpO2 ?? '—'}%</td>
        <td>{d.sleepRespiration ?? '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function DayTable({ days, fields, labels, unit }: { days: DayDetail[]; fields: TrendKey[]; labels: Record<string, string>; unit: string }) {
  const rows = days.slice().reverse();
  return <div className="day-table-wrap">
    <table className="day-table">
      <thead><tr><th>日期</th>{fields.map(f => <th key={f}>{labels[f]}</th>)}</tr></thead>
      <tbody>{rows.map(d => <tr key={d.date}>
        <td>{d.date.slice(5)}</td>
        {fields.map(f => { const sv = scaleValue(f, (d[f] as number | null) ?? null); return <td key={f}>{sv === null ? '—' : sv.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}
