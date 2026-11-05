import type { DashboardData } from './types';

export function demoData(date = new Date().toISOString().slice(0, 10)): DashboardData {
  return {
    date, source: 'demo', updatedAt: new Date().toISOString(),
    profile: { name: (typeof process !== 'undefined' && process.env?.DISPLAY_NAME) || 'ZAX', actualAge: 28, fitnessAge: 25, vo2max: 52, achievableAge: 22 },
    bodyBattery: 19,
    spo2: { latest: 92, min: 85, average: 96, history: [92, 93, 92, 94, 93, 95, 94, 96, 95] },
    respiration: 18, restingHeartRate: 73,
    hrv: { lastNight: 68, weekly: 64, baselineLow: 48, baselineHigh: 72, status: '平衡', history: [45, 48, 52, 55, 51, 57, 61, 65, 59, 69, 64, 67, 62] },
    sleep: { hours: 8.3, score: 85, start: '01:06', end: '09:24', deep: 70, rem: 117, light: 310, awake: 0 },
    stress: { average: 33, max: 100, status: '平衡' },
    activity: { steps: 16393, distanceKm: 12.9, goal: 14460, history: [66, 64, 47, 44, 55, 79, 88] },
    calories: { total: 2690, resting: 2053, active: 637 },
    heartRateMax: 121,
    weight: { latestKg: 78.8, date, deltaGrams: -600, goalKg: 70, trend: [{ date: '2026-10-26', kg: 79.4 }, { date: '2026-10-27', kg: 78.8 }] },
    bodyFat: { value: null, source: null, date: null },
    bodyBatteryDetail: { charged: 69, drained: 69, highest: 80, lowest: 16, atWakeTime: 80, duringSleep: 63 },
    intensity: { highlyActiveSec: 124, activeSec: 5829, sedentarySec: 62147, sleepingSec: 18300, moderateMin: 30, vigorousMin: 0, goal: 150 },
    stressDetail: { restSec: 36600, lowSec: 25380, mediumSec: 7140, highSec: 1200, activitySec: 8460, uncategorizedSec: 7560 },
    respirationDay: { avgWaking: 17, highest: 23, lowest: 8 },
    timeline: [
      { type: 'sleep', title: '睡眠', subtitle: '01:06 – 09:24 · 睡眠恢复', start: 1.1, end: 9.4, status: '已完成' },
      { type: 'activity', title: '步行', subtitle: '20:07 – 21:28 · 步行', start: 20.12, end: 21.47, status: '已完成' },
    ],
    insights: [
      { title: '步数达成 113%，超额完成今日目标', time: '今天', kind: 'steps' },
      { title: '睡眠 85 分良好，睡了 8.3 小时', time: '昨晚', kind: 'sleep' },
      { title: 'HRV 68 ms 平衡，恢复状态不错', time: '昨晚', kind: 'heart' },
      { title: '健身年龄 25，比实际年轻 3 岁', time: '今天', kind: 'fitness' },
      { title: '训练准备度暂无 Garmin 数据', time: '今天', kind: 'training' },
    ],
    activities: [{
      id: 1, name: '步行', typeKey: 'walking', startLocal: '20:07:00', durationSec: 4860,
      distanceKm: 12.9, calories: 637, avgHr: 102, maxHr: 121, trainingLoad: 45.2,
      aerobicEffect: 2.5, anaerobicEffect: 0.4, effectLabel: 'AEROBIC_BASE',
      moderateMin: 30, vigorousMin: 0, hrZonesSec: [1200, 2400, 900, 360, 0],
      elevationGainM: 35, avgSpeedKmh: 9.6, staminaUsed: 12,
    }],
  };
}
