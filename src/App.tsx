import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Bike, Check, ChevronRight, Download, Footprints, Heart, LoaderCircle, LockKeyhole, MessageCircle, Moon, Plus, RefreshCw, Sparkles, Target, X, Zap } from 'lucide-react';
import type { DashboardData, Insight } from './types';
import { Bars, HumanFigure, MetricCard, ProgressBar, Ring, Sparkline, StackedBar, StressGauge, Value } from './components';
import { DetailDrawer, DETAIL_SPECS, type DetailSpec } from './DetailDrawer';
import { makeSummary } from './summary';
import { TrainingLoadPage } from './TrainingLoad';
import { ChatPage } from './ChatPage';
import { BriefingPanel, type DailyBriefing } from './BriefingPanel';

const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const unit = (value: number | null, suffix: string) => value === null ? '' : suffix;
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));

const CARD_META: Record<string, { title: string; desc: string }> = {
  weight: { title: '体重', desc: '当前体重、变化量与 70kg 目标进度' },
  battery: { title: '身体电量', desc: '充能/消耗/晨起值/睡眠恢复量' },
  intensity: { title: '活动强度', desc: '睡眠/久坐/活动/高强度时间占比环形图' },
  stress: { title: '压力分布', desc: '休息/低/中/高压力时长堆叠图' },
  calories: { title: '卡路里', desc: '基础/活动消耗与 7/30 天趋势' },
  heart: { title: '心率', desc: '静息/最高心率与 7/30 天趋势' },
};

