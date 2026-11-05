import 'dotenv/config';
import express from 'express';
import { GarminOfficialApi } from './garminOfficial';
import { garminDayToolData, garminTrendsToolData } from '../src/aiTools';
import { currentAiModel } from './aiModels';
import type { DashboardExtended } from '../src/types';

const api = new GarminOfficialApi();

export function registerAiRouter(app: express.Express, dashboardCache: Map<string, { time: number; data: unknown }>) {
  type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string };

  app.post('/api/ai/chat', async (req, res) => {
    const body = req.body || {};
    const messages: Msg[] = Array.isArray(body.messages) ? body.messages : [];
    const contextDate = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
    const baseUrl = String(process.env.AI_BASE_URL || '').replace(/\/+$/, '');
    const apiKey = process.env.AI_API_KEY || '';
    const model = await currentAiModel();
    if (!baseUrl || !apiKey) return res.status(400).json({ error: '请在 .env 配置 AI_BASE_URL 和 AI_API_KEY（OpenAI 兼容端点，支持本地 WorkBuddy2API）' });
    if (!messages.length) return res.status(400).json({ error: '消息不能为空' });

    const tools: Record<string, () => Promise<unknown>> = {
      get_garmin_day: async () => {
        const key = `day:${contextDate}`;
        const hit = dashboardCache.get(key);
        if (hit && Date.now() - hit.time < 600_000) return garminDayToolData(hit.data as Parameters<typeof garminDayToolData>[0]);
        const data = await api.dashboard(contextDate);
        dashboardCache.set(key, { time: Date.now(), data });
        return garminDayToolData(data);
      },
      get_garmin_trends: async () => {
        const key = `trend:${contextDate}:30`;
        const hit = dashboardCache.get(key);
        if (hit && Date.now() - hit.time < 600_000) return garminTrendsToolData(hit.data as DashboardExtended);
        const data = await api.extended(contextDate, 30);
        dashboardCache.set(key, { time: Date.now(), data });
        return garminTrendsToolData(data);
      },
    };

    const systemPrompt = `你是用户的私人健康助理（人设参考：轻巧毒舌但真正关心用户的伙伴）。用户正在查看 ${contextDate} 的 Garmin 健康仪表盘。
回答规则：
- 需要真实数据时调用 get_garmin_day（当日完整指标）或 get_garmin_trends（30 天趋势），基于返回值作答，不要编造数字。
- 字段为 null 表示设备没有记录该指标，明确说明而不是当作零。
- 只做一般性健康趋势分析，不作医疗诊断；数据异常时建议咨询专业人士。
- 用简体中文回答，轻松自然，重点突出，可以用少量颜文字。`;

    const chatMessages: Msg[] = [{ role: 'system', content: systemPrompt }, ...messages];
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    try {
      for (let round = 0; round < 4; round++) {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages: chatMessages, tools: round === 0 ? [
            { type: 'function', function: { name: 'get_garmin_day', description: '读取某一天的 Garmin 健康与活动完整指标（含睡眠阶段、HRV、压力、身体电量、卡路里等）。字段为 null 表示无数据，不是零。', parameters: { type: 'object', properties: {} } } },
            { type: 'function', function: { name: 'get_garmin_trends', description: '读取最多 30 天的健康趋势（每日睡眠/步数/HRV/压力/卡路里/心率及均值）。', parameters: { type: 'object', properties: {} } } },
          ] : undefined }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: `AI 服务返回 ${upstream.status}${detail ? ': ' + detail.slice(0, 200) : ''}` });
        }
        const completion = await upstream.json();
        const choice = completion.choices?.[0];
        const message = choice?.message;
        if (!message) return res.status(502).json({ error: 'AI 服务返回了空回复' });
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (!calls.length) return res.json({ reply: message.content || '', model: completion.model || model });
        chatMessages.push(message);
        for (const call of calls) {
          const name = call?.function?.name;
          const runner = typeof name === 'string' ? tools[name] : undefined;
          let result: unknown;
          if (runner) { try { result = await runner(); } catch (e) { result = { error: e instanceof Error ? e.message : '查询失败' }; } }
          else result = { error: `未知工具 ${name}` };
          chatMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 60_000) });
        }
      }
      return res.status(502).json({ error: 'AI 连续多轮请求工具，已中止。' });
    } catch (error) {
      console.error('AI chat failed:', error instanceof Error ? error.message : 'Unknown');
      return res.status(502).json({ error: '无法连接 AI 服务，请检查 AI_BASE_URL 与网络。' });
    }
  });

  app.get('/api/ai/config', (_req, res) => res.json({ configured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY), model: process.env.AI_MODEL || 'deepseek-chat' }));
}
