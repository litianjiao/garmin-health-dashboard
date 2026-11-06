import type { DashboardData, DashboardExtended, DayDetail, ActivitySummary } from '../src/types';
import { isHistoryDate, offsetDate, type HistoryDay } from '../src/personalHistory';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.GARMIN_API_BASE || 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = join(process.cwd(), '.garmin-token.json');
const TOKEN_TTL_MS = 3600_000; // token claims 6h; refresh hourly for safety margin

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const asArray = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
const minutes = (seconds: unknown) => { const v = num(seconds); return v !== null ? Math.round(v / 60) : null; };
// Garmin 的 *Local 字段是"编码成 UTC 的墙上时间"——数值本身就是本地时间读数，
// 不能再做时区转换（否则会重复 +8 小时）；直接取其 UTC 时分即为正确的本地时刻。
const hhmm = (epochMs: unknown): string | null => { const v = num(epochMs); return v === null ? null : new Date(v).toISOString().slice(11, 16); };
const hourFloat = (epochMs: number) => { const d = new Date(epochMs); return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; };
// 真 GMT 时间戳（如活动的 beginTimestamp）需要正常换算到本地时区
const hhmmGmt = (epochMs: number): string => new Date(epochMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
// Garmin 以 float32 存储部分字段，JSON 里会出现 0.6000000238418579 这类精度噪声，规整到 1 位小数
const tidy = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const hourFloatGmt = (epochMs: number) => { const d = new Date(epochMs); const sh = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })); return sh.getHours() + sh.getMinutes() / 60 + sh.getSeconds() / 3600; };

export class GarminOfficialApi {
  private apiKey = '';
  private token = '';
  private tokenTime = 0;

  constructor(private readonly persistToken = true) {
    this.apiKey = (process.env.GARMIN_API_KEY || '').trim();
  }

