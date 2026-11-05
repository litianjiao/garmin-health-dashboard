import { useEffect, useState } from 'react';
import { compareMetric, dailyHint, MIN_DAYS, WINDOW_DAYS, type Comparison } from './baseline';
import type { HistoryView } from './personalHistory';
import './personalBaseline.css';

const stateText = { missing: '当天未记录', learning: '积累中', below: '低于近期区间', within: '在近期区间内', above: '高于近期区间' };
const format = (n: number | null) => n === null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function Metric({ title, unit, v }: {title:string; unit:string; v:Comparison}) {
  return <div className="personal-metric"><div><span>{title}</span><small>{stateText[v.position]}</small></div>
    <strong>{format(v.current)} <small>{unit}</small></strong>
    <p>{v.median !== null ? `中位数 ${format(v.median)} · 常见区间 ${format(v.low)}–${format(v.high)}` : `还需 ${MIN_DAYS-v.count} 个有效日建立参照`}</p>
    <p>历史有效日：{v.count} / {WINDOW_DAYS}</p></div>;
}
export function PersonalBaseline({date, version}: {date:string; version:string}) {
  const [view,setView] = useState<HistoryView|null>(null);
  const [error,setError] = useState(''), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setError('');
      try {
        const res = await fetch(`/api/history?date=${date}`, { signal: ac.signal });
        if (!res.ok) throw new Error('无法读取本地历史');
        const body = await res.json();
        if (!ac.signal.aborted) setView(body);
      } catch (err) { if (!ac.signal.aborted) setError(err instanceof Error ? err.message : '读取失败'); }
    })();
    return () => ac.abort();
  }, [date,version,reload]);
  async function sync() {
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/history/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date})});
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || '同步失败');
      setMessage(`30 天内有读数：${body.validDays} 天`); setReload(i => i+1);
    } catch (e) { setMessage(e instanceof Error ? e.message : '同步失败'); } finally { setBusy(false); }
  }
  if (!view && !error) return null;
  const hrv = compareMetric(view?.days ?? [],date,'hrv'), rhr = compareMetric(view?.days ?? [],date,'restingHeartRate');
  return <section className="panel personal-panel" aria-label="个人基线">
    <div className="personal-head"><div><h2>个人基线</h2><p>{date} · 跟自己的历史比较</p></div>
      {view?.canSync && <button disabled={busy} onClick={sync}>{busy ? '同步中…' : '补同步近 30 天'}</button>}</div>
    {error && <p role="alert">{error} <button onClick={() => setReload(i=>i+1)}>重试</button></p>}
    {view && view.status !== 'ready' && <p>{view.status === 'off' ? '本机历史未启用。可在服务端配置 HEALTH_HISTORY_DIR 后重启；默认不留存。' : '请先配置真实 Garmin 数据源；演示数据不参与个人基线。'}</p>}
    {view?.status === 'ready' && <>
      <div className="personal-grid"><Metric title="夜间 HRV" unit="ms" v={hrv}/><Metric title="静息心率" unit="bpm" v={rhr}/></div>
      <p className="personal-hint"><b>当日提示：</b>{dailyHint(hrv,rhr)}</p>
      <details><summary>区间怎么算？</summary><p>取所选日之前 {WINDOW_DAYS} 个日历日，不含当天。每项至少 {MIN_DAYS} 个有效日后才计算中位数和第 10–90 百分位。区间只描述个人近期记录，不是医学正常值，也不是 Garmin 官方 HRV 状态。</p></details>
    </>}
    {view?.warning && <p role="alert">{view.warning}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