export default function App() {
  const [date, setDate] = useState(dateString(new Date()));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [detail, setDetail] = useState<DetailSpec | null>(null);
  const [settings, setSettings] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [page, setPage] = useState<'dashboard' | 'training' | 'chat'>('dashboard');
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingUnread, setBriefingUnread] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [visible, setVisible] = useState<{ calories: boolean; heart: boolean; weight: boolean; battery: boolean; intensity: boolean; stress: boolean }>(() => {
    const defaults = { calories: true, heart: true, weight: true, battery: true, intensity: true, stress: true };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('moru-cards') || '{}') }; } catch { return defaults; }
  });
  const toggleCard = (key: 'calories' | 'heart' | 'weight' | 'battery' | 'intensity' | 'stress') => {
    setVisible(v => {
      const next = { ...v, [key]: !v[key] };
      try { localStorage.setItem('moru-cards', JSON.stringify(next)); } catch { /* 隐私模式下忽略 */ }
      return next;
    });
  };
  const load = useCallback(async (refresh = false, forceDemo = false) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/dashboard?date=${date}&refresh=${refresh ? 1 : 0}${forceDemo ? '&demo=1' : ''}`);
      if (res.status === 401) { setAuthRequired(true); return; }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '无法读取数据');
      setData(body);
    } catch (err) { setError(err instanceof Error ? err.message : '网络连接失败'); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3000); return () => clearTimeout(id); }, [toast]);

  // 每日简报：页面加载时拉取，之后每 2 分钟轮询（服务端 10 点后自动生成）
  useEffect(() => {
    let knownFor: string | null = null;
    const check = async () => {
      try {
        const res = await fetch('/api/briefing/today');
        if (!res.ok) return;
        const body = await res.json();
        const b: DailyBriefing | null = body.briefing ?? null;
        setBriefing(b);
        if (b) {
          const isNew = knownFor !== null && knownFor !== b.forDate;
          setBriefingUnread(true);
          if (isNew && body.config?.browserNotify && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification(`MORU · ${b.headline}`, { body: b.summary.slice(0, 120), tag: 'moru-briefing' }); } catch { /* 忽略 */ }
          }
          knownFor = b.forDate;
        }
      } catch { /* 服务不可用时静默 */ }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 120_000);
    return () => clearInterval(timer);
  }, []);
  const openBriefing = () => { setBriefingOpen(true); setBriefingUnread(false); };
  const askNotificationPermission = () => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  };
  const moveDate = (offset: number) => { const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + offset); const today = new Date(); if (next.getFullYear() < today.getFullYear() || next.getFullYear() === today.getFullYear() && (next.getMonth() < today.getMonth() || next.getMonth() === today.getMonth() && next.getDate() <= today.getDate())) setDate(dateString(next)); };
  const exportData = async (kind: 'json' | 'csv' | 'summary') => {
    if (!data) return;
    let content = '', type = 'text/plain;charset=utf-8', extension = 'txt';
    if (kind === 'json') { content = JSON.stringify(data, null, 2); type = 'application/json'; extension = 'json'; }
    if (kind === 'csv') {
      const d = data;
      const w = d.weight, bb = d.bodyBatteryDetail, it = d.intensity, sd = d.stressDetail, rd = d.respirationDay;
      const header = ['日期', '步数', '步数目标', '距离km', '睡眠小时', '睡眠评分', '深睡分', 'REM分', '浅睡分', '清醒分',
        '静息心率', '最高心率', 'HRV', 'HRV周均', 'HRV状态', '身体电量', '电量充能', '电量消耗', '电量最低', '电量最高', '晨起电量',
        '血氧最新', '血氧均值', '血氧最低', '压力均值', '压力峰值', '压力状态', '压力休息分', '压力低分', '压力中分', '压力高分',
        '卡路里总', '卡路里基础', '卡路里活动', '久坐秒', '活动秒', '高强度秒', '睡眠秒', '中强度分', '高强度分', '强度目标',
        '呼吸睡眠', '呼吸清醒', '呼吸最低', '呼吸最高', '体重kg', '体重目标kg', '体脂%'];
      const row = [d.date, d.activity.steps, d.activity.goal, d.activity.distanceKm,
        d.sleep.hours, d.sleep.score, d.sleep.deep, d.sleep.rem, d.sleep.light, d.sleep.awake,
        d.restingHeartRate, d.heartRateMax, d.hrv.lastNight, d.hrv.weekly, d.hrv.status, d.bodyBattery,
        bb?.charged, bb?.drained, bb?.lowest, bb?.highest, bb?.atWakeTime,
        d.spo2.latest, d.spo2.average, d.spo2.min, d.stress.average, d.stress.max, d.stress.status,
        sd?.restSec, sd?.lowSec, sd?.mediumSec, sd?.highSec,
        d.calories?.total, d.calories?.resting, d.calories?.active,
        it?.sedentarySec, it?.activeSec, it?.highlyActiveSec, it?.sleepingSec, it?.moderateMin, it?.vigorousMin, it?.goal,
        d.respiration, rd?.avgWaking, rd?.lowest, rd?.highest,
        w?.latestKg, w?.goalKg, d.bodyFat?.value];
      const clean = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
      content = '\ufeff' + [header, row].map(r => r.map(clean).join(',')).join('\n');
      type = 'text/csv;charset=utf-8'; extension = 'csv';
    }
    if (kind === 'summary') {
      let pmc = null;
      try {
        const res = await fetch(`/api/pmc?date=${date}&days=91`);
        if (res.ok) { const body = await res.json(); if (body && body.latest) pmc = body.latest; }
      } catch { /* 训练负荷不可用时摘要仍可生成 */ }
      content = makeSummary(data, pmc);
    }
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = `Garmin-${data.date}-${kind}.${extension}`; a.click(); URL.revokeObjectURL(url);
    setToast(kind === 'summary' ? '摘要已下载，可发送给元宝' : '文件已导出'); setMenu(false);
  };
  if (authRequired) return <Login onSuccess={() => { setAuthRequired(false); load(); }} />;
  if (page === 'training') return <TrainingLoadPage date={date} onBack={() => setPage('dashboard')} />;
  if (page === 'chat') return <ChatPage date={date} onBack={() => setPage('dashboard')} />;
  const openDetail = (key: string) => { const spec = DETAIL_SPECS[key]; if (spec) setDetail(spec); };
  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="ambient ambient-three"/>
    <header className="topbar">
      <div className="greeting"><p>你好，</p><h1>{data?.profile.name || 'ZAX'}<span>.</span></h1><span>这是你今天的健康概况</span></div>
      <div className="top-controls"><span className="date-display">{formatDate(date)}</span><div className="date-buttons"><button onClick={() => moveDate(-1)} aria-label="前一天"><ArrowLeft size={14}/></button><button onClick={() => moveDate(1)} aria-label="后一天"><ArrowRight size={14}/></button></div><button className={`icon-button ${loading ? 'spinning' : ''}`} onClick={() => load(true)} aria-label="刷新数据"><RefreshCw size={17}/></button><button className="icon-button notification" aria-label="每日简报" onClick={() => { askNotificationPermission(); openBriefing(); }}><Bell size={18}/>{briefingUnread && briefing && <i/>}</button><button className="avatar" onClick={() => setMenu(!menu)} aria-label="打开数据菜单">Z<span/></button></div>
    </header>
    {menu && <div className="export-menu"><div><strong>健康数据</strong><button onClick={() => setMenu(false)} aria-label="关闭"><X size={16}/></button></div><button onClick={() => exportData('summary')}><Download size={15}/> 元宝健康摘要</button><button onClick={() => exportData('json')}><Download size={15}/> 导出 JSON</button><button onClick={() => exportData('csv')}><Download size={15}/> 导出 CSV</button></div>}
    {data?.source === 'demo' && <div className="demo-notice"><span/>演示数据 · 配置 Garmin 账号后显示你的真实数据 <button onClick={() => exportData('summary')}>导出摘要 <ArrowUpRight size={12}/></button></div>}
    {briefing && !bannerDismissed && <div className="briefing-banner">
      <span className="briefing-banner-icon"><Sparkles size={17}/></span>
      <div className="briefing-banner-copy"><strong>昨日简报 · {briefing.headline}</strong><span>{briefing.summary}</span></div>
      <button className="briefing-banner-open" onClick={openBriefing}>查看简报 <ArrowUpRight size={12}/></button>
      <button className="briefing-banner-close" onClick={() => setBannerDismissed(true)} aria-label="关闭横幅"><X size={14}/></button>
    </div>}
    {error && <div className="error-notice"><span>{error}</span><button onClick={() => load(false, true)}>查看演示界面</button><button onClick={() => load(true)}>重试</button></div>}
    <main>
      <section className="hero-grid">
        <HumanFigure battery={data?.bodyBattery ?? null} spo2={data?.spo2.latest ?? null} respiration={data?.respiration ?? null} heartRate={data?.restingHeartRate ?? null}/>
        <div className="metrics-grid">
          <MetricCard title="健身年龄" className="fitness-card" onOpen={() => openDetail('fitness')}><div className="metric-value"><Value value={data?.profile.fitnessAge ?? null} decimals={data?.profile.fitnessAge === null ? 0 : 1}/></div><p className="metric-sub">岁{data?.profile.actualAge ? ` · 实际 ${data.profile.actualAge} 岁` : ' · Garmin 指标'}</p>{data?.profile.fitnessAge !== null && data?.profile.fitnessAge !== undefined && data.profile.actualAge ? <span className={`age-badge ${data.profile.fitnessAge > data.profile.actualAge ? 'older' : ''}`}>比实际年龄 {data.profile.fitnessAge - data.profile.actualAge > 0 ? '+' : ''}{(data.profile.fitnessAge - data.profile.actualAge).toFixed(1)} 岁</span> : <span className="unavailable-badge">设备支持后显示</span>}<div className="fitness-orbit"><i/><i/><span/><span/></div><div className="card-footer"><span>{data && data.profile.achievableAge !== null && data.profile.achievableAge !== undefined ? `可达 ${data.profile.achievableAge.toFixed(1)} 岁` : '暂无可达年龄'}</span><span>VO₂max {data?.profile.vo2max ?? '—'}</span></div></MetricCard>
          <MetricCard title="血氧" className="oxygen-card" onOpen={() => openDetail('oxygen')}><div className="metric-value"><Value value={data?.spo2.latest ?? null}/></div><p className="metric-sub">%{unit(data?.spo2.latest ?? null, ' · 最新读数')}</p><Sparkline values={data?.spo2.history || []}/><div className="card-footer"><span>最低 {data?.spo2.min ?? '—'}{unit(data?.spo2.min ?? null, '%')}</span><span className="status-dot">正常</span><span>均值 {data?.spo2.average ?? '—'}{unit(data?.spo2.average ?? null, '%')}</span></div></MetricCard>
          <MetricCard title="HRV" className="hrv-card" onOpen={() => openDetail('hrv')}><div className="metric-value"><Value value={data?.hrv.lastNight ?? null}/></div><p className="metric-sub">ms{unit(data?.hrv.lastNight ?? null, ' · 昨晚均值')}</p><Bars values={data?.hrv.history || []}/><div className="card-footer"><span>{data?.hrv.status || '暂无'}</span><span>周均 {data?.hrv.weekly ?? '—'} · 基线 {data?.hrv.baselineLow ?? '—'}–{data?.hrv.baselineHigh ?? '—'}</span></div></MetricCard>
          <MetricCard title="睡眠" className="sleep-card" onOpen={() => openDetail('sleep')}><div className="metric-value"><Value value={data?.sleep.hours ?? null} decimals={1}/></div><p className="metric-sub">小时{data?.sleep.start ? ` · ${data.sleep.start}–${data.sleep.end}` : ''}</p><SleepStages data={data}/><div className="card-footer"><strong>{data?.sleep.score === null || !data ? '暂无评分' : data.sleep.score >= 80 ? '良好' : data.sleep.score >= 60 ? '一般' : '需关注'}</strong><span>评分 {data?.sleep.score ?? '—'}</span></div></MetricCard>
          <MetricCard title="压力" className="stress-card" onOpen={() => openDetail('stress')}><div className="metric-value"><Value value={data?.stress.average ?? null}/></div><p className="metric-sub">平均压力 · 0–100</p><StressGauge value={data?.stress.average ?? null}/><div className="card-footer"><strong>{data?.stress.status || '暂无'}</strong><span>峰值 {data?.stress.max ?? '—'}</span></div></MetricCard>
          <MetricCard title="活动" className="activity-card" onOpen={() => openDetail('activity')}><div className="metric-value"><Value value={data?.activity.steps ?? null}/></div><p className="metric-sub">步{data?.activity.distanceKm !== null && data ? ` · ${data.activity.distanceKm.toFixed(1)} km` : ''}</p><Bars values={data?.activity.history || []} active={0} darkLast/><div className="card-footer"><span>目标完成 {data?.activity.goal && data.activity.steps !== null ? Math.round(data.activity.steps / data.activity.goal * 100) : '—'}%</span><span>{data?.activity.goal?.toLocaleString() ?? '—'} 步</span></div><div className="goal-track"><span style={{ width: `${Math.min(100, data && data.activity.goal && data.activity.steps !== null ? data.activity.steps / data.activity.goal * 100 : 0)}%` }}/></div></MetricCard>
        </div>
      </section>
      <section className="bottom-grid">
        <Timeline data={data}/>
        <article className="panel insights-panel"><div className="panel-title"><h2>近期洞察</h2><ArrowUpRight size={19}/></div><div className="insights-list">{data?.insights.length ? data.insights.map((item, i) => <InsightRow item={item} key={`${item.title}-${i}`}/>) : <Empty text="获得数据后，这里会生成你的健康洞察"/>}</div></article>
      </section>
      {extraOpen && <div className="metrics-grid extra-metrics bottom-extra">
        {visible.calories && <MetricCard title="卡路里" className="calories-card" onOpen={() => openDetail('calories')}><div className="metric-value"><Value value={data?.calories?.total ?? null}/></div><p className="metric-sub">kcal · 今日总消耗</p><div className="cal-split"><span>基础 {(data?.calories?.resting ?? 0).toLocaleString()}</span><span>活动 {(data?.calories?.active ?? 0).toLocaleString()}</span></div><div className="cal-bars"><span style={{ flex: data?.calories?.resting ?? 1 }}/><span style={{ flex: data?.calories?.active ?? 0.3 }}/></div><div className="card-footer"><span>点右上角箭头看 7/30 天趋势</span></div></MetricCard>}
        {visible.heart && <MetricCard title="心率" className="heart-card" onOpen={() => openDetail('heart')}><div className="metric-value"><Value value={data?.restingHeartRate ?? null}/></div><p className="metric-sub">bpm · 静息心率</p><div className="hr-mini"><div><span>最高</span><b>{data?.heartRateMax ?? '—'}</b></div><div><span>近7日均</span><b>{data?.restingHeartRate ?? '—'}</b></div></div><div className="card-footer"><span>点右上角箭头看 7/30 天趋势</span></div></MetricCard>}
        {visible.weight && <MetricCard title="体重 · 体脂" className="weight-card" onOpen={() => openDetail('weight')}>
          <div className="metric-value">{data?.weight?.latestKg !== null && data?.weight?.latestKg !== undefined ? data.weight.latestKg.toFixed(1) : <span className="no-value">—</span>}</div>
          <p className="metric-sub">kg{data?.weight?.date ? ` · ${data.weight.date.slice(5)}` : ''}{data?.weight?.deltaGrams !== null && data?.weight?.deltaGrams !== undefined ? ` · ${data.weight.deltaGrams > 0 ? '+' : ''}${(data.weight.deltaGrams / 1000).toFixed(2)}kg` : ''}</p>
          <div className="fat-line">
            <span>体脂</span>
            {data?.bodyFat?.value !== null && data?.bodyFat?.value !== undefined
              ? <b>{data.bodyFat.value.toFixed(1)}%{data.bodyFat.source === 'local' ? <small> 本机</small> : null}</b>
              : <b className="no-value">—</b>}
          </div>
          <ProgressBar value={data?.weight?.latestKg ?? null} goal={data?.weight?.goalKg ?? null} unit="kg" />
          <div className="card-footer"><span>{data?.weight?.trend?.length ? `近 ${data.weight.trend.length} 次记录` : '暂无趋势'}</span><span>点箭头看趋势</span></div>
        </MetricCard>}
        {visible.battery && <MetricCard title="身体电量" className="battery-card" onOpen={() => openDetail('battery')}>
          <div className="metric-value"><Value value={data?.bodyBattery ?? null}/></div>
          <p className="metric-sub">当前 · {data?.bodyBatteryDetail?.highest !== null ? `今日 ${data?.bodyBatteryDetail?.lowest}–${data?.bodyBatteryDetail?.highest}` : ''}</p>
          <div className="bb-grid">
            <div><i>充能</i><b>+{data?.bodyBatteryDetail?.charged ?? '—'}</b></div>
            <div><i>消耗</i><b>−{data?.bodyBatteryDetail?.drained ?? '—'}</b></div>
            <div><i>晨起</i><b>{data?.bodyBatteryDetail?.atWakeTime ?? '—'}</b></div>
            <div><i>睡眠中</i><b>{data?.bodyBatteryDetail?.duringSleep !== null && data?.bodyBatteryDetail?.duringSleep !== undefined ? `+${data.bodyBatteryDetail.duringSleep}` : '—'}</b></div>
          </div>
          <div className="card-footer"><span>{data?.bodyBatteryDetail?.lowest !== null ? `最低 ${data?.bodyBatteryDetail?.lowest}` : '—'}</span><span>点箭头看趋势</span></div>
        </MetricCard>}
        {visible.intensity && <MetricCard title="活动强度" className="intensity-card" onOpen={() => openDetail('intensity')}>
          <div className="metric-value">{data?.intensity?.moderateMin !== null ? Math.round(((data?.intensity?.highlyActiveSec ?? 0) + (data?.intensity?.activeSec ?? 0)) / 60) : <span className="no-value">—</span>}</div>
          <p className="metric-sub">分钟 · 中高强度{data?.intensity?.goal ? ` / 目标 ${data.intensity.goal}` : ''}</p>
          <Ring size={92} thickness={10} center={data?.intensity?.sedentarySec !== null ? `${Math.round((data?.intensity?.sedentarySec ?? 0) / 3600)}h` : '—'} centerLabel="久坐"
            segments={[
              { value: data?.intensity?.sleepingSec ?? 0, color: '#8f7fc4', label: '睡眠' },
              { value: data?.intensity?.sedentarySec ?? 0, color: '#c5ccbb', label: '久坐' },
              { value: data?.intensity?.activeSec ?? 0, color: '#7ab58d', label: '活动' },
              { value: data?.intensity?.highlyActiveSec ?? 0, color: '#e5a34a', label: '高强度' },
            ]} />
          <div className="card-footer"><span>点箭头看趋势</span></div>
        </MetricCard>}
        {visible.stress && <MetricCard title="压力分布" className="stressdist-card" onOpen={() => openDetail('stressdist')}>
          <div className="metric-value"><Value value={data?.stress?.average ?? null}/></div>
          <p className="metric-sub">平均压力 · 0–100</p>
          <StackedBar total={86400} segments={[
            { value: data?.stressDetail?.restSec ?? 0, color: '#a8c8a0', label: '休息' },
            { value: data?.stressDetail?.lowSec ?? 0, color: '#d8d9a8', label: '低' },
            { value: data?.stressDetail?.mediumSec ?? 0, color: '#e5c07a', label: '中' },
            { value: data?.stressDetail?.highSec ?? 0, color: '#d9715f', label: '高' },
          ]} />
          <div className="card-footer"><strong>{data?.stress?.status || '暂无'}</strong><span>峰值 {data?.stress?.max ?? '—'}</span></div>
        </MetricCard>}
        <button className="add-card training-entry" onClick={() => setPage('training')}><Activity size={22}/><span>训练负荷 PMC</span><small>健康度 · 疲劳度 · 状态值</small></button>
        <button className="add-card training-entry" onClick={() => setPage('chat')}><MessageCircle size={22}/><span>AI 健康对话</span><small>基于你的真实数据分析</small></button>
        <button className="add-card" onClick={() => setSettings(true)}><Plus size={22}/><span>自定义卡片</span></button>
      </div>}
      {!extraOpen && <button className="extra-toggle bottom-extra" onClick={() => setExtraOpen(true)}><Plus size={14}/> 卡路里 / 心率等扩展卡片</button>}
    </main>
    <footer><span>MORU / 你的每日健康节奏</span><span>{data ? `更新于 ${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '正在连接 Garmin'}</span></footer>
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
    {settings && <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) setSettings(false); }}>
      <aside className="drawer" role="dialog" aria-label="自定义卡片">
        <header><div><h2>自定义卡片</h2><span>选择要在首页显示的扩展卡片</span></div><div className="drawer-controls"><button className="drawer-close" onClick={() => setSettings(false)} aria-label="关闭"><X size={18}/></button></div></header>
        <div className="card-toggles">
          <div className="metric-record">
            <div className="metric-record-head">
              <b>记录体重 / 体脂（{date}）</b>
              <span>Garmin 官方 API 是只读的，无法把数据写回佳明。这里填写的数值只保存在本机 <code>.local-metrics.json</code>，会显示在「体重 · 体脂」卡片里，并进入元宝健康摘要。可只填其中一项。</span>
            </div>
            <form onSubmit={async e => {
              e.preventDefault();
              const form = e.currentTarget;
              const inputs = form.querySelectorAll('input');
              const weight = (inputs[0] as HTMLInputElement).value;
              const fat = (inputs[1] as HTMLInputElement).value;
              const payload: Record<string, unknown> = { date };
              if (weight) payload.weightKg = Number(weight);
              if (fat) payload.bodyFat = Number(fat);
              if (!weight && !fat) { setToast('请至少填写体重或体脂其中一项'); return; }
              try {
                const res = await fetch('/api/metrics/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error || '保存失败');
                setToast('已保存到本机，卡片稍后刷新即可看到');
                form.reset();
                load(true);
              } catch (err) { setToast(err instanceof Error ? err.message : '保存失败'); }
            }}>
              <label className="metric-field">
                <span>体重 <em>kg</em></span>
                <input type="number" step="0.1" min="20" max="400" placeholder="例如 78.5" aria-label="体重的千克数"/>
              </label>
              <label className="metric-field">
                <span>体脂 <em>%</em></span>
                <input type="number" step="0.1" min="2" max="70" placeholder="例如 19.5" aria-label="体脂百分比"/>
              </label>
              <button type="submit" className="metric-save">保存到本机</button>
            </form>
            <div className="metric-record-tip">当前卡片显示：体重 {data?.weight?.latestKg?.toFixed(1) ?? '—'} kg · 体脂 {data?.bodyFat?.value !== null && data?.bodyFat?.value !== undefined ? `${data.bodyFat.value}%` : '—'}</div>
          </div>
          {Object.entries(CARD_META).map(([key, meta]) => <label key={key}>
            <input type="checkbox" checked={visible[key as keyof typeof visible]} onChange={() => toggleCard(key as keyof typeof visible)}/>
            <div><b>{meta.title}</b><span>{meta.desc}</span></div>
          </label>)}
        </div>
        <div className="drawer-hint">基础六卡（健身年龄、血氧、HRV、睡眠、压力、活动）始终显示；设置保存在本浏览器。</div>
      </aside>
    </div>}
    {detail && <DetailDrawer spec={detail} date={date} onClose={() => setDetail(null)}/>}
    {briefingOpen && <BriefingPanel date={date} onClose={() => setBriefingOpen(false)}/>}
  </div>;
}

