import { useEffect, useState } from 'react';

const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function api(path:string, method?:string, body?:unknown) {
  const r = await fetch('/api/push/'+path, method ? {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : undefined);
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || `请求失败 (${r.status})`);
  return r.status===204 ? null : await r.json();
}
function vapidBytes(value:string) {
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
}
export function PhonePushSettings() {
  const [pub,setPub] = useState(''), [sub,setSub] = useState<PushSubscription|null>(null);
  const [busy,setBusy] = useState(true), [message,setMessage] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      if (!supported()) { if (active) setMessage('请在手机系统浏览器通过 HTTPS 打开。iPhone 请从主屏幕图标进入。'); return; }
      const cfg = await api('config');
      if (!cfg.publicKey) { if (active) setMessage('Mac 服务端尚未配置 Web Push。'); return; }
      await navigator.serviceWorker.register('/moru-sw.js');
      const reg = await navigator.serviceWorker.ready;
      let existing = await reg.pushManager.getSubscription();
      const oldKey = existing?.options.applicationServerKey;
      if (existing && oldKey && String(new Uint8Array(oldKey)) !== String(vapidBytes(cfg.publicKey))) {
        await api('subscription','DELETE',{endpoint:existing.endpoint});
        await existing.unsubscribe(); existing = null;
        if (active) setMessage('服务端已更换推送密钥，请重新订阅本设备。');
      }
      if (existing && Notification.permission === 'granted') await api('subscription','POST',existing.toJSON());
      if (active) { setPub(cfg.publicKey); setSub(existing); }
    })().catch(e=>{ if(active) setMessage(e.message); }).finally(()=>{ if(active) setBusy(false); });
    return () => { active=false; };
  },[]);
  async function action(kind:'enable'|'disable'|'test') {
    setBusy(true); setMessage('');
    try {
      if (kind==='enable') {
        // Permission must be requested directly from this tap, not from background polling.
        if (await Notification.requestPermission() !== 'granted') throw new Error('未获通知权限，可在系统设置中调整。');
        const reg = await navigator.serviceWorker.ready;
        const candidate = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(pub)});
        try { await api('subscription','POST',candidate.toJSON()); }
        catch (e) { await candidate.unsubscribe(); throw e; }
        setSub(candidate); setMessage('已订阅；可发一条测试通知。');
      } else if (sub && kind==='disable') {
        await api('subscription','DELETE',{endpoint:sub.endpoint});
        await sub.unsubscribe(); setSub(null); setMessage('本设备已取消订阅。');
      } else if (sub && kind==='test') {
        await api('test','POST',{endpoint:sub.endpoint});
        setMessage('推送服务已受理，请在手机通知中心确认是否收到。');
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <div className="briefing-setting-note"><b>手机后台通知</b><p>页面关闭后仍可接收。锁屏只显示就绪提醒，不包含健康读数。</p>
    {pub && <div className="phone-push-actions"><button disabled={busy} onClick={()=>action(sub?'disable':'enable')}>{sub?'取消本设备订阅':'订阅本设备'}</button>
      {sub && <button disabled={busy} onClick={()=>action('test')}>发送测试通知</button>}</div>}
    {message && <p role="status">{message}</p>}</div>;
}
