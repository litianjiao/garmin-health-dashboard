import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Clock, LoaderCircle, Moon, RefreshCw, Settings2, Sparkles, Sun, X } from 'lucide-react';

export interface BriefingInsight { label: string; text: string; tone: 'good' | 'warn' | 'neutral' }
export interface DailyBriefing {
  date: string; forDate: string; generatedAt: string; source: 'ai' | 'rules'; model: string | null;
  headline: string; summary: string; insights: BriefingInsight[];
  trainingAdvice: string; recoveryAdvice: string; attention: string; error?: string;
}
interface Config { enabled: boolean; hour: number; browserNotify: boolean }

const fmtDate = (s: string) => {
  const d = new Date(`${s}T12:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export function BriefingPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [history, setHistory] = useState<DailyBriefing[]>([]);
  const [config, setConfig] = useState<Config>({ enabled: true, hour: 10, browserNotify: true });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'today' | 'history' | 'settings'>('today');
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch('/api/briefing/today').then(r => r.json()),
        fetch('/api/briefing/history').then(r => r.json()),
      ]);
      setBriefing(a.briefing ?? null);
      setHistory(b.history ?? []);
      if (a.config) setConfig(a.config);
    } catch { setError('加载简报失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const res = await fetch('/api/briefing/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '生成失败');
      setBriefing(body.briefing);
      setTab('today');
      setToast('简报已生成');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '生成失败'); }
    finally { setGenerating(false); }
  };

  const saveConfig = async (next: Config) => {
    setConfig(next);
    try {
      const res = await fetch('/api/briefing/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!res.ok) throw new Error('保存失败');
      setToast('设置已保存');
    } catch { setToast('保存失败'); }
  };

  const shown = tab === 'today' ? briefing : tab === 'history' && history.length ? history[Math.max(0, history.findIndex(h => h.forDate === briefing?.forDate))] || history[0] : null;

  return <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="drawer briefing-drawer" role="dialog" aria-label="每日健康简报">
      <header><div><h2>每日健康简报</h2><span>结合前一天完整数据 · AI 生成洞察与当日建议</span></div>
        <div className="drawer-controls">
          <button className="drawer-close" onClick={generate} disabled={generating} aria-label="重新生成">{generating ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={16}/>}</button>
          <button className="drawer-close" onClick={onClose} aria-label="关闭"><X size={18}/></button>
        </div>
      </header>
      <div className="briefing-tabs">
        {([['today', '今日简报'], ['history', '历史'], ['settings', '推送设置']] as const).map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {loading && <div className="drawer-loading">正在加载简报…</div>}
      {error && <div className="drawer-error">{error}</div>}

      {!loading && tab === 'today' && !briefing && <div className="briefing-empty">
        <Sparkles size={40} strokeWidth={1.3}/>
        <h3>今天的简报还没生成</h3>
        <p>每天 {config.hour}:00 左右自动生成，基于前一天的睡眠、恢复、活动与训练负荷。</p>
        <button onClick={generate} disabled={generating}>{generating ? '正在生成…' : '立即生成'}</button>
      </div>}

      {!loading && shown && (tab === 'today' || (tab === 'history' && history.length > 0)) && <BriefingBody b={shown} history={history} onSelect={setBriefing} />}

      {!loading && tab === 'history' && !history.length && <div className="drawer-hint">暂无历史简报。</div>}

      {!loading && tab === 'settings' && <div className="briefing-settings">
        <label className="briefing-setting-row">
          <div><b><Bell size={14}/> 自动生成每日简报</b><span>每天在设定时间后生成一次；服务当天晚些启动会自动补生成</span></div>
          <input type="checkbox" checked={config.enabled} onChange={e => saveConfig({ ...config, enabled: e.target.checked })}/>
        </label>
        <label className="briefing-setting-row">
          <div><b><Clock size={14}/> 生成时间</b><span>本地时间，之后生成（不是精确整点）</span></div>
          <select value={config.hour} onChange={e => saveConfig({ ...config, hour: Number(e.target.value) })}>
            {[6, 7, 8, 9, 10, 11, 12].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <div className="briefing-setting-note">
          <p>推送方式：生成后会发送 <b>Windows 桌面通知</b>；网页打开时顶部会显示简报横幅，铃铛出现红点。浏览器系统通知需在浏览器设置里允许本站通知权限。</p>
          <p>每天仅调用一次 AI（使用「模型管理」里选中的模型），结果保存在本机。AI 不可用时自动降级为本地规则简报，保证有内容。</p>
        </div>
        <button className="briefing-generate-btn" onClick={generate} disabled={generating}><RefreshCw size={14}/> 用当前设置立即生成一份</button>
      </div>}
      {toast && <div className="chat-toast"><Check size={14}/> {toast}</div>}
    </aside>
  </div>;
}

function BriefingBody({ b, history, onSelect }: { b: DailyBriefing; history: DailyBriefing[]; onSelect: (b: DailyBriefing) => void }) {
  return <div className="briefing-body">
    {history.length > 1 && <div className="briefing-history-strip">
      {history.slice(0, 7).map(h => <button key={h.forDate + h.date} className={h.forDate === b.forDate ? 'on' : ''} onClick={() => onSelect(h)}>{fmtDate(h.date)}</button>)}
    </div>}
    <div className="briefing-hero">
      <div className="briefing-hero-top"><Sun size={20}/><span>{fmtDate(b.date)} 数据 · {fmtDate(b.forDate)} 简报</span></div>
      <h3>{b.headline}</h3>
      <p>{b.summary}</p>
      <div className="briefing-meta">
        <span>{b.source === 'ai' ? `AI · ${b.model || '模型'}` : '本地规则生成'}</span>
        <span>{new Date(b.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
    {b.error && <div className="briefing-warn">{b.error}</div>}
    <div className="briefing-section"><h4>关键洞察</h4>
      <div className="briefing-insights">{b.insights.map((it, i) => <div key={i} className={`briefing-insight ${it.tone}`}>
        <b>{it.label}</b><span>{it.text}</span>
      </div>)}</div>
    </div>
    <div className="briefing-section"><h4>今日训练建议</h4><p className="briefing-advice">{b.trainingAdvice}</p></div>
    <div className="briefing-section"><h4><Moon size={14}/> 恢复与作息</h4><p className="briefing-advice">{b.recoveryAdvice}</p></div>
    <div className="briefing-attention">{b.attention}</div>
  </div>;
}
