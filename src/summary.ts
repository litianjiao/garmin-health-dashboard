import type { DashboardData } from './types';

const n = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? '暂无' : `${v}${unit}`);
const hours = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined) return '暂无';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec - h * 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
};

export interface SummaryPmc { ctl: number | null; atl: number | null; tsb: number | null; zone: string | null; ramp: number | null }

const mmss = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined) return '暂无';
  const h = Math.floor(sec / 3600), m = Math.floor((sec - h * 3600) / 60), s = Math.round(sec - h * 3600 - m * 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
};
const ZONE_NAMES = ['热身', '燃脂', '有氧', '阈值', '极限'];

export function makeSummary(data: DashboardData, pmc?: SummaryPmc | null) {
  const w = data.weight, bb = data.bodyBatteryDetail, it = data.intensity, sd = data.stressDetail, rd = data.respirationDay;
  const hasWeight = w?.latestKg !== null && w?.latestKg !== undefined;
  const lines: string[] = [];

  lines.push(`Garmin 每日健康摘要（${data.date}）`);
  lines.push(`数据来源：${data.source === 'demo' ? '演示数据，非真实健康记录' : 'Garmin Connect 官方 Personal API'}`);

  lines.push('');
  lines.push('【活动】');
  lines.push(`步数 ${n(data.activity.steps, ' 步')}，距离 ${n(data.activity.distanceKm, ' km')}，目标 ${n(data.activity.goal, ' 步')}。`);
  if (data.calories?.total !== null && data.calories?.total !== undefined) {
    lines.push(`卡路里：总消耗 ${n(data.calories.total, ' kcal')}（基础 ${n(data.calories.resting, ' kcal')} + 活动 ${n(data.calories.active, ' kcal')}）。`);
  }
  if (it && (it.sedentarySec !== null || it.activeSec !== null)) {
    lines.push(`全天时间分布：睡眠 ${hours(it.sleepingSec)}，久坐 ${hours(it.sedentarySec)}，低强度活动 ${hours(it.activeSec)}，高强度活动 ${hours(it.highlyActiveSec)}（四项合计约 24 小时）。`);
    lines.push(`强度分钟：中等强度 ${n(it.moderateMin, ' 分钟')}，高强度 ${n(it.vigorousMin, ' 分钟')}，目标 ${n(it.goal, ' 分钟')}（此处的强度分钟为 Garmin 另一口径，与上面的时间分布不同）。`);
  }

  if (data.activities.length) {
    lines.push('');
    lines.push('【今日活动明细】');
    data.activities.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.name}（${a.startLocal ? a.startLocal.slice(11, 16) : '时间未知'}）`);
      const parts: string[] = [];
      parts.push(`时长 ${mmss(a.durationSec)}`);
      if (a.distanceKm !== null) parts.push(`距离 ${a.distanceKm} km`);
      if (a.avgSpeedKmh !== null) parts.push(`平均配速/速度 ${a.avgSpeedKmh} km/h`);
      if (a.calories !== null) parts.push(`消耗 ${a.calories} kcal`);
      lines.push(`   ${parts.join(' · ')}`);
      const hr: string[] = [];
      if (a.avgHr !== null) hr.push(`平均心率 ${a.avgHr} bpm`);
      if (a.maxHr !== null) hr.push(`最大心率 ${a.maxHr} bpm`);
      if (hr.length) lines.push(`   ${hr.join(' · ')}`);
      const zones = a.hrZonesSec.map((z, idx) => ({ z, idx })).filter(o => o.z !== null && o.z > 0);
      if (zones.length) {
        lines.push(`   心率区间：${zones.map(o => `${ZONE_NAMES[o.idx]} ${mmss(o.z)}`).join('，')}`);
      }
      const effect: string[] = [];
      if (a.aerobicEffect !== null) effect.push(`有氧训练效果 ${a.aerobicEffect.toFixed(1)}`);
      if (a.anaerobicEffect !== null) effect.push(`无氧训练效果 ${a.anaerobicEffect.toFixed(1)}`);
      if (a.trainingLoad !== null) effect.push(`训练负荷 ${a.trainingLoad.toFixed(1)}`);
      if (effect.length) lines.push(`   ${effect.join(' · ')}`);
      if (a.elevationGainM !== null) lines.push(`   累计爬升 ${a.elevationGainM} m`);
      if (a.staminaUsed !== null) lines.push(`   体能消耗 ${a.staminaUsed}%`);
    });
  }

  lines.push('');
  lines.push('【睡眠】');
  lines.push(`总睡眠 ${data.sleep.hours !== null ? data.sleep.hours.toFixed(1) + ' 小时' : '暂无'}，评分 ${n(data.sleep.score)}；${data.sleep.start ? `入睡 ${data.sleep.start}–${data.sleep.end}。` : ''}`);
  if (data.sleep.deep !== null || data.sleep.rem !== null || data.sleep.light !== null) {
    lines.push(`睡眠阶段：深睡 ${n(data.sleep.deep, ' 分')}，REM ${n(data.sleep.rem, ' 分')}，浅睡 ${n(data.sleep.light, ' 分')}，清醒 ${n(data.sleep.awake, ' 分')}。`);
  }

  lines.push('');
  lines.push('【恢复与心血管】');
  lines.push(`HRV ${n(data.hrv.lastNight, ' ms')}（周均 ${n(data.hrv.weekly, ' ms')}，基线 ${n(data.hrv.baselineLow)}–${n(data.hrv.baselineHigh)}，状态 ${data.hrv.status || '暂无'}）。`);
  lines.push(`心率：静息 ${n(data.restingHeartRate, ' bpm')}，最高 ${n(data.heartRateMax, ' bpm')}。`);
  if (bb && (bb.charged !== null || bb.highest !== null)) {
    lines.push(`身体电量：当前 ${n(data.bodyBattery)}，今日充能 +${n(bb.charged)} / 消耗 −${n(bb.drained)}，区间 ${n(bb.lowest)}–${n(bb.highest)}，晨起 ${n(bb.atWakeTime)}，睡眠中恢复 +${n(bb.duringSleep)}。`);
  } else {
    lines.push(`身体电量：${n(data.bodyBattery)}。`);
  }

  lines.push('');
  lines.push('【血氧与呼吸】');
  lines.push(`血氧：最新 ${n(data.spo2.latest, '%')}，平均 ${n(data.spo2.average, '%')}，最低 ${n(data.spo2.min, '%')}。`);
  lines.push(`呼吸：睡眠期均值 ${n(data.respiration, ' rpm')}${rd ? `，清醒期均值 ${n(rd.avgWaking, ' rpm')}（区间 ${n(rd.lowest)}–${n(rd.highest)} rpm）` : ''}。`);

  lines.push('');
  lines.push('【压力】');
  lines.push(`平均 ${n(data.stress.average)}，峰值 ${n(data.stress.max)}，状态 ${data.stress.status || '暂无'}。`);
  if (sd && (sd.restSec !== null || sd.highSec !== null)) {
    lines.push(`压力时长分布：休息 ${hours(sd.restSec)}，低 ${hours(sd.lowSec)}，中 ${hours(sd.mediumSec)}，高 ${hours(sd.highSec)}。`);
  }

  if (hasWeight || data.bodyFat?.value !== null) {
    lines.push('');
    lines.push('【体重与体成分】');
    if (hasWeight) {
      // weightDelta 是与 Garmin 基准的差值，不等于相邻两次之差；相邻变化由趋势记录计算
      const trend = w?.trend ?? [];
      let delta = '';
      if (trend.length >= 2) {
        const diff = trend[trend.length - 1].kg - trend[trend.length - 2].kg;
        delta = `，较上次记录 ${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg（上次 ${trend[trend.length - 2].kg.toFixed(1)} kg）`;
      }
      lines.push(`体重 ${w!.latestKg!.toFixed(1)} kg（${w?.date ?? '暂无日期'}${delta}）。`);
      lines.push(`体重目标 ${n(w?.goalKg, ' kg')}${w?.goalKg !== null && hasWeight ? `，当前距目标 ${(w!.latestKg! - w!.goalKg!).toFixed(1)} kg` : ''}。`);
    } else {
      lines.push('体重：暂无记录（Garmin 官方 API 只读，可在本机手动记录）。');
    }
    lines.push(`体脂：${data.bodyFat?.value !== null && data.bodyFat?.value !== undefined ? `${data.bodyFat.value}%（来源：${data.bodyFat.source === 'local' ? '本机手动记录' : 'Garmin'}）` : '暂无（官方接口无此数据；需 Garmin 体脂秤、App 手动录入，或在本仪表盘「自定义卡片」里记录）'}。`);
  }

  if (pmc && (pmc.ctl !== null || pmc.atl !== null)) {
    lines.push('');
    lines.push('【训练负荷（PMC）】');
    lines.push(`健康度 CTL ${n(pmc.ctl)}（42 天指数加权平均负荷，代表长期体能底子）。`);
    lines.push(`疲劳度 ATL ${n(pmc.atl)}（7 天指数加权平均负荷，代表近期累积疲劳）。`);
    lines.push(`状态值 TSB ${n(pmc.tsb)}${pmc.zone ? `（${pmc.zone}）` : ''}；CTL − ATL，负值表示正在承受训练量，正值表示近期负荷回落。`);
    lines.push(`周爬升 ${n(pmc.ramp)}；CTL 缓慢上升才是稳定进步。`);
  }

  if (data.insights.length) {
    lines.push('');
    lines.push('【近期观察】');
    data.insights.forEach(i => lines.push(`- ${i.title}`));
  }

  lines.push('');
  lines.push('说明：以上数值均来自 Garmin Connect 官方接口；"暂无"表示该设备/账号未记录此项，不是零。');
  lines.push('请基于以上数据进行一般性健康趋势分析，不作医疗诊断；如数据缺失请明确指出。');

  return lines.join('\n');
}
