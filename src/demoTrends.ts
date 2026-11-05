import type { DashboardExtended } from '../src/types';

export function demoTrends(range: 7 | 30 = 7): DashboardExtended {
  const days = Array.from({ length: range }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (range - 1 - i));
    const date = d.toISOString().slice(0, 10);
    const wave = Math.sin(i / 2) * 30 + Math.sin(i / 5) * 20;
    return {
      date,
      steps: Math.round(10000 + wave * 80),
      stepGoal: 9500,
      distanceKm: Math.round((7.5 + wave / 15) * 10) / 10,
      floors: Math.round(8 + wave / 8),
      caloriesResting: 2050,
      caloriesActive: Math.round(600 + wave * 6),
      caloriesTotal: Math.round(2650 + wave * 6),
      restingHeartRate: Math.round(54 + wave / 20),
      heartRateMax: Math.round(130 + wave),
      stress: Math.round(30 + wave / 2),
      stressMax: Math.round(80 + wave),
      hrv: Math.round(58 + wave / 2),
      intensityMinutes: Math.round(60 + wave),
      intensityGoal: 150,
      sleepHours: Math.round((6.8 + wave / 30) * 10) / 10,
      sleepScore: Math.round(75 + wave / 3),
      sleepDeepMin: Math.round(60 + wave / 3),
      sleepRemMin: Math.round(100 + wave / 2),
      sleepLightMin: Math.round(200 + wave),
      sleepAwakeMin: 12,
      sleepNapMin: 0,
      sleepSpO2: 96,
      sleepRespiration: 14,
      sleepStart: '23:30',
      sleepEnd: '07:10',
      sleepAvgHeartRate: 57,
      sleepAvgStress: 12,
      sleepAwakeCount: 1,
      sleepNeedMin: 420,
      sleepFeedback: 'POSITIVE_RECOVERING',
      sleepRespirationLow: 12,
      sleepRespirationHigh: 18,
      sleepSpO2High: 99,
      weightKg: i % 3 === 0 ? Math.round((79 - i * 0.15) * 10) / 10 : null,
      bodyFatPercent: null,
      batteryCharged: Math.round(60 + Math.sin(i / 2) * 10),
      batteryDrained: Math.round(70 + Math.sin(i / 3) * 12),
      batteryHighest: Math.round(82 + Math.sin(i / 2) * 6),
      batteryLowest: Math.round(14 + Math.sin(i / 3) * 5),
      batteryAtWakeTime: null,
      batteryDuringSleep: null,
      sedentarySec: Math.round(60000 + Math.sin(i / 2) * 6000),
      activeSec: Math.round(5500 + Math.sin(i / 3) * 1500),
      highlyActiveSec: Math.round(120 + Math.sin(i) * 60),
      sleepingSec: Math.round(18000 + Math.sin(i / 2) * 2400),
      stressRestSec: Math.round(34000 + Math.sin(i / 2) * 5000),
      stressLowSec: Math.round(25000 + Math.sin(i / 3) * 4000),
      stressMediumSec: Math.round(7000 + Math.sin(i / 2) * 2000),
      stressHighSec: Math.round(1000 + Math.sin(i) * 400),
      respirationAvg: Math.round((17 + Math.sin(i / 3)) * 10) / 10,
    };
  });
  const avg = (field: 'steps' | 'sleepHours' | 'hrv' | 'stress' | 'caloriesTotal' | 'caloriesActive' | 'restingHeartRate' | 'sleepScore' | 'sleepDeepMin' | 'sleepRemMin' | 'sleepLightMin' | 'sleepAwakeMin' | 'floors'): number | null => {
    const list = days.map(d => d[field]).filter((v): v is number => v !== null);
    return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 10) / 10 : null;
  };
  return {
    range, endDate: new Date().toISOString().slice(0, 10),
    averages: {
      steps: avg('steps'), sleepHours: avg('sleepHours'), hrv: avg('hrv'), stress: avg('stress'),
      caloriesTotal: avg('caloriesTotal'), caloriesActive: avg('caloriesActive'), restingHeartRate: avg('restingHeartRate'),
      sleepScore: avg('sleepScore'), deepMin: avg('sleepDeepMin'), remMin: avg('sleepRemMin'),
      lightMin: avg('sleepLightMin'), awakeMin: avg('sleepAwakeMin'), floors: avg('floors'),
    },
    latestSleep: { start: '23:30', end: '07:10' },
    days,
    allWeights: days.filter(d => d.weightKg !== null).map(d => ({ date: d.date, kg: d.weightKg!, bodyFat: d.bodyFatPercent })),
  };
}
