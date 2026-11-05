import type { DashboardData, DashboardExtended } from './types';

// AI 对话工具：把仪表盘真实数据交给 LLM 分析（与 APK 的 get_garmin_day/get_garmin_trends 对应）
export function garminDayToolData(data: DashboardData) {
  return {
    date: data.date,
    source: data.source,
    fitnessAge: data.profile.fitnessAge,
    actualAge: data.profile.actualAge,
    achievableFitnessAge: data.profile.achievableAge,
    restingHeartRate: data.restingHeartRate,
    respiration: data.respiration,
    bodyBattery: data.bodyBattery,
    spo2: data.spo2,
    hrv: data.hrv,
    sleep: data.sleep,
    stress: data.stress,
    activity: data.activity,
    calories: data.calories,
    heartRateMax: data.heartRateMax,
    timeline: data.timeline,
  };
}

export function garminTrendsToolData(data: DashboardExtended) {
  return {
    rangeDays: data.range,
    endDate: data.endDate,
    averages: data.averages,
    latestSleep: data.latestSleep,
    days: data.days,
  };
}

export const AI_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'get_garmin_day',
      description: '读取某一天的 Garmin 健康与活动完整指标（含睡眠阶段、HRV、压力、身体电量、卡路里等）。字段为 null 表示无数据，不是零。',
      parameters: { type: 'object', properties: { _unused: { type: 'string', description: '无需传参，自动使用当前查看的日期' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_garmin_trends',
      description: '读取最多 30 天的健康趋势（每日睡眠/步数/HRV/压力/卡路里/心率及均值）。',
      parameters: { type: 'object', properties: { _unused: { type: 'string', description: '无需传参，自动使用当前日期' } } },
    },
  },
];