  get configured(): boolean { return this.apiKey.length > 0; }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() - this.tokenTime < TOKEN_TTL_MS) return this.token;
    let cached: { token?: string; time?: number } = {};
    if (this.persistToken) {
      try { cached = JSON.parse(await readFile(TOKEN_PATH, 'utf8')); } catch { /* first run */ }
    }
    if (cached.token && cached.time && Date.now() - cached.time < TOKEN_TTL_MS) {
      this.token = cached.token; this.tokenTime = cached.time;
      return this.token;
    }
    const res = await fetch(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${this.apiKey}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(res.status === 401 || res.status === 403
        ? 'Garmin API key 无效或已过期。请到 Garmin Connect 网页（设置 → Personal API Key）重新生成，并更新 GARMIN_API_KEY。'
        : `获取访问令牌失败（${res.status}）${detail.slice(0, 120)}`);
    }
    this.token = (await res.text()).trim();
    this.tokenTime = Date.now();
    if (this.persistToken) await writeFile(TOKEN_PATH, JSON.stringify({ token: this.token, time: this.tokenTime }), { mode: 0o600 }).catch(() => undefined);
    return this.token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Garmin 接口 ${path.split('?')[0]} 返回 ${res.status}`);
    return await res.json() as T;
  }

  private daysAgo(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  private daysAgoOrEnd(date: string, days: number, endExclusive = false): string {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - days);
    if (endExclusive) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private async getRange<T>(path: string, maxDays: number, from: string, to: string): Promise<T> {
    const span = Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400_000) + 1;
    if (span > maxDays) {
      const adjusted = new Date(`${to}T12:00:00`);
      adjusted.setDate(adjusted.getDate() - maxDays + 1);
      from = adjusted.toISOString().slice(0, 10);
    }
    return this.get<T>(`${path}${from}/${to}`);
  }

  async getActivities(start: string, end: string): Promise<Array<Record<string, unknown>>> {
    return this.get<Array<Record<string, unknown>>>(`/activitylist-service/activities/search/activities?startDate=${start}&endDate=${end}`).catch(() => []);
  }

  async getWeight(date: string, days = 90): Promise<Json> {
    const from = this.daysAgo(date, days - 1);
    return this.get<Json>(`/weight-service/weight/range/${from}/${date}`).catch(() => ({}) as Json);
  }

  async getWeightGoal(date: string): Promise<Json> {
    const from = this.daysAgo(date, 29);
    return this.get<Json>(`/goal-service/goal/user/effective/weightgoal/${from}/${date}`).catch(() => ({}) as Json);
  }

  async getDailySummaryV1(date: string): Promise<Json> {
    return this.get<Json>(`/usersummary-service/usersummary/daily?calendarDate=${date}`).catch(() => ({}) as Json);
  }

  async getActivityDetail(id: number): Promise<Json> {
    return this.get<Json>(`/activity-service/activity/${id}`).catch(() => ({}) as Json);
  }

  // Two range requests for a 30-day backfill, not 30 full dashboard fetches.
  async personalHistory(end: string): Promise<HistoryDay[]> {
    const from = offsetDate(end, -29);
    await this.ensureToken(); // authenticate once before issuing concurrent range requests
    const [hrv, summaries] = await Promise.all([
      this.get<Json>(`/hrv-service/hrv/daily/${from}/${end}`),
      this.get<Json>(`/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${end}`),
    ]);
    const days = new Map<string, HistoryDay>();
    const row = (date: unknown) => {
      if (!isHistoryDate(date) || date < from || date > end) return;
      if (!days.has(date)) days.set(date, { date, hrv: null, restingHeartRate: null });
      return days.get(date)!;
    };
    for (const raw of asArray(hrv.hrvSummaries)) {
      const item = asObject(raw), day = row(item.calendarDate);
      if (day && num(item.lastNightAvg) !== null) day.hrv = num(item.lastNightAvg);
    }
    for (const raw of asArray(summaries.data)) {
      const item = asObject(raw), day = row(item.calendarDate);
      const rhr = num(asObject(item.heartRate).restingValue);
      if (day && rhr !== null) day.restingHeartRate = rhr;
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async extended(date: string, range: 7 | 30 = 7): Promise<DashboardExtended> {
    const days = range;
    const to = date;
    const from = this.daysAgoOrEnd(date, days - 1);
    const [sleepSummaries, summariesRaw, hrvWeekRaw, stepsRaw, stressRaw, sleepDetailToday, weightRaw] = await Promise.all([
      this.get<Json[]>(`/sleep-service/sleep/dailySleepSummariesByDate?startDate=${from}&endDate=${to}`).catch(() => []),
      this.get<Json>(`/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${to}`).catch(() => ({ } as Json)),
      this.get<Json>(`/hrv-service/hrv/daily/${from}/${to}`).catch(() => ({ } as Json)),
      this.getRange<Json[]>('/usersummary-service/stats/steps/daily/', 28, from, to).catch(() => []),
      this.getRange<Json[]>('/usersummary-service/stats/stress/daily/', 28, from, to).catch(() => []),
      this.get<Json>(`/sleep-service/sleep/dailySleep?date=${date}`).catch(() => ({ } as Json)),
      // 体重记录稀疏，用固定 182 天窗口拉取后在前端按区间过滤
      this.getWeight(date, 182),
    ]);
    // v1 每日汇总提供久坐/活动/睡眠秒数与呼吸均值（v2 区间端点没有），并发补齐
    const dayKeys = Array.from({ length: days }, (_, i) => this.daysAgoOrEnd(date, i));
    const v1List = await Promise.all(dayKeys.map(d => this.getDailySummaryV1(d).catch(() => ({}) as Json)));
    const v1ByDate = new Map<string, Json>();
    dayKeys.forEach((d, i) => v1ByDate.set(d, v1List[i]));
    const sedentaryByDate = new Map<string, number>();
    const activeByDate = new Map<string, number>();
    const highlyByDate = new Map<string, number>();
    const sleepingByDate = new Map<string, number>();
    v1ByDate.forEach((v, d) => {
      const sed = num(v.sedentarySeconds), act = num(v.activeSeconds), hi = num(v.highlyActiveSeconds), sl = num(v.sleepingSeconds);
      if (sed !== null) sedentaryByDate.set(d, sed);
      if (act !== null) activeByDate.set(d, act);
      if (hi !== null) highlyByDate.set(d, hi);
      if (sl !== null) sleepingByDate.set(d, sl);
    });
    const weightByDate = new Map<string, number>();
    const bodyFatByDate = new Map<string, number>();
    asArray(weightRaw.dailyWeightSummaries).forEach(raw => {
      const d = asObject(raw); const lw = asObject(d.latestWeight);
      const day = str(lw.calendarDate) ?? str(d.summaryDate);
      const grams = num(lw.weight);
      if (day && grams !== null) {
        weightByDate.set(day, Math.round(grams / 100) / 10);
        const fat = num(lw.bodyFat);
        if (fat !== null) bodyFatByDate.set(day, fat);
      }
    });
    // 区间汇总端点缺少 avgHeartRate/sleepNeed 等扩展字段，用当日接口补齐最新一晚
    const sleepDetailsByDate = new Map<string, Json>([[date, sleepDetailToday]]);
    const summaryByDate = new Map<string, Json>();
    asArray(asObject(summariesRaw).data).forEach(d => { const obj = asObject(d); const day = str(obj.calendarDate); if (day) summaryByDate.set(day, obj); });
    const sleepByDate = new Map<string, Json>();
    asArray(sleepSummaries).forEach(d => { const obj = asObject(d); const day = str(obj.calendarDate); if (day) sleepByDate.set(day, obj); });
    const hrvByDate = new Map<string, number>();
    asArray(asObject(hrvWeekRaw).hrvSummaries).forEach(d => { const obj = asObject(d); const day = str(obj.calendarDate); const v = num(obj.lastNightAvg); if (day && v !== null) hrvByDate.set(day, v); });
    const stepsByDate = new Map<string, number>();
    asArray(stepsRaw).forEach(d => { const obj = asObject(d); const day = str(obj.calendarDate); const v = num(obj.totalSteps); if (day && v !== null) stepsByDate.set(day, v); });
    const stressByDate = new Map<string, number>();
    asArray(stressRaw).forEach(d => { const obj = asObject(d); const day = str(obj.calendarDate); const v = num(asObject(obj.values).overallStressLevel); if (day && v !== null) stressByDate.set(day, v); });

    const daysList: DayDetail[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = this.daysAgoOrEnd(date, i);
      const summary = summaryByDate.get(day) ?? {};
      const movement = asObject(asObject(summary).movement);
      const stepsObj = asObject(movement.steps);
      const floorsObj = asObject(movement.floorsAscended);
      const cal = asObject(asObject(summary).calories);
      const hr = asObject(asObject(summary).heartRate);
      const stress = asObject(asObject(summary).stress);
      const intensity = asObject(asObject(summary).intensityMinutes);
      const bb = asObject(asObject(summary).bodyBattery);
      const resp = asObject(asObject(summary).respiration);
      const sleepObj = { ...asObject(sleepByDate.get(day)), ...asObject(sleepDetailsByDate.get(day)) };
      const sleepScores = asObject(asObject(sleepObj).sleepScores);
      const sleepOverall = asObject(sleepScores.overall);
      daysList.push({
        date: day,
        steps: stepsByDate.get(day) ?? num(stepsObj.value),
        stepGoal: num(stepsObj.goal),
        distanceKm: num(stepsObj.distanceInMeters) !== null ? num(stepsObj.distanceInMeters)! / 1000 : null,
        floors: num(floorsObj.value),
        caloriesResting: num(cal.burnedResting),
        caloriesActive: num(cal.burnedActive),
        caloriesTotal: num(cal.burnedTotal),
        restingHeartRate: num(hr.restingValue),
        heartRateMax: num(hr.maxValue),
        stress: stressByDate.get(day) ?? num(stress.avgLevel),
        stressMax: num(stress.maxLevel),
        hrv: hrvByDate.get(day) ?? null,
        intensityMinutes: num(intensity.moderate) !== null ? num(intensity.moderate)! + (num(intensity.vigorous) ?? 0) * 2 : null,
        intensityGoal: num(intensity.goal),
        sleepHours: num(sleepObj.sleepTimeSeconds) !== null ? num(sleepObj.sleepTimeSeconds)! / 3600 : null,
        sleepScore: num(sleepOverall.value),
        sleepDeepMin: minutes(sleepObj.deepSleepSeconds),
        sleepRemMin: minutes(sleepObj.remSleepSeconds),
        sleepLightMin: minutes(sleepObj.lightSleepSeconds),
        sleepAwakeMin: minutes(sleepObj.awakeSleepSeconds),
        sleepNapMin: minutes(sleepObj.napTimeSeconds),
        sleepSpO2: num(sleepObj.averageSpO2Value),
        sleepRespiration: num(sleepObj.averageRespirationValue),
        sleepStart: hhmm(sleepObj.sleepStartTimestampLocal),
        sleepEnd: hhmm(sleepObj.sleepEndTimestampLocal),
        sleepAvgHeartRate: num(sleepObj.avgHeartRate),
        sleepAvgStress: num(sleepObj.avgSleepStress),
        sleepAwakeCount: num(sleepObj.awakeCount),
        sleepNeedMin: num(asObject(sleepObj.sleepNeed).actual),
        sleepFeedback: str(sleepObj.sleepScoreFeedback),
        sleepRespirationLow: num(sleepObj.lowestRespirationValue),
        sleepRespirationHigh: num(sleepObj.highestRespirationValue),
        sleepSpO2High: num(sleepObj.highestSpO2Value),
        weightKg: weightByDate.get(day) ?? null,
        bodyFatPercent: bodyFatByDate.get(day) ?? null,
        batteryCharged: num(bb.chargedValue),
        batteryDrained: num(bb.drainedValue),
        batteryHighest: num(bb.maxValue),
        batteryLowest: num(bb.minValue),
        batteryAtWakeTime: null,
        batteryDuringSleep: null,
        sedentarySec: sedentaryByDate.get(day) ?? null,
        activeSec: activeByDate.get(day) ?? null,
        highlyActiveSec: highlyByDate.get(day) ?? null,
        sleepingSec: sleepingByDate.get(day) ?? null,
        stressRestSec: num(stress.restDurationInMillis) !== null ? Math.round(num(stress.restDurationInMillis)! / 1000) : null,
        stressLowSec: num(stress.lowStressDurationInMillis) !== null ? Math.round(num(stress.lowStressDurationInMillis)! / 1000) : null,
        stressMediumSec: num(stress.mediumStressDurationInMillis) !== null ? Math.round(num(stress.mediumStressDurationInMillis)! / 1000) : null,
        stressHighSec: num(stress.highStressDurationInMillis) !== null ? Math.round(num(stress.highStressDurationInMillis)! / 1000) : null,
        respirationAvg: num(resp.avgValue),
      });
    }
    const avg = (vals: Array<number | null>): number | null => {
      const list = vals.filter((v): v is number => v !== null);
      return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 10) / 10 : null;
    };
    const last = daysList.filter(d => d.sleepHours !== null).at(-1);
    return {
      range, endDate: date,
      averages: {
        steps: avg(daysList.map(d => d.steps)), sleepHours: avg(daysList.map(d => d.sleepHours)),
        hrv: avg(daysList.map(d => d.hrv)), stress: avg(daysList.map(d => d.stress)),
        caloriesTotal: avg(daysList.map(d => d.caloriesTotal)), caloriesActive: avg(daysList.map(d => d.caloriesActive)),
        restingHeartRate: avg(daysList.map(d => d.restingHeartRate)), sleepScore: avg(daysList.map(d => d.sleepScore)),
        deepMin: avg(daysList.map(d => d.sleepDeepMin)), remMin: avg(daysList.map(d => d.sleepRemMin)),
        lightMin: avg(daysList.map(d => d.sleepLightMin)), awakeMin: avg(daysList.map(d => d.sleepAwakeMin)),
        floors: avg(daysList.map(d => d.floors)),
      },
      latestSleep: last ? { start: last.sleepStart, end: last.sleepEnd } : null,
      days: daysList,
      allWeights: (() => {
        const out: Array<{ date: string; kg: number; bodyFat: number | null }> = [];
        weightByDate.forEach((kg, d) => out.push({ date: d, kg, bodyFat: bodyFatByDate.get(d) ?? null }));
        return out.sort((a, b) => a.date.localeCompare(b.date));
      })(),
    };
  }

  async dashboard(date: string, localEntries: Array<{ date: string; bodyFat?: number; weightKg?: number }> = []): Promise<DashboardData> {
    if (!this.persistToken) await this.ensureToken();
    const from = this.daysAgo(date, 7);
    const [summaryRaw, sleepRaw, heartRaw, hrvRaw, hrvWeekRaw, fitnessRaw, stepsWeekRaw, stressWeekRaw, spo2Raw, batteryRaw, activitiesRaw, profileRaw, v1Raw, weightRaw, goalRaw] = await Promise.all([
      this.get<Json>(`/usersummary-service/v2/dailysummaries?startDate=${date}&endDate=${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/sleep-service/sleep/dailySleep?date=${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/wellness-service/wellness/dailyHeartRate?date=${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/hrv-service/hrv/${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/hrv-service/hrv/daily/${from}/${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/fitnessage-service/fitnessage/v2/${date}`).catch(() => ({} as Json)),
      this.get<Json[]>(`/usersummary-service/stats/steps/daily/${from}/${date}`).catch(() => []),
      this.get<Json[]>(`/usersummary-service/stats/stress/daily/${from}/${date}`).catch(() => []),
      this.get<Json>(`/wellness-service/wellness/daily/spo2acclimation/${date}`).catch(() => ({} as Json)),
      this.get<Json>(`/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`).catch(() => ({ })),
      this.get<Json[]>(`/activitylist-service/activities/search/activities?startDate=${date}&endDate=${date}`).catch(() => []),
      this.get<Json>('/userprofile-service/userprofile/settings').catch(() => ({} as Json)),
      this.getDailySummaryV1(date),
      this.getWeight(date),
      this.getWeightGoal(date),
    ]);

    const summaries = asArray(asObject(summaryRaw).data);
    const summary = asObject(summaries[0]);
    const movement = asObject(summary.movement);
    const stepsData = asObject(movement.steps);
    const hrBlock = asObject(summary.heartRate);
    const stressBlock = asObject(summary.stress);
    const batteryBlock = asObject(summary.bodyBattery);
    const calories = asObject(summary.calories);

    const sleepScores = asObject(asObject(sleepRaw).sleepScores);
    const overall = asObject(sleepScores.overall);
    const hrvSummary = asObject(asObject(hrvRaw).hrvSummary);
    const baseline = asObject(hrvSummary.baseline);
    const hrvWeek = asArray(asObject(hrvWeekRaw).hrvSummaries).map(s => num(asObject(s).lastNightAvg)).filter((v): v is number => v !== null);
    const fitnessAge = num(asObject(fitnessRaw).fitnessAge);
    const chronoAge = num(asObject(fitnessRaw).chronologicalAge);
    const achievable = num(asObject(fitnessRaw).achievableFitnessAge);
    const spo2 = asObject(spo2Raw);
    const spo2Series = asArray(spo2.spO2HourlyAverages).map((row: unknown) => Array.isArray(row) ? num(row[1]) : null).filter((v): v is number => v !== null);
    const batteryList = asArray(asObject(batteryRaw).bodyBatteryValuesArray ?? batteryBlock.latestValue);
    const batterySeries = asArray((asArray(batteryList[0])[0] !== undefined ? batteryList : [])).map((row: unknown) => Array.isArray(row) ? num(row[1]) : null).filter((v): v is number => v !== null);
    const batteryLatest = num(batteryBlock.latestValue) ?? (batterySeries.length ? batterySeries.at(-1)! : null);

    const activities = asArray(activitiesRaw).slice(0, 4).map(item => {
      const obj = asObject(item);
      // 用 GMT 时间戳计算时间线位置（浏览端转本地时间），startTimeLocal 仅用于显示文本
      const gmtMs = num(obj.beginTimestamp);
      const startMs = gmtMs !== null ? gmtMs : (str(obj.startTimeLocal) ? new Date(str(obj.startTimeLocal)!.replace(' ', 'T') + '+08:00').getTime() : NaN);
      const duration = num(obj.duration);
      const name = str(obj.activityName) || str(asObject(obj.activityType).typeKey) || '活动';
      return { name, startMs, duration, type: str(asObject(obj.activityType).typeKey) || 'activity' };
    }).filter(a => Number.isFinite(a.startMs));

    const sleepStartMs = num(sleepRaw.sleepStartTimestampLocal);
    const sleepEndMs = num(sleepRaw.sleepEndTimestampLocal);
    const timeline: DashboardData['timeline'] = [];
    if (sleepStartMs !== null && sleepEndMs !== null) {
      timeline.push({ type: 'sleep', title: '睡眠', subtitle: `${hhmm(sleepStartMs)} – ${hhmm(sleepEndMs)} · 睡眠恢复`, start: Math.round(hourFloat(sleepStartMs) * 100) / 100, end: Math.round(hourFloat(sleepEndMs) * 100) / 100, status: '已完成' });
    }
    activities.forEach(a => { const s = hourFloatGmt(a.startMs); timeline.push({ type: 'activity', title: a.name, subtitle: `${hhmmGmt(a.startMs)} · ${Math.round((a.duration || 0) / 60)} 分钟`, start: Math.round(s * 100) / 100, end: Math.round((s + (a.duration || 0) / 3600) * 100) / 100, status: '已完成' }); });
    timeline.sort((x, y) => x.start - y.start);

    const steps = num(stepsData.value);
    const goal = num(stepsData.goal);
    const sleepHoursRaw = num(sleepRaw.sleepTimeSeconds);
    const sleepHours = sleepHoursRaw !== null ? sleepHoursRaw / 3600 : null;
    const displayName = process.env.DISPLAY_NAME || str(profileRaw.displayName) || 'Bnana';

    const insights: DashboardData['insights'] = [];
    if (steps !== null && goal) insights.push({ title: `步数达成 ${Math.round(steps / goal * 100)}%，${steps >= goal ? '已完成今日目标' : '继续加油'}`, time: '今天', kind: 'steps' });
    if (sleepHours !== null) insights.push({ title: `睡眠${num(overall.value) !== null ? ` ${num(overall.value)} 分，` : ''}共 ${sleepHours.toFixed(1)} 小时`, time: '昨晚', kind: 'sleep' });
    const hrvLast = num(hrvSummary.lastNightAvg);
    if (hrvLast !== null) insights.push({ title: `HRV ${hrvLast} ms，${hrvStatusText(str(hrvSummary.status))}`, time: '昨晚', kind: 'heart' });
    if (fitnessAge !== null && chronoAge !== null) insights.push({ title: `健身年龄 ${fitnessAge.toFixed(1)} 岁，比实际年龄 ${fitnessAge < chronoAge ? '年轻 ' : '年长 '}${Math.abs(chronoAge - fitnessAge).toFixed(1)} 岁`, time: '今天', kind: 'fitness' });
    const trainingBlock = asObject(summary.intensityMinutes);
    const moderate = num(trainingBlock.moderate);
    if (moderate !== null) insights.push({ title: `中高强度活动 ${moderate} 分钟${num(trainingBlock.goal) ? ` / 目标 ${num(trainingBlock.goal)}` : ''}`, time: '今天', kind: 'training' });

    return {
      date, source: 'garmin', updatedAt: new Date().toISOString(),
      profile: { name: displayName, actualAge: chronoAge, fitnessAge: tidy(fitnessAge), vo2max: null, achievableAge: tidy(achievable) },
      bodyBattery: batteryLatest,
      spo2: {
        latest: num(spo2.latestSpO2), min: num(spo2.lowestSpO2), average: num(spo2.averageSpO2), history: spo2Series,
      },
      respiration: num(sleepRaw.averageRespirationValue),
      restingHeartRate: num(hrBlock.restingValue) ?? num(heartRaw.restingHeartRate),
      hrv: {
        lastNight: hrvLast, weekly: num(hrvSummary.weeklyAvg),
        baselineLow: num(baseline.balancedLow), baselineHigh: num(baseline.balancedUpper),
        status: hrvStatusText(str(hrvSummary.status)), history: hrvWeek,
      },
      sleep: {
        hours: sleepHours, score: num(overall.value),
        start: hhmm(sleepStartMs), end: hhmm(sleepEndMs),
        deep: minutes(sleepRaw.deepSleepSeconds), rem: minutes(sleepRaw.remSleepSeconds), light: minutes(sleepRaw.lightSleepSeconds), awake: minutes(sleepRaw.awakeSleepSeconds),
      },
      stress: { average: num(stressBlock.avgLevel), max: num(stressBlock.maxLevel), status: stressText(num(stressBlock.avgLevel), str(stressBlock.qualifier)) },
      activity: {
        steps, distanceKm: num(stepsData.distanceInMeters) !== null ? num(stepsData.distanceInMeters)! / 1000 : null,
        goal,
        history: asArray(stepsWeekRaw).map(s => num(asObject(s).totalSteps)).filter((v): v is number => v !== null),
      },
      calories: { total: num(calories.burnedTotal), resting: num(calories.burnedResting), active: num(calories.burnedActive) },
      heartRateMax: num(hrBlock.maxValue),
      weight: (() => {
        const list = asArray(weightRaw.dailyWeightSummaries).map(d => {
          const o = asObject(d); const lw = asObject(o.latestWeight);
          return { date: str(lw.calendarDate) ?? str(o.summaryDate), kg: num(lw.weight) !== null ? num(lw.weight)! / 1000 : null };
        }).filter((w): w is { date: string; kg: number } => Boolean(w.date) && w.kg !== null)
          .sort((a, b) => a.date.localeCompare(b.date));
        // 本地手动记录合并进趋势（Garmin 官方 API 只读，本地记录补足体重/体脂）
        localEntries.forEach(e => {
          if (e.weightKg !== undefined && e.date) {
            const existing = list.find(w => w.date === e.date);
            if (existing) existing.kg = e.weightKg;
            else list.push({ date: e.date, kg: e.weightKg });
          }
        });
        list.sort((a, b) => a.date.localeCompare(b.date));
        const latest = list.at(-1) ?? null;
        const latestEntry = asArray(weightRaw.dailyWeightSummaries).map(d => asObject(asObject(d).latestWeight)).at(-1) ?? {};
        const goal = asArray(goalRaw.userGoals).map(g => asObject(g)).find(g => num(g.goalValue) !== null);
        return {
          latestKg: latest?.kg ?? null,
          date: latest?.date ?? null,
          deltaGrams: num(latestEntry.weightDelta),
          goalKg: goal ? num(goal.goalValue)! / 1000 : null,
          trend: list.slice(-30),
        };
      })(),
      bodyFat: (() => {
        const entry = asArray(weightRaw.dailyWeightSummaries).map(d => asObject(asObject(d).latestWeight)).at(-1) ?? {};
        const garminFat = num(entry.bodyFat);
        if (garminFat !== null) return { value: garminFat, source: 'garmin' as const, date: str(entry.calendarDate) };
        // Garmin 无体脂时回退到本机手动记录（.local-metrics.json）
        const local = localEntries.filter(e => e.bodyFat !== undefined).at(-1);
        if (local) return { value: local.bodyFat ?? null, source: 'local' as const, date: local.date };
        return { value: null, source: null, date: null };
      })(),
      bodyBatteryDetail: {
        charged: num(v1Raw.bodyBatteryChargedValue), drained: num(v1Raw.bodyBatteryDrainedValue),
        highest: num(v1Raw.bodyBatteryHighestValue), lowest: num(v1Raw.bodyBatteryLowestValue),
        atWakeTime: num(v1Raw.bodyBatteryAtWakeTime), duringSleep: num(v1Raw.bodyBatteryDuringSleep),
      },
      intensity: {
        highlyActiveSec: num(v1Raw.highlyActiveSeconds), activeSec: num(v1Raw.activeSeconds),
        sedentarySec: num(v1Raw.sedentarySeconds), sleepingSec: num(v1Raw.sleepingSeconds),
        moderateMin: num(v1Raw.moderateIntensityMinutes), vigorousMin: num(v1Raw.vigorousIntensityMinutes),
        goal: num(v1Raw.intensityMinutesGoal),
      },
      stressDetail: {
        restSec: num(v1Raw.restStressDuration), lowSec: num(v1Raw.lowStressDuration),
        mediumSec: num(v1Raw.mediumStressDuration), highSec: num(v1Raw.highStressDuration),
        activitySec: num(v1Raw.activityStressDuration), uncategorizedSec: num(v1Raw.uncategorizedStressDuration),
      },
      respirationDay: {
        avgWaking: num(v1Raw.avgWakingRespirationValue), highest: num(v1Raw.highestRespirationValue),
        lowest: num(v1Raw.lowestRespirationValue),
      },
      timeline, insights,
      activities: await this.buildActivitySummaries(activitiesRaw),
    };
  }

  // 列表接口已含心率区间；活动详情补充训练效果标签、海拔、配速、体能消耗
  private async buildActivitySummaries(list: unknown): Promise<ActivitySummary[]> {
    const items = asArray(list).slice(0, 5);
    const base = items.map(item => {
      const o = asObject(item);
      const id = num(o.activityId) ?? 0;
      const zones = [1, 2, 3, 4, 5].map(i => num(o[`hrTimeInZone_${i}`]));
      const dist = num(o.distance);
      const avgSpeed = num(o.averageSpeed);
      return {
        id, name: str(o.activityName) ?? '活动', typeKey: str(asObject(o.activityType).typeKey) ?? '',
        startLocal: str(o.startTimeLocal) ?? null,
        durationSec: num(o.duration) !== null ? Math.round(num(o.duration)!) : null, distanceKm: dist !== null ? Math.round(dist / 100) / 10 : null,
        calories: num(o.calories), avgHr: num(o.averageHR), maxHr: num(o.maxHR),
        trainingLoad: tidy(num(o.activityTrainingLoad)), aerobicEffect: tidy(num(o.aerobicTrainingEffect)),
        anaerobicEffect: tidy(num(o.anaerobicTrainingEffect)), effectLabel: str(o.trainingEffectLabel) ?? null,
        moderateMin: num(o.moderateIntensityMinutes), vigorousMin: num(o.vigorousIntensityMinutes),
        hrZonesSec: zones, elevationGainM: null, avgSpeedKmh: avgSpeed !== null ? Math.round(avgSpeed * 36) / 10 : null,
        staminaUsed: null,
      } satisfies ActivitySummary;
    });
    // 仅对有训练负荷的活动取详情，控制请求数
    const needDetail = base.filter(a => a.id > 0 && a.trainingLoad !== null).slice(0, 3);
    const details = await Promise.all(needDetail.map(a => this.getActivityDetail(a.id)));
    const byId = new Map<number, Json>();
    needDetail.forEach((a, i) => byId.set(a.id, details[i]));
    return base.map(a => {
      const s = asObject(asObject(byId.get(a.id)).summaryDTO);
      return {
        ...a,
        elevationGainM: num(s.elevationGain),
        staminaUsed: num(s.beginPotentialStamina) !== null && num(s.endPotentialStamina) !== null
          ? Math.round(num(s.beginPotentialStamina)! - num(s.endPotentialStamina)!) : null,
        avgSpeedKmh: a.avgSpeedKmh ?? (num(s.averageSpeed) !== null ? Math.round(num(s.averageSpeed)! * 36) / 10 : null),
      };
    });
  }
}

const hrvStatusText = (status: string | null): string =>
  !status ? '暂无' : { BALANCED: '平衡', UNBALANCED: '失衡', LOW: '偏低' }[status as 'BALANCED' | 'UNBALANCED' | 'LOW'] ?? status;
const stressText = (value: number | null, qualifier: string | null): string => {
  if (qualifier) return ({ balanced: '平衡', calm: '平静', low: '较低', medium: '中等', high: '偏高', unknown: '暂无' } as Record<string, string>)[qualifier] ?? qualifier;
  if (value === null) return '暂无';
  return value < 26 ? '休息' : value < 51 ? '平衡' : value < 76 ? '中等' : '偏高';
};
