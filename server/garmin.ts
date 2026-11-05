import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { DashboardData } from '../src/types';

type UnknownRecord = Record<string, unknown>;
const numberValue = (value: unknown): number | null => {
  const result = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
};

function find(source: unknown, names: string[]): unknown {
  if (!source || typeof source !== 'object') return undefined;
  if (Array.isArray(source)) {
    for (const item of source) { const found = find(item, names); if (found !== undefined) return found; }
    return undefined;
  }
  for (const [key, value] of Object.entries(source)) {
    if (names.includes(key) && value !== null && value !== '') return value;
  }
  for (const value of Object.values(source)) {
    const found = find(value, names);
    if (found !== undefined) return found;
  }
  return undefined;
}
const num = (source: unknown, names: string[]) => numberValue(find(source, names));
const str = (source: unknown, names: string[]) => {
  const value = find(source, names);
  return typeof value === 'string' ? value : null;
};

let lastStderr = '';
const LOGIN_HINTS: Array<[RegExp, string]> = [
  [/Update Phone number/i, 'Garmin 要求该账号先补充手机号后才能登录：请登录 garmin.com 官网或 Garmin Connect App 完成资料更新，再刷新本页。'],
  [/2FA|two-factor|MFA|verification code/i, 'Garmin 账号开启了二次验证，此第三方工具暂不支持带 2FA 的账号。'],
  [/invalid username or password|login failed/i, 'Garmin 用户名或密码不正确，请核对 .env 中的 GARMIN_USERNAME / GARMIN_PASSWORD。'],
];
const garminLoginMessage = () => {
  for (const [pattern, message] of LOGIN_HINTS) if (pattern.test(lastStderr)) return message;
  return undefined;
};

export class GarminMcp {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;

