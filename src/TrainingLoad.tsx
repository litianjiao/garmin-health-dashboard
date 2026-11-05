import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';

interface PmcRow { date: string; load: number | null; ctl: number; atl: number; tsb: number; weight: number | null; bodyFat: number | null; projected: boolean }
interface PmcData { endDate: string; hasLoad: boolean; rows: PmcRow[]; latest: { ctl: number | null; atl: number | null; tsb: number | null; zone: string | null; ramp: number | null } }

const KC = Math.exp(-1 / 42);
const KA = Math.exp(-1 / 7);
const ZONES = [
  { key: '休息较多', lo: 25, hi: Infinity, color: '#b7791f' },
  { key: '恢复较好', lo: 5, hi: 25, color: '#2563eb' },
  { key: '负荷平衡', lo: -10, hi: 5, color: '#64748b' },
  { key: '训练积累', lo: -30, hi: -10, color: '#15983f' },
  { key: '疲劳偏高', lo: -Infinity, hi: -30, color: '#dc2626' },
];
const zoneOf = (tsb: number, ctl: number) => {
  if (!Number.isFinite(tsb) || !Number.isFinite(ctl) || ctl < 8) return null;
  const p = (tsb / ctl) * 100;
  return ZONES.find(z => p >= z.lo && p < z.hi) ?? ZONES[2];
};
const fmt = (v: number | null, n = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(n) : '—');
const md = (s: string) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

