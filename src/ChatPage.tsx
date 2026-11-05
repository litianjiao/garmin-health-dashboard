import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Check, CornerDownLeft, LoaderCircle, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react';

interface Msg { role: 'user' | 'assistant'; content: string; toolNames?: string[] }
interface ModelEntry { id: string; name: string; source: 'upstream' | 'custom'; credits?: string; supportsToolCall?: boolean; enabled: boolean }
interface ModelsState {
  current: string; configured: boolean; baseUrl: string; modelSource: string; upstreamTotal: number;
  models: ModelEntry[];
}

export function ChatPage({ date, onBack }: { date: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem('moru-chat') || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [serverModel, setServerModel] = useState('');
  const [showManage, setShowManage] = useState(false);
  const [models, setModels] = useState<ModelsState | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    fetch('/api/ai/config').then(r => r.json()).then(c => { setConfigured(c.configured); setServerModel(c.model || ''); }).catch(() => setConfigured(false));
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2500); return () => clearTimeout(id); }, [toast]);

  const loadModels = async () => {
    setModelsLoading(true); setModelsError('');
    try {
      const res = await fetch('/api/ai/models');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '加载失败');
      setModels(body);
      setServerModel(body.current || '');
    } catch (err) { setModelsError(err instanceof Error ? err.message : '网络错误'); }
    finally { setModelsLoading(false); }
  };
  useEffect(() => { if (showManage) loadModels(); }, [showManage]);

  const manage = async (action: string, payload: Record<string, string> = {}, method = 'POST') => {
    try {
      const url = `/api/ai/models/${action}${method === 'DELETE' ? '?id=' + encodeURIComponent(payload.id || '') : ''}`;
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '操作失败');
      await loadModels();
      setToast('已更新');
      return true;
    } catch (err) { setModelsError(err instanceof Error ? err.message : '操作失败'); return false; }
  };

  const persist = (msgs: Msg[]) => { setMessages(msgs); try { localStorage.setItem('moru-chat', JSON.stringify(msgs.slice(-50))); } catch { /* 隐私模式忽略 */ } };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError(''); setBusy(true);
    const history = [...messages, { role: 'user' as const, content: text.trim() }];
    persist([...history]); setInput('');
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, messages: history.map(m => ({ role: m.role, content: m.content })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'AI 请求失败');
      persist([...history, { role: 'assistant', content: body.reply || '(空回复)', toolNames: [] }]);
    } catch (err) { setError(err instanceof Error ? err.message : '网络错误'); persist(history); }
    finally { setBusy(false); }
  };

  const currentName = models?.models.find(m => m.id === models.current)?.name || models?.current || serverModel || '未设置';

  return <div className="chat-page">
    <div className="chat-bar">
      <button onClick={onBack}><ArrowLeft size={16}/> 返回</button>
      <div><h1>健康对话</h1><p>当前模型：<b>{currentName}</b> · 可查询你的 Garmin 数据</p></div>
      <div className="chat-actions">
        <button className="chat-icon" onClick={() => setShowManage(true)} aria-label="模型管理"><Settings2 size={16}/></button>
        <button className="chat-icon" onClick={() => { if (messages.length && confirm('清空全部对话记录？')) persist([]); }} aria-label="清空对话" disabled={!messages.length}><Trash2 size={16}/></button>
      </div>
    </div>
    {configured === false && <div className="chat-setup">
      <p>还没有配置 AI 服务。请在 <code>G:\garmin\.env</code> 填入 AI_BASE_URL 和 AI_API_KEY 后重启服务。</p>
      <button onClick={() => setShowManage(true)}>查看模型管理</button>
    </div>}
    <div className="chat-list" ref={listRef}>
      {!messages.length && <div className="chat-empty">
        <Bot size={44} strokeWidth={1.3}/>
        <h2>让数据，变成懂你的建议。</h2>
        <p>睡得怎样，练得合适吗？从你关心的一件小事开始聊。</p>
        <div className="chat-suggests">
          <button onClick={() => send('看看我最近 7 天睡得怎么样？')}>最近 7 天睡得怎么样？</button>
          <button onClick={() => send('结合我的数据，今天适合怎么运动？')}>今天适合怎么运动？</button>
          <button onClick={() => send('最近的 HRV 和恢复状态有什么变化？')}>HRV 和恢复状态有什么变化？</button>
        </div>
        <small>发送问题时，查询到的 Garmin 数据会交给所配置的 AI 服务分析。对话记录仅保存在本浏览器。</small>
      </div>}
      {messages.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}>
        <span className="chat-avatar">{m.role === 'user' ? <User size={15}/> : <Bot size={15}/>}</span>
        <div className="chat-bubble">{m.content.split('\n').map((line, j) => <p key={j}>{line}</p>)}</div>
      </div>)}
      {busy && <div className="chat-msg assistant"><span className="chat-avatar"><Bot size={15}/></span><div className="chat-bubble"><span className="chat-typing"><LoaderCircle className="spin" size={14}/> 正在思考（可能需要查询你的数据）…</span></div></div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <form className="chat-input" onSubmit={e => { e.preventDefault(); send(input); }}>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="想了解身体的哪一点？" disabled={busy}/>
      <button type="submit" disabled={busy || !input.trim()} aria-label="发送"><CornerDownLeft size={17}/></button>
    </form>
    {toast && <div className="chat-toast"><Check size={14}/> {toast}</div>}

    {showManage && <div className="drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowManage(false); }}>
      <aside className="drawer model-drawer" role="dialog" aria-label="AI 模型管理">
        <header><div><h2>AI 模型管理</h2><span>切换当前对话模型、增删自定义模型</span></div><div className="drawer-controls">
          <button className="drawer-close" onClick={loadModels} aria-label="刷新列表"><RefreshCw size={16}/></button>
          <button className="drawer-close" onClick={() => setShowManage(false)} aria-label="关闭"><X size={18}/></button>
        </div></header>
        {modelsLoading && <div className="drawer-loading">正在从 AI 服务获取模型列表…</div>}
        {modelsError && <div className="drawer-error">{modelsError}</div>}
        {models && <>
          <div className="model-summary">
            <div><span>当前使用</span><b>{models.current || '未设置'}</b></div>
            <div><span>服务端地址</span><b>{models.baseUrl || '未配置'}</b></div>
            <div><span>可用模型</span><b>{models.models.length} 个</b></div>
          </div>
          <div className="model-section-title">模型列表 <small>点击"设为当前"切换；上游模型可隐藏（可恢复）</small></div>
          <div className="model-list">
            {models.models.length === 0 && <div className="drawer-hint">没有可用模型。服务未配置，或上游返回为空。</div>}
            {models.models.map(m => <div key={m.id} className={`model-row ${models.current === m.id ? 'active' : ''}`}>
              <div className="model-info">
                <b>{m.name}</b>
                <code>{m.id}</code>
                <span className="model-tags">
                  {m.source === 'upstream' ? '服务端' : '自定义'}
                  {m.credits ? ` · ${m.credits}` : ''}
                  {m.supportsToolCall ? ' · 支持工具调用' : ''}
                </span>
              </div>
              <div className="model-actions">
                {models.current === m.id
                  ? <span className="model-current"><Check size={13}/> 使用中</span>
                  : <button onClick={() => manage('current', { id: m.id })}>设为当前</button>}
                {m.source === 'custom'
                  ? <button className="danger" onClick={() => { if (confirm(`删除自定义模型 ${m.id}？`)) manage('custom', { id: m.id }, 'DELETE'); }} aria-label="删除"><Trash2 size={14}/></button>
                  : <button className="ghost" onClick={() => { if (confirm(`隐藏上游模型 ${m.id}？之后可在下方恢复`)) manage('hide', { id: m.id }); }} aria-label="隐藏"><X size={14}/></button>}
              </div>
            </div>)}
          </div>
          <div className="model-section-title">添加自定义模型 <small>用于服务端未列出的模型名，只需填 ID</small></div>
          <form className="model-add" onSubmit={async e => {
            e.preventDefault();
            if (!newId.trim()) return;
            const ok = await manage('custom', { id: newId.trim(), name: newName.trim() });
            if (ok) { setNewId(''); setNewName(''); }
          }}>
            <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="模型 ID（必填），如 gpt-4o"/>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="显示名称（可选）"/>
            <button type="submit" disabled={!newId.trim()}><Plus size={15}/> 添加</button>
          </form>
          {models.upstreamTotal > models.models.filter(m => m.source === 'upstream').length && <div className="model-hidden">
            <div className="model-section-title">已隐藏的上游模型</div>
            <button onClick={async () => { await manage('unhide', { id: '__all__' }); }}>恢复全部</button>
          </div>}
          <div className="drawer-hint">切换模型后立即生效，无需重启服务。凭据（API Key）仍保存在服务端 .env，不进入浏览器。</div>
        </>}
      </aside>
    </div>}
  </div>;
}

function User({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>;
}
