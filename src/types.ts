export interface TimelineItem {
  type: 'sleep' | 'activity';
  title: string;
  subtitle: string;
  start: number;
  end: number;
  status: string;
}

export interface Insight {
  title: string;
  time: string;
  kind: 'steps' | 'sleep' | 'heart' | 'fitness' | 'training';
}

export interface DashboardData {
  date: string;
  source: 'garmin' | 'demo';
  updatedAt: string;
  profile: { name: string; actualAge: number | null; fitnessAge: number | null; vo2max: number | null; achievableAge: number | null };
  bodyBattery: number | null;
  spo2: { latest: number | null; min: number | null; average: number | null; history: number[] };
  respiration: number | null;
  restingHeartRate: number | null;
  hrv: { lastNight: number | null; weekly: number | null; baselineLow: number | null; baselineHigh: number | null; status: string; history: number[] };
  sleep: { hours: number | null; score: number | null; start: string | null; end: string | null; deep: number | null; rem: number | null; light: number | null; awake: number | null };
  stress: { average: number | null; max: number | null; status: string };
  activity: { steps: number | null; distanceKm: number | null; goal: number | null; history: number[] };
  calories: { total: number | null; resting: number | null; active: number | null };
  heartRateMax: number | null;
  weight: { latestKg: number | null; date: string | null; deltaGrams: number | null; goalKg: number | null; trend: Array<{ date: string; kg: number }> };
  bodyFat: { value: number | null; source: 'garmin' | 'local' | null; date: string | null };
  bodyBatteryDetail: { charged: number | null; drained: number | null; highest: number | null; lowest: number | null; atWakeTime: number | null; duringSleep: number | null };
  intensity: { highlyActiveSec: number | null; activeSec: number | null; sedentarySec: number | null; sleepingSec: number | null; moderateMin: number | null; vigorousMin: number | null; goal: number | null };
  stressDetail: { restSec: number | null; lowSec: number | null; mediumSec: number | null; highSec: number | null; activitySec: number | null; uncategorizedSec: number | null };
  respirationDay: { avgWaking: number | null; highest: number | null; lowest: number | null };
  timeline: TimelineItem[];
  insights: Insight[];
  activities: ActivitySummary[];
}

export interface ActivitySummary {
  id: number;
  name: string;
  typeKey: string;
  startLocal: string | null;
  durationSec: number | null;
  distanceKm: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  trainingLoad: number | null;
  aerobicEffect: number | null;
  anaerobicEffect: number | null;
  effectLabel: string | null;
  moderateMin: number | null;
  vigorousMin: number | null;
  hrZonesSec: Array<number | null>;
  elevationGainM: number | null;
  avgSpeedKmh: number | null;
  staminaUsed: number | null;
}

export interface DayDetail {
  date: string;
  steps: number | null;
  stepGoal: number | null;
  distanceKm: number | null;
  floors: number | null;
  caloriesResting: number | null;
  caloriesActive: number | null;
  caloriesTotal: number | null;
  restingHeartRate: number | null;
  heartRateMax: number | null;
  stress: number | null;
  stressMax: number | null;
  hrv: number | null;
  intensityMinutes: number | null;
  intensityGoal: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  sleepDeepMin: number | null;
  sleepRemMin: number | null;
  sleepLightMin: number | null;
  sleepAwakeMin: number | null;
  sleepNapMin: number | null;
  sleepSpO2: number | null;
  sleepRespiration: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  sleepAvgHeartRate: number | null;
  sleepAvgStress: number | null;
  sleepAwakeCount: number | null;
  sleepNeedMin: number | null;
  sleepFeedback: string | null;
  sleepRespirationLow: number | null;
  sleepRespirationHigh: number | null;
  sleepSpO2High: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  batteryCharged: number | null;
  batteryDrained: number | null;
  batteryHighest: number | null;
  batteryLowest: number | null;
  batteryAtWakeTime: number | null;
  batteryDuringSleep: number | null;
  sedentarySec: number | null;
  activeSec: number | null;
  highlyActiveSec: number | null;
  sleepingSec: number | null;
  stressRestSec: number | null;
  stressLowSec: number | null;
  stressMediumSec: number | null;
  stressHighSec: number | null;
  respirationAvg: number | null;
}

export interface DashboardExtended {
  range: number;
  endDate: string;
  averages: {
    steps: number | null; sleepHours: number | null; hrv: number | null; stress: number | null;
    caloriesTotal: number | null; caloriesActive: number | null; restingHeartRate: number | null;
    sleepScore: number | null; deepMin: number | null; remMin: number | null; lightMin: number | null;
    awakeMin: number | null; floors: number | null;
  };
  latestSleep: { start: string | null; end: string | null } | null;
  days: DayDetail[];
  // 体重记录稀疏，单独返回全部记录（不受 7/30 天窗口截断）
  allWeights: Array<{ date: string; kg: number; bodyFat: number | null }>;
}