function smooth(points: Array<[number, number]>): string {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) return `M${points[0][0]} ${points[0][1]}L${points[1][0]} ${points[1][1]}`;
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; m[i] = (points[i + 1][1] - points[i][1]) / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  void KC; void KA;
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(points[i][0] + h).toFixed(1)} ${(points[i][1] + t[i] * h).toFixed(1)} ${(points[i + 1][0] - h).toFixed(1)} ${(points[i + 1][1] - t[i + 1] * h).toFixed(1)} ${points[i + 1][0].toFixed(1)} ${points[i + 1][1].toFixed(1)}`;
  }
  return d;
}

function Chart({ rows, series, height = 220, bands, tsbZones }: { rows: PmcRow[]; series: Array<{ key: 'ctl' | 'atl' | 'tsb'; color: string; label: string }>; height?: number; bands?: boolean; tsbZones?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720, h = height, padL = 40, padR = 16, padT = 16, padB = 28;
  const values = series.flatMap(s => rows.map(r => r[s.key] as number));
  const dataMin = Math.min(...values, 0), dataMax = Math.max(...values, 1);
  const min = tsbZones ? Math.min(dataMin, -35) : dataMin;
  const max = tsbZones ? Math.max(dataMax, 32) : dataMax;
  const range = max - min || 1;
  const x = (i: number) => padL + (i * (w - padL - padR)) / Math.max(1, rows.length - 1);
  const y = (v: number) => h - padB - ((v - min) / range) * (h - padT - padB);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * w;
    const step = (w - padL - padR) / Math.max(1, rows.length - 1);
    const idx = Math.round((svgX - padL) / step);
    setHover(idx >= 0 && idx < rows.length ? idx : null);
  };
  const hoverRow = hover !== null ? rows[hover] : null;
  return <div className="pmc-plot">
    <svg viewBox={`0 0 ${w} ${h}`} className="pmc-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {[0, 0.5, 1].map(k => <line key={k} x1={padL} x2={w - padR} y1={padT + k * (h - padT - padB)} y2={padT + k * (h - padT - padB)} stroke="#e2e6dd" strokeWidth="1" />)}
      {tsbZones && rows.length > 0 && ZONES.map(z => {
        const zLo = Math.max(z.lo, min), zHi = Math.min(z.hi === Infinity ? max : z.hi, max);
        if (zLo >= zHi) return null;
        const top = y(zHi), bottom = y(zLo);
        const lastActual = rows.findIndex(r => r.projected);
        const width = (lastActual > 0 ? x(lastActual - 1) : w - padR) - padL;
        return <g key={z.key}>
          <rect x={padL} y={top} width={width} height={Math.max(0, bottom - top)} fill={z.color} opacity=".13" />
          {z.lo > min && z.lo > -1e8 && <line x1={padL} x2={padL + width} y1={y(z.lo)} y2={y(z.lo)} stroke={z.color} strokeWidth="1" strokeDasharray="4 4" opacity=".6" />}
          <text x={padL + 6} y={Math.max(11, top + 12)} fontSize="9" fill={z.color}>{z.key}</text>
        </g>;
      })}
      {bands && !tsbZones && (() => {
        const lastActual = rows.findIndex(r => r.projected);
        const width = (lastActual > 0 ? x(lastActual - 1) : w - padR) - padL;
        const ctlBase = rows.map((r, i) => ({ v: r.ctl, i })).filter(o => o.v > 0);
        if (!ctlBase.length) return null;
        return <>
          <polygon points={`${ctlBase.map(o => `${x(o.i)},${y(o.v * 1.3)}`).join(' ')} ${ctlBase.map(o => `${x(o.i)},${y(o.v * 0.7)}`).reverse().join(' ')}`} fill="#2f6fed" opacity=".10" />
          <polygon points={`${ctlBase.map(o => `${x(o.i)},${y(o.v * 1.15)}`).join(' ')} ${ctlBase.map(o => `${x(o.i)},${y(o.v * 0.85)}`).reverse().join(' ')}`} fill="#2f6fed" opacity=".16" />
        </>;
      })()}
      {bands && !tsbZones && (() => {
        const loads = rows.map(r => r.load ?? 0);
        const maxLoad = Math.max(...loads, 1);
        const barW = Math.max(2, (w - padL - padR) / Math.max(1, rows.length) * 0.6);
        return rows.map((r, i) => (r.load === null || r.load <= 0) ? null : <rect
          key={i} x={x(i) - barW / 2} width={barW}
          y={y(r.load)} height={h - padB - y(r.load)} rx={Math.min(2, barW / 2)}
          fill="#b9a6d8" opacity={r.projected ? 0 : .55} />);
      })()}
      {series.map(s => {
        const actual: Array<[number, number]> = [];
        rows.forEach((r, i) => { if (!r.projected) actual.push([x(i), y(r[s.key] as number)]); });
        const projStart = rows.findIndex(r => r.projected);
        const proj: Array<[number, number]> = [];
        if (projStart > 0) { proj.push([x(projStart - 1), y(rows[projStart - 1][s.key] as number)]); rows.forEach((r, i) => { if (r.projected) proj.push([x(i), y(r[s.key] as number)]); }); }
        return <g key={s.key}>
          <path d={smooth(actual)} fill="none" stroke={s.color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
          {proj.length > 1 && <path d={smooth(proj)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="5 4" opacity=".55" vectorEffect="non-scaling-stroke" />}
        </g>;
      })}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={h - padB} stroke="#9daf8b" strokeWidth="1" strokeDasharray="3 3" />}
      {hover !== null && series.map(s => <circle key={s.key} cx={x(hover)} cy={y(rows[hover][s.key] as number)} r="4" fill="#fff" stroke={s.color} strokeWidth="2.4" />)}
    </svg>
    {hoverRow && <div className="pmc-tooltip" style={{ left: `${x(hover!) / w * 100}%` }}>
      <b>{hoverRow.date.slice(5)}{hoverRow.projected ? ' · 预测' : ''}</b>
      {series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label} <b>{fmt(hoverRow[s.key] as number)}</b></span>)}
      {hoverRow.load !== null && <span>负荷 <b>{fmt(hoverRow.load)}</b></span>}
      {tsbZones && hoverRow.ctl >= 8 && <span>区间 <b>{zoneOf(hoverRow.tsb, hoverRow.ctl)?.key ?? '—'}</b></span>}
    </div>}
    <div className="pmc-axis">{rows.map((r, i) => (rows.length > 20 ? i % 7 === 0 : true) ? <span key={r.date}>{md(r.date)}</span> : <span key={r.date} />)}</div>
  </div>;
}

function WeightChart({ rows }: { rows: PmcRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = rows.filter(r => !r.projected && r.weight !== null);
  if (data.length < 1) return null;
  const w = 720, h = 190, padL = 40, padR = 16, padT = 16, padB = 28;
  const kg = data.map(r => r.weight as number);
  const min = Math.min(...kg) - 0.6, max = Math.max(...kg) + 0.6;
  const range = max - min || 1;
  const x = (i: number) => padL + (i * (w - padL - padR)) / Math.max(1, data.length - 1);
  const y = (v: number) => h - padB - ((v - min) / range) * (h - padT - padB);
  const pts = data.map((r, i) => [x(i), y(r.weight as number)] as [number, number]);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * w;
    const step = (w - padL - padR) / Math.max(1, data.length - 1);
    const idx = Math.round((svgX - padL) / step);
    setHover(idx >= 0 && idx < data.length ? idx : null);
  };
  const hoverRow = hover !== null ? data[hover] : null;
  const hasFat = data.some(r => r.bodyFat !== null);
  return <div className="pmc-plot">
    <svg viewBox={`0 0 ${w} ${h}`} className="pmc-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {[0, 0.5, 1].map(k => <line key={k} x1={padL} x2={w - padR} y1={padT + k * (h - padT - padB)} y2={padT + k * (h - padT - padB)} stroke="#e2e6dd" strokeWidth="1" />)}
      {hasFat && data.map((r, i) => r.bodyFat === null ? null : <rect key={i} x={x(i) - 2.5} y={padT} width={5} height={h - padT - padB} fill="#f0a830" opacity=".35" />)}
      {pts.length > 1 ? <path d={smooth(pts)} fill="none" stroke="#16a34a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" /> : null}
      {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="3" fill="#16a34a" />)}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={h - padB} stroke="#9daf8b" strokeWidth="1" strokeDasharray="3 3" />}
    </svg>
    {hoverRow && <div className="pmc-tooltip" style={{ left: `${x(hover!) / w * 100}%` }}>
      <b>{hoverRow.date.slice(5)}</b>
      <span><i style={{ background: '#16a34a' }}/>体重 <b>{(hoverRow.weight as number).toFixed(1)} kg</b></span>
      {hoverRow.bodyFat !== null && <span><i style={{ background: '#f0a830' }}/>体脂 <b>{hoverRow.bodyFat}%</b></span>}
    </div>}
    <div className="pmc-axis">{data.map((r, i) => (data.length > 20 ? i % Math.ceil(data.length / 8) === 0 : true) ? <span key={r.date}>{md(r.date)}</span> : <span key={r.date} />)}</div>
  </div>;
}

export function TrainingLoadPage({ date, onBack }: { date: string; onBack: () => void }) {
  const [days, setDays] = useState(91);
  const [data, setData] = useState<PmcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(`/api/pmc?date=${date}&days=${days}`)
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error || '加载失败'); if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '网络错误'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, days]);

  const zone = data?.latest.tsb !== null && data?.latest.ctl ? zoneOf(data.latest.tsb!, data.latest.ctl!) : null;
  const pct = data?.latest.tsb !== null && data?.latest.ctl ? (data.latest.tsb! / data.latest.ctl!) * 100 : null;
  const last = data?.rows.filter(r => !r.projected).at(-1);
  const weekAgo = data?.rows.filter(r => !r.projected).at(-8);

  if (loading && !data) return <div className="pmc-page"><div className="pmc-bar"><button onClick={onBack}><ArrowLeft size={16}/> 返回</button><h1>训练负荷</h1></div><div className="pmc-loading"><LoaderCircle className="spin" size={20}/> 正在从 Garmin 读取活动训练负荷…</div></div>;
  if (error) return <div className="pmc-page"><div className="pmc-bar"><button onClick={onBack}><ArrowLeft size={16}/> 返回</button><h1>训练负荷</h1></div><div className="pmc-loading error">{error}</div></div>;
  if (!data || !data.hasLoad) return <div className="pmc-page"><div className="pmc-bar"><button onClick={onBack}><ArrowLeft size={16}/> 返回</button><h1>训练负荷</h1></div><div className="pmc-loading">{data ? '该区间内没有带训练负荷的活动记录。' : '暂无数据。'}</div></div>;

  return <div className="pmc-page">
    <div className="pmc-bar">
      <button onClick={onBack}><ArrowLeft size={16}/> 返回</button>
      <div><h1>训练负荷</h1><p>健康度 · 疲劳度 · 状态值，基于 Garmin 每次活动的训练负荷</p></div>
      <div className="pmc-actions">
        <div className="pmc-range">{[42, 91, 182].map(d => <button key={d} className={d === days ? 'on' : ''} onClick={() => setDays(d)}>{d === 42 ? '6周' : d === 91 ? '3个月' : '6个月'}</button>)}</div>
        <button className="pmc-refresh" onClick={() => setDays(days)} aria-label="刷新"><RefreshCw size={15}/></button>
      </div>
    </div>
    <div className="pmc-kpis">
      <div className="pmc-kpi" style={{ ['--glow' as string]: '#2f6fed' }}><h4>健康度 CTL</h4><div className="big">{fmt(data.latest.ctl)}{last && weekAgo ? <span className={`d ${last.ctl >= weekAgo.ctl ? 'up' : 'dn'}`}>{last.ctl >= weekAgo.ctl ? '+' : ''}{fmt(last.ctl - weekAgo.ctl)} / 7天</span> : null}</div><p>长期体能（42 天）· 周爬升 {fmt(data.latest.ramp)}</p></div>
      <div className="pmc-kpi" style={{ ['--glow' as string]: '#e5383b' }}><h4>疲劳度 ATL</h4><div className="big">{fmt(data.latest.atl)}{last && weekAgo ? <span className={`d ${last.atl >= weekAgo.atl ? 'up' : 'dn'}`}>{last.atl >= weekAgo.atl ? '+' : ''}{fmt(last.atl - weekAgo.atl)} / 7天</span> : null}</div><p>近期疲劳（7 天）</p></div>
      <div className="pmc-kpi" style={{ ['--glow' as string]: zone?.color ?? '#22a447' }}><h4>状态值 TSB</h4><div className="big">{(data.latest.tsb ?? 0) >= 0 ? '+' : ''}{fmt(data.latest.tsb)}{zone ? <span className="tag">{zone.key}</span> : null}</div><p>占健康度 {pct !== null ? `${fmt(pct, 0)}%` : '—'} · 昨日 CTL − ATL</p></div>
    </div>
    <section className="pmc-card">
      <div className="pmc-ch"><h4>健康度 · 疲劳度</h4><div className="pmc-legend"><span><i style={{ background: '#2f6fed' }}/>健康度 CTL</span><span><i style={{ background: 'rgba(47,111,237,.28)' }}/>±15% / ±30%</span><span><i style={{ background: '#e5383b' }}/>疲劳度 ATL</span><span><i style={{ background: '#b9a6d8' }}/>每日负荷</span></div></div>
      <Chart rows={data.rows} series={[{ key: 'ctl', color: '#2f6fed', label: 'CTL' }, { key: 'atl', color: '#e5383b', label: 'ATL' }]} bands />
    </section>
    <section className="pmc-card">
      <div className="pmc-ch"><h4>状态值 TSB <small>占健康度 %</small></h4><div className="pmc-legend">{ZONES.map(z => <span key={z.key}><i style={{ background: z.color }}/>{z.key}</span>)}</div></div>
      <Chart rows={data.rows} series={[{ key: 'tsb', color: '#22a447', label: 'TSB' }]} height={200} tsbZones />
    </section>
    {data.rows.some(r => !r.projected && r.weight !== null) && <section className="pmc-card">
      <div className="pmc-ch"><h4>体重 · 体脂</h4><div className="pmc-legend"><span><i style={{ background: '#16a34a' }}/>体重 kg（线）</span><span><i style={{ background: '#f0a830' }}/>体脂 %（柱）</span></div></div>
      <WeightChart rows={data.rows} />
    </section>}
    <section className="pmc-expl">
      <h4>怎么看</h4>
      <ul>
        <li><b style={{ color: '#2f6fed' }}>健康度 CTL</b>：42 天指数加权平均负荷，代表长期体能底子，缓慢上升才是进步。</li>
        <li><b style={{ color: '#e5383b' }}>疲劳度 ATL</b>：7 天指数加权平均负荷，代表近期累积疲劳，涨得快退得也快。</li>
        <li><b style={{ color: '#b7791f' }}>状态值 TSB</b>：CTL − ATL。负值＝正在吃训练量，正值＝近期负荷回落。区间按 TSB 占 CTL 的百分比划分（与 intervals.icu 一致）。</li>
      </ul>
      <div className="pmc-zones">
        <span style={{ background: 'rgba(250,204,21,.24)' }}>休息较多 &gt; +25%</span>
        <span style={{ background: 'rgba(37,99,235,.20)' }}>恢复较好 +5…+25%</span>
        <span style={{ background: 'rgba(100,116,139,.20)' }}>负荷平衡 −10…+5%</span>
        <span style={{ background: 'rgba(21,152,63,.20)' }}>训练积累 −30…−10%</span>
        <span style={{ background: 'rgba(239,68,68,.20)' }}>疲劳偏高 &lt; −30%</span>
      </div>
      <p className="pmc-note">计算方式与 APK 内 <code>assets/training/load.js</code> 一致（CTL 42 天、ATL 7 天指数衰减；虚线为未来 14 天无新负荷的预测）。每日负荷取 Garmin 活动的 <code>activityTrainingLoad</code> 字段，仅在 Garmin 记录了该值时才纳入计算。</p>
    </section>
  </div>;
}