function SleepStages({ data }: { data: DashboardData | null }) {
  const stages = [{ key: 'deep', label: '深睡', value: data?.sleep.deep, color: '#7774ba' }, { key: 'rem', label: 'REM', value: data?.sleep.rem, color: '#9b91d8' }, { key: 'light', label: '浅睡', value: data?.sleep.light, color: '#d5d6ed' }];
  const total = stages.reduce((sum, item) => sum + (item.value || 0), 0);
  return <div className="sleep-stages"><div className="stage-bar">{total ? stages.map(item => <span key={item.key} style={{ width: `${(item.value || 0) / total * 100}%`, background: item.color }}/>) : <span className="empty-stage"/>}</div><div className="stage-legend">{stages.map(item => <span key={item.key}><i style={{ background: item.color }}/>{item.label} {item.value ?? '—'}{item.value !== null && item.value !== undefined ? '分' : ''}</span>)}</div></div>;
}
function Timeline({ data }: { data: DashboardData | null }) {
  const now = new Date(); const isToday = data?.date === dateString(now); const hour = isToday ? now.getHours() + now.getMinutes() / 60 : 23;
  return <article className="panel timeline-panel"><div className="panel-title"><h2>今日时间线</h2><button aria-label="时间线说明" className="plus-button"><Plus size={18}/></button></div><div className="day-track"><div className="track-line"/><div className="current-time" style={{ left: `${Math.min(97, Math.max(2, hour / 24 * 100))}%` }}><span>{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span><i/></div>{data?.timeline.map((item, i) => <span key={i} className={`time-segment ${item.type}`} style={{ left: `${item.start / 24 * 100}%`, width: `${Math.max(1.5, (item.end - item.start) / 24 * 100)}%` }}/>)}</div><div className="hour-labels">{[0, 4, 8, 12, 16, 20, 24].map(h => <span key={h}>{String(h).padStart(2, '0')}</span>)}</div><div className="timeline-items">{data?.timeline.length ? data.timeline.map((item, i) => <div className="timeline-item" key={i}><i className={item.type}/><div className="timeline-copy"><strong>{item.type === 'sleep' ? <Moon size={14}/> : <Footprints size={14}/>} {item.title}</strong><span>{item.subtitle}</span></div><Zap size={12}/><span className="timeline-status">{item.status}</span></div>) : <Empty text="这一天没有同步的睡眠或活动记录"/>}</div>{data && data.activities.length > 0 && <div className="activity-detail">
      <h3>活动明细</h3>
      {data.activities.map(a => <div className="activity-row" key={a.id}>
        <div className="activity-head"><strong><Bike size={14}/> {a.name}</strong><span>{a.startLocal ? a.startLocal.slice(11, 16) : ''} · {formatDuration(a.durationSec)}</span></div>
        <div className="activity-metrics">
          {a.distanceKm !== null && <span><i>距离</i><b>{a.distanceKm} km</b></span>}
          {a.calories !== null && <span><i>消耗</i><b>{a.calories} kcal</b></span>}
          {a.avgHr !== null && <span><i>平均心率</i><b>{a.avgHr} bpm</b></span>}
          {a.maxHr !== null && <span><i>最大心率</i><b>{a.maxHr} bpm</b></span>}
          {a.trainingLoad !== null && <span><i>训练负荷</i><b>{a.trainingLoad.toFixed(1)}</b></span>}
          {a.aerobicEffect !== null && <span><i>有氧效果</i><b>{a.aerobicEffect.toFixed(1)}</b></span>}
          {a.elevationGainM !== null && <span><i>爬升</i><b>{a.elevationGainM} m</b></span>}
          {a.avgSpeedKmh !== null && <span><i>均速</i><b>{a.avgSpeedKmh} km/h</b></span>}
        </div>
        {a.hrZonesSec.some(z => z !== null && z > 0) && <div className="zone-bar">
          {a.hrZonesSec.map((z, idx) => z !== null && z > 0 ? <span key={idx} style={{ flex: z, background: ZONE_COLORS[idx] }} title={`${ZONE_LABELS[idx]} ${formatDuration(z)}`} /> : null)}
        </div>}
      </div>)}
    </div>}</article>;
}
const ZONE_LABELS = ['热身', '燃脂', '有氧', '阈值', '极限'];
const ZONE_COLORS = ['#9fb3c8', '#7fb3d5', '#7ab58d', '#e5a34a', '#d9715f'];
function formatDuration(sec: number | null) {
  if (sec === null) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec - h * 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}
function InsightRow({ item }: { item: Insight }) {
  const Icon = item.kind === 'steps' ? Footprints : item.kind === 'sleep' ? Moon : item.kind === 'heart' ? Heart : item.kind === 'fitness' ? Sparkles : Target;
  return <button className={`insight-row ${item.kind}`}><span className="insight-icon"><Icon size={18}/></span><span className="insight-copy"><strong>{item.title}</strong><small>{item.time}</small></span><ChevronRight size={14}/></button>;
}
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); setError(''); try { const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (!res.ok) throw new Error('密码不正确，请重试'); onSuccess(); } catch (err) { setError(err instanceof Error ? err.message : '登录失败'); } finally { setLoading(false); } };
  return <main className="login-page"><div className="login-brand">MORU<span>·</span></div><form onSubmit={submit} className="login-card"><div className="login-icon"><LockKeyhole size={25}/></div><p>你的健康，只属于你</p><h1>欢迎回来</h1><span>输入仪表盘密码以继续</span><label>访问密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus placeholder="••••••••••••"/></label>{error && <div className="login-error">{error}</div>}<button disabled={loading || !password}>{loading ? <LoaderCircle className="spin" size={18}/> : <ArrowRight size={18}/>} 进入健康概况</button><small>受密码保护 · 会话有效期 7 天</small></form></main>;
}
