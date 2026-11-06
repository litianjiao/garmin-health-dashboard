import { useState } from 'react';
import { offsetDate, type HistoryView } from './personalHistory';
import { HABIT_WINDOW, MIN_GROUP, habitContrast } from './habitComparison';
export function HabitLog({view,onChange}:{view:HistoryView;onChange:()=>void}) {
  const [logDate,setLogDate] = useState(offsetDate(view.date,-1)), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const habits = view.habits ?? [], current = habits.find(h=>h.date===logDate)?.lateCaffeine ?? null;
  async function save(flag:boolean|null) {
    setBusy(true);
    try {
      const res = await fetch('/api/history/habits/'+logDate,{ method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({lateCaffeine:flag}) });
      if (!res.ok) throw new Error('记录未保存');
      onChange(); setMessage(`${logDate} 已${flag===null?'清除记录':'保存'}。`);
    } catch(e) {setMessage(e instanceof Error?e.message:'记录未保存');} finally {setBusy(false);}
  }
  return <details className="habit-log"><summary>习惯对照 · 晚间咖啡因</summary>
    <p>选一天，记下当晚 18:00 后是否喝过含咖啡因的饮品；不知道就留空。</p>
    <label>记录日期 <input type="date" value={logDate} min={offsetDate(view.date,-HABIT_WINDOW)} max={view.date}
      onChange={e=>{setLogDate(e.target.value);setMessage('');}}/></label>
    <p>{([[true,'有'],[false,'无'],[null,'未记录']] as const).map(([flag,label])=>
      <button key={label} type="button" aria-pressed={current===flag} disabled={busy||!logDate} onClick={()=>save(flag)}>{label}</button>)}</p>
    {message && <p role="status">{message}</p>}
    {(['hrv','restingHeartRate'] as const).map(field=>{
      const v = habitContrast(view.days,habits,view.date,field), unit=field==='hrv'?'ms':'bpm';
      return <p key={field}><b>次日{field==='hrv'?' HRV':'静息心率'}</b> · 有 {v.yesCount} 天 / 无 {v.noCount} 天。
        {v.yes===null||v.no===null?`两组各满 ${MIN_GROUP} 天再比较。`:
          `两组中位数 ${v.yes} / ${v.no} ${unit}，差值 ${Number((v.yes-v.no).toFixed(1))} ${unit}（有减无）。`}</p>;
    })}
    <p>最近 {HABIT_WINDOW} 晚，只比较明确记录且次日有读数的样本。睡眠、运动和记录习惯也会影响结果；这不是因果判断。</p>
  </details>;
}
