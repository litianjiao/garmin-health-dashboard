import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function MetricCard({ title, children, className = '', label, onOpen }: { title: string; children: ReactNode; className?: string; label?: string; onOpen?: () => void }) {
  return <article className={`metric-card ${className}`}>
    <div className="card-head"><h2>{title}</h2>{onOpen
      ? <button className="card-open" onClick={onOpen} aria-label={`查看${title}趋势详情`}><ArrowUpRight size={18} strokeWidth={1.5}/></button>
      : <ArrowUpRight size={18} strokeWidth={1.5} aria-label={label || `${title}详情`} />}</div>
    {children}
  </article>;
}
export function Value({ value, decimals = 0 }: { value: number | null; decimals?: number }) {
  return <>{value === null ? <span className="no-value">—</span> : value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}
export function Sparkline({ values, color = '#a99470' }: { values: number[]; color?: string }) {
  if (!values.length) return <div className="empty-chart">等待更多数据</div>;
  const w = 220, h = 64, pad = 5;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((v, i) => [pad + i * (w - pad * 2) / (values.length - 1), h - pad - (v - min) / range * (h - pad * 2)]);
  const d = points.map(([x, y], i) => {
    if (!i) return `M ${x} ${y}`;
    const [px, py] = points[i - 1]; const cx = (px + x) / 2;
    return `C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }).join(' ');
  return <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="指标变化趋势">
    <defs><linearGradient id={`area-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".18"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <path d={`${d} L ${points.at(-1)![0]} ${h} L ${points[0][0]} ${h} Z`} fill={`url(#area-${color.replace('#', '')})`} />
    <path d={d} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
    <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r="3.5" fill={color} />
  </svg>;
}
export function Bars({ values, active = -2, darkLast = false }: { values: number[]; active?: number; darkLast?: boolean }) {
  if (!values.length) return <div className="empty-chart">暂无趋势数据</div>;
  const max = Math.max(...values);
  return <div className="mini-bars" aria-label="近期指标柱状图">{values.map((v, i) => <span key={i} className={`${i === values.length + active ? 'active' : ''} ${darkLast && i === values.length - 1 ? 'last' : ''}`} style={{ height: `${Math.max(20, v / max * 100)}%` }} />)}</div>;
}
export function Ring({ segments, size = 96, thickness = 11, center, centerLabel }: {
  segments: Array<{ value: number; color: string; label: string }>;
  size?: number; thickness?: number; center?: string; centerLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const readable = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec - h * 3600) / 60);
    if (h > 0) return `${h}h${m ? ' ' + m + 'm' : ''}`;
    if (m > 0) return `${m}m`;
    return `${Math.round(sec)}s`;
  };
  return <div className="ring-wrap">
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-label={segments.map(s => `${s.label} ${Math.round(s.value)}`).join('、')}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eceff0" strokeWidth={thickness} />
      {total > 0 && segments.map((s, i) => {
        const len = (Math.max(0, s.value) / total) * c;
        const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
          strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />;
        offset += len;
        return el;
      })}
      {center && <text x={size / 2} y={size / 2 + (centerLabel ? -2 : 5)} textAnchor="middle" fontSize="15" fontWeight="600" fill="#3c443c">{center}</text>}
      {centerLabel && <text x={size / 2} y={size / 2 + 13} textAnchor="middle" fontSize="8" fill="#949891">{centerLabel}</text>}
    </svg>
    <div className="ring-legend">{segments.map((s, i) => <span key={i}><i style={{ background: s.color }} />{s.label} {readable(s.value)}</span>)}</div>
  </div>;
}

export function StackedBar({ segments, total }: { segments: Array<{ value: number; color: string; label: string }>; total: number }) {
  const sum = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || total || 1;
  return <div className="stack-wrap">
    <div className="stack-bar">{segments.map((s, i) => <span key={i} style={{ width: `${(Math.max(0, s.value) / sum) * 100}%`, background: s.color }} title={`${s.label} ${Math.round(s.value / 60)} 分钟`} />)}</div>
    <div className="stack-legend">{segments.map((s, i) => {
      const h = Math.floor(s.value / 3600), m = Math.round((s.value - h * 3600) / 60);
      return <span key={i}><i style={{ background: s.color }} />{s.label} {h > 0 ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`}</span>;
    })}</div>
  </div>;
}

export function ProgressBar({ value, goal, unit = '' }: { value: number | null; goal: number | null; unit?: string }) {
  if (value === null) return <div className="progress-empty">暂无记录</div>;
  const pct = goal ? Math.max(0, Math.min(100, ((goal - value) / goal) * 100)) : null;
  return <div className="progress-wrap">
    <div className="progress-track">{goal ? <span style={{ width: `${goal ? Math.min(100, (value / goal) * 100) : 0}%` }} /> : null}</div>
    <div className="progress-meta">
      <span>当前 <b>{value.toFixed(1)}{unit}</b></span>
      {goal ? <span>目标 <b>{goal.toFixed(1)}{unit}</b>{pct !== null ? ` · 还差 ${(value - goal).toFixed(1)}${unit}` : ''}</span> : <span>未设目标</span>}
    </div>
  </div>;
}

export function StressGauge({ value }: { value: number | null }) {
  const angle = value === null ? -90 : -90 + value / 100 * 180;
  return <div className="gauge-wrap"><svg className="gauge" viewBox="0 0 220 115" aria-label={`平均压力 ${value ?? '暂无'}`}>
    <defs><linearGradient id="stress-gradient"><stop stopColor="#d47189"/><stop offset=".5" stopColor="#dca1ac"/><stop offset="1" stopColor="#eadce0"/></linearGradient></defs>
    <path d="M 25 104 A 85 85 0 0 1 195 104" fill="none" stroke="#efe5e7" strokeWidth="13" strokeLinecap="round" />
    <path d="M 25 104 A 85 85 0 0 1 195 104" pathLength="100" fill="none" stroke="url(#stress-gradient)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${value ?? 0} 100`} />
    <g transform={`rotate(${angle} 110 104)`}><line x1="110" y1="104" x2="110" y2="25" stroke="#c18c9b" strokeWidth="1.5"/><circle cx="110" cy="25" r="7" fill="#fff" stroke="#c18c9b" strokeWidth="3"/></g>
  </svg><div className="gauge-scale"><span>0</span><span>100</span></div></div>;
}
export function HumanFigure({ battery, spo2, respiration, heartRate }: { battery: number | null; spo2: number | null; respiration: number | null; heartRate: number | null }) {
  return <div className="human-stage">
    <div className="human-halo" />
    <img className="human-figure human-photo" src="/human.png" alt="人体实时健康状态示意图" />
    <div className="body-label battery-label"><span>身体电量</span><strong>{battery ?? '—'}</strong></div>
    <div className="body-label spo2-label"><span>血氧 SpO₂</span><div><strong>{spo2 ?? '—'}</strong><b>%</b></div><small>{spo2 === null ? '暂无数据' : '最新 · 正常'}</small></div>
    <div className="body-label breath-label"><span>呼吸</span><div><strong>{respiration ?? '—'}</strong><b>rpm</b></div><small>清醒均值</small></div>
    <div className="body-label heart-label"><span>心率</span><div><strong>{heartRate ?? '—'}</strong><b>bpm</b></div><small>静息 · 正常</small></div>
    <i className="body-point point-spo2"/><i className="body-point point-breath"/><i className="body-point point-heart"/>
    <div className="human-caption"><span>实时洞察</span><span>更健康的你</span></div>
  </div>;
}
