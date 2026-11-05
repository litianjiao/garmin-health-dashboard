import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type express from 'express';

const MODELS_FILE = join(process.cwd(), '.ai-models.json');

export interface ModelEntry {
  id: string;
  name: string;
  source: 'upstream' | 'custom';
  credits?: string;
  supportsToolCall?: boolean;
  enabled: boolean;
}

interface ModelStore {
  currentModel: string;
  hiddenUpstream: string[];
  custom: ModelEntry[];
}

const DEFAULT_MODEL = 'cn:glm-5.3-flash';

async function readStore(): Promise<ModelStore> {
  try {
    const parsed = JSON.parse(await readFile(MODELS_FILE, 'utf8'));
    return {
      currentModel: typeof parsed.currentModel === 'string' ? parsed.currentModel : '',
      hiddenUpstream: Array.isArray(parsed.hiddenUpstream) ? parsed.hiddenUpstream : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return { currentModel: '', hiddenUpstream: [], custom: [] };
  }
}
async function writeStore(store: ModelStore) {
  await writeFile(MODELS_FILE, JSON.stringify(store, null, 2)).catch(() => undefined);
}

async function fetchUpstreamModels(): Promise<ModelEntry[]> {
  const baseUrl = String(process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  if (!baseUrl || !apiKey) return [];
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const j = await res.json();
    const data = Array.isArray(j?.data) ? j.data : [];
    return data.map((m: Record<string, unknown>) => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? ''),
      source: 'upstream' as const,
      credits: typeof m.credits === 'string' ? m.credits : undefined,
      supportsToolCall: m.supports_tool_call === true,
      enabled: true,
    })).filter((m: ModelEntry) => m.id.length > 0);
  } catch { return []; }
}

// 当前生效的模型：优先用管理器的选择，回退到 .env 的 AI_MODEL
export async function currentAiModel(): Promise<string> {
  const store = await readStore();
  return store.currentModel || process.env.AI_MODEL || DEFAULT_MODEL;
}

export function registerAiModelRouter(app: express.Express) {
  app.get('/api/ai/models', async (_req, res) => {
    const store = await readStore();
    const upstream = await fetchUpstreamModels();
    const hidden = new Set(store.hiddenUpstream);
    const upstreamVisible = upstream.filter(m => !hidden.has(m.id));
    const list: ModelEntry[] = [
      ...upstreamVisible,
      ...store.custom.map(m => ({ ...m, enabled: m.enabled !== false })),
    ];
    const current = store.currentModel || process.env.AI_MODEL || DEFAULT_MODEL;
    res.json({
      current,
      configured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY),
      baseUrl: process.env.AI_BASE_URL || '',
      modelSource: store.currentModel ? 'managed' : 'env',
      upstreamTotal: upstream.length,
      models: list,
    });
  });

  app.post('/api/ai/models/current', async (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!id) return res.status(400).json({ error: '请提供模型 ID' });
    const store = await readStore();
    store.currentModel = id;
    await writeStore(store);
    res.json({ ok: true, current: id });
  });

  app.post('/api/ai/models/custom', async (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!id) return res.status(400).json({ error: '模型 ID 不能为空' });
    const store = await readStore();
    if (store.custom.some(m => m.id === id)) return res.status(409).json({ error: '该模型 ID 已存在' });
    store.custom.push({ id, name: name || id, source: 'custom', enabled: true });
    await writeStore(store);
    res.json({ ok: true, models: store.custom });
  });

  app.delete('/api/ai/models/custom', async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: '请提供模型 ID' });
    const store = await readStore();
    const before = store.custom.length;
    store.custom = store.custom.filter(m => m.id !== id);
    if (store.currentModel === id) store.currentModel = '';
    await writeStore(store);
    res.json({ ok: true, removed: before - store.custom.length });
  });

  // 隐藏上游模型（不是删除，可恢复）
  app.post('/api/ai/models/hide', async (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!id) return res.status(400).json({ error: '请提供模型 ID' });
    const store = await readStore();
    if (!store.hiddenUpstream.includes(id)) store.hiddenUpstream.push(id);
    if (store.currentModel === id) store.currentModel = '';
    await writeStore(store);
    res.json({ ok: true });
  });

  app.post('/api/ai/models/unhide', async (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const store = await readStore();
    store.hiddenUpstream = id === '__all__' ? [] : store.hiddenUpstream.filter(x => x !== id);
    await writeStore(store);
    res.json({ ok: true });
  });

  // 已隐藏的上游模型列表，供 UI 精确恢复
  app.get('/api/ai/models/hidden', async (_req, res) => {
    const store = await readStore();
    const upstream = await fetchUpstreamModels();
    res.json({ hidden: store.hiddenUpstream, upstream: upstream.map(m => m.id) });
  });
}