  async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const command = process.env.GARMIN_MCP_COMMAND || (process.platform === 'win32' ? 'cmd' : 'garmin-connect-mcp');
      const args = process.env.GARMIN_MCP_COMMAND ? [] : process.platform === 'win32' ? ['/c', 'garmin-connect-mcp'] : [];
      this.transport = new StdioClientTransport({
        command, args,
        env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        stderr: 'pipe',
      });
      this.transport.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        lastStderr = `${lastStderr}\n${text}`.slice(-4000);
      });
      const client = new Client({ name: 'moru-dashboard', version: '1.0.0' });
      await client.connect(this.transport);
      this.client = client;
      return client;
    })().catch(error => { this.connecting = undefined; throw error; });
    return this.connecting;
  }

  async call<T = UnknownRecord>(name: string, args: UnknownRecord): Promise<T> {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 45_000, resetTimeoutOnProgress: false });
    if (result.isError) throw new Error(garminLoginMessage() ?? `Garmin ${name} 暂时无法返回数据`);
    const content = Array.isArray(result.content) ? result.content as Array<{ type: string; text?: string }> : [];
    const text = content.find(item => item.type === 'text');
    const raw = text?.text || '{}';
    try { return JSON.parse(raw) as T; } catch { return { value: raw } as T; }
  }

  async dashboard(date: string): Promise<DashboardData> {
    const [overview, sleep, heart, activities] = await Promise.all([
      this.call('get_daily_overview', { date }),
      this.call('get_sleep_data', { date }).catch(() => ({})),
      this.call('get_heart_rate_data', { date }).catch(() => ({})),
      this.call('get_activities', { startDate: date, endDate: date, limit: 10, summary: true }).catch(() => ({})),
    ]);
    const all = { overview, sleep, heart, activities };
    const steps = num(all, ['steps', 'totalSteps', 'dailySteps']);
    const goal = num(all, ['stepGoal', 'dailyStepGoal', 'goal']);
    const sleepSeconds = num(all, ['sleepTimeInSeconds', 'totalSleepSeconds', 'sleepDurationSeconds']);
    const sleepHours = num(all, ['sleepHours']) ?? (sleepSeconds !== null ? sleepSeconds / 3600 : null);
    const sleepScore = num(all, ['sleepScore', 'overallSleepScore']);
    const hrv = num(all, ['lastNightAvg', 'lastNightAverage', 'hrvValue', 'averageHRV']);
    const stress = num(all, ['averageStressLevel', 'avgStressLevel', 'averageStress']);
    const restingHeartRate = num(all, ['restingHeartRate', 'restingHR']);
    const deep = num(all, ['deepSleepSeconds']);
    const rem = num(all, ['remSleepSeconds']);
    const light = num(all, ['lightSleepSeconds']);
    const awake = num(all, ['awakeSleepSeconds']);
    const distance = num(all, ['totalDistanceMeters', 'distanceInMeters']);
    const fitnessAge = num(all, ['fitnessAge']);
    const actualAge = numberValue(process.env.ACTUAL_AGE);
    const startTime = str(all, ['sleepStartTimestampLocal', 'sleepStartTimeLocal']);
    const endTime = str(all, ['sleepEndTimestampLocal', 'sleepEndTimeLocal']);
    const timeline: DashboardData['timeline'] = [];
    if (startTime && endTime) {
      timeline.push({ type: 'sleep', title: '睡眠', subtitle: `${startTime.slice(11, 16)} – ${endTime.slice(11, 16)} · 睡眠恢复`, start: timeHour(startTime), end: timeHour(endTime), status: '已完成' });
    }
    const list = find(activities, ['activities', 'activityList']);
    if (Array.isArray(list)) list.slice(0, 4).forEach(item => {
      const title = str(item, ['activityName', 'activityType', 'typeKey']) || '活动';
      const start = str(item, ['startTimeLocal', 'startTimeGMT']);
      const duration = num(item, ['duration']);
      if (start) timeline.push({ type: 'activity', title, subtitle: `${start.slice(11, 16)} · ${Math.round((duration || 0) / 60)} 分钟`, start: timeHour(start), end: timeHour(start) + (duration || 0) / 3600, status: '已完成' });
    });
    const insights: DashboardData['insights'] = [];
    if (steps !== null) insights.push({ title: goal ? `步数达成 ${Math.round(steps / goal * 100)}%，${steps >= goal ? '已完成今日目标' : '继续加油'}` : `今日已走 ${steps.toLocaleString()} 步`, time: '今天', kind: 'steps' });
    if (sleepHours !== null) insights.push({ title: `睡眠${sleepScore !== null ? ` ${sleepScore} 分，` : ''}共 ${sleepHours.toFixed(1)} 小时`, time: '昨晚', kind: 'sleep' });
    if (hrv !== null) insights.push({ title: `HRV ${hrv} ms，查看昨晚恢复状态`, time: '昨晚', kind: 'heart' });
    return {
      date, source: 'garmin', updatedAt: new Date().toISOString(),
      profile: { name: process.env.DISPLAY_NAME || 'ZAX', actualAge, fitnessAge, vo2max: num(all, ['vo2Max', 'vo2max']), achievableAge: null },
      bodyBattery: num(all, ['bodyBatteryMostRecentValue', 'bodyBattery', 'currentBodyBattery']),
      spo2: { latest: num(all, ['latestSpo2', 'latestSPO2Reading', 'spo2']), min: num(all, ['lowestSpo2', 'lowestSPO2Reading']), average: num(all, ['averageSpo2', 'averageSPO2Reading']), history: [] },
      respiration: num(all, ['averageRespirationValue', 'respiration', 'avgWakingRespirationValue']), restingHeartRate,
      hrv: { lastNight: hrv, weekly: num(all, ['weeklyAvg', 'weeklyAverage']), baselineLow: num(all, ['baselineLowUpper', 'baselineLow']), baselineHigh: num(all, ['baselineBalancedUpper', 'baselineHigh']), status: str(all, ['status', 'hrvStatus']) || '暂无', history: [] },
      sleep: { hours: sleepHours, score: sleepScore, start: startTime?.slice(11, 16) || null, end: endTime?.slice(11, 16) || null, deep: minutes(deep), rem: minutes(rem), light: minutes(light), awake: minutes(awake) },
      stress: { average: stress, max: num(all, ['maxStressLevel']), status: stress === null ? '暂无' : stress < 26 ? '休息' : stress < 51 ? '平衡' : stress < 76 ? '中等' : '偏高' },
      activity: { steps, distanceKm: distance !== null ? distance / 1000 : num(all, ['distanceKm']), goal, history: [] },
      calories: { total: num(all, ['caloriesTotal', 'totalKilocalories']), resting: num(all, ['restingCalories', 'bmrKilocalories']), active: num(all, ['activeCalories', 'activeKilocalories']) },
      heartRateMax: num(all, ['maxHeartRate']),
      weight: { latestKg: null, date: null, deltaGrams: null, goalKg: null, trend: [] },
      bodyFat: { value: null, source: null, date: null },
      bodyBatteryDetail: {
        charged: num(all, ['bodyBatteryChargedValue']), drained: num(all, ['bodyBatteryDrainedValue']),
        highest: num(all, ['bodyBatteryHighestValue']), lowest: num(all, ['bodyBatteryLowestValue']),
        atWakeTime: num(all, ['bodyBatteryAtWakeTime']), duringSleep: num(all, ['bodyBatteryDuringSleep']),
      },
      intensity: {
        highlyActiveSec: num(all, ['highlyActiveSeconds']), activeSec: num(all, ['activeSeconds']),
        sedentarySec: num(all, ['sedentarySeconds']), sleepingSec: num(all, ['sleepingSeconds']),
        moderateMin: num(all, ['moderateIntensityMinutes']), vigorousMin: num(all, ['vigorousIntensityMinutes']),
        goal: num(all, ['intensityMinutesGoal']),
      },
      stressDetail: {
        restSec: num(all, ['restStressDuration']), lowSec: num(all, ['lowStressDuration']),
        mediumSec: num(all, ['mediumStressDuration']), highSec: num(all, ['highStressDuration']),
        activitySec: num(all, ['activityStressDuration']), uncategorizedSec: num(all, ['uncategorizedStressDuration']),
      },
      respirationDay: {
        avgWaking: num(all, ['avgWakingRespirationValue']), highest: num(all, ['highestRespirationValue']),
        lowest: num(all, ['lowestRespirationValue']),
      },
      timeline, insights,
      activities: [],
    };
  }

  async close() { await this.transport?.close(); this.client = undefined; this.connecting = undefined; }
}
const minutes = (seconds: number | null) => seconds !== null ? Math.round(seconds / 60) : null;
const timeHour = (value: string) => Number(value.slice(11, 13)) + Number(value.slice(14, 16)) / 60;
