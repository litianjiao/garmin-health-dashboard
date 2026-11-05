#!/usr/bin/env node
/**
 * 提交前密钥检查：防止把 Garmin / AI 凭据或私密健康数据推到 GitHub。
 * 用法：npm run check:secrets  （pre-commit 钩子与 CI 也会调用）
 *
 * 只读取本地文件，不联网、不打印任何密钥内容（仅报告文件名/行号/类型）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const p = (...parts) => join(ROOT, ...parts);

// 1) 绝不能被提交的文件（gitignore 应覆盖；这里再兜底检查是否被 git 跟踪）
const SECRET_FILES = [
  '.env', '.env.local', '.env.production', 'api_key.txt', 'secrets.json', 'credentials.json',
  '.garmin-token.json', '.local-metrics.json', '.ai-models.json', '.briefings.json',
  '.token-cache.json', '.server.log',
];
// 2) 会被提交的代码/配置里不能出现这些"值"（取自本地真实文件，只用于比对，不输出）
const SENSITIVE_ENV_KEYS = ['GARMIN_API_KEY', 'AI_API_KEY', 'GARMIN_PASSWORD', 'GARMIN_USERNAME', 'SESSION_SECRET', 'DASHBOARD_PASSWORD'];
const realValues = [];
function collectFromEnv(file) {
  if (!existsSync(file)) return;
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/); } catch { return; }
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    if (SENSITIVE_ENV_KEYS.includes(k.trim())) {
      const v = rest.join('=').trim();
      // 邮箱只在"看起来是真实邮箱"时纳入（避免把示例误判）；不纳入短占位符
      if (v && v.length >= 12) realValues.push(v);
    }
  }
}
collectFromEnv(p('.env'));
if (existsSync(p('api_key.txt'))) {
  const v = readFileSync(p('api_key.txt'), 'utf8').trim();
  if (v) realValues.push(v);
}

// 3) 常见密钥格式（即便没有本地 .env 也能抓到硬编码）
const PATTERNS = [
  { name: 'Garmin Personal API key', re: /GCDC_[A-Za-z0-9._-]{20,}/g },
  { name: 'OpenAI/DeepSeek style key', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
];

// 允许出现占位符/示例的文件（模板与文档本身）
const PLACEHOLDER_ALLOWLIST = new Set(['.env.example', 'README.md', 'scripts/check-secrets.mjs', 'SECURITY.md', 'claude-desktop-config.example.json']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
    const skip = ['node_modules', 'dist', '.git', '.zcode', 'REA_BIN', '.vite', 'coverage'].some(d => rel === d || rel.startsWith(d + '/'));
    if (skip) continue;
    if (e.isDirectory()) { walk(full, out); continue; }
    if (!e.isFile()) continue;
    if (SECRET_FILES.includes(rel)) continue;                 // 兜底：本身就不该被提交
    if (/\.sqlite(?:-.*)?$/i.test(rel)) continue;             // 不读健康库的二进制内容；下方查 Git 索引
    if (rel.endsWith('.png') || rel.endsWith('.jpg') || rel.endsWith('.jpeg') || rel.endsWith('.ttf') || rel.endsWith('.woff2')) continue;
    if (rel.endsWith('.apk') || rel.endsWith('.ipa')) continue;
    out.push(rel);
  }
  return out;
}

const findings = [];

// 检查 A：敏感文件是否被 .gitignore 排除（兜底，不依赖 git 是否已 init）
try {
  const { execFileSync } = require('node:child_process');
  let isGitRepo = true;
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' }); }
  catch { isGitRepo = false; }

  if (isGitRepo) {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.sqlite', '*.sqlite-*'], { cwd: ROOT, encoding: 'utf8' });
    for (const file of tracked.split('\0').filter(Boolean)) findings.push({ file, type: '已被 Git 跟踪的私密 SQLite 文件', line: null });
  }

  let ignoreText = '';
  if (existsSync(p('.gitignore'))) ignoreText = readFileSync(p('.gitignore'), 'utf8');
  const ignoreLines = ignoreText.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  for (const f of SECRET_FILES) {
    if (!existsSync(p(f))) continue;
    let ignored = false;
    if (isGitRepo) {
      // git 可用时以 git 的判定为准
      try { execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT, stdio: 'ignore' }); ignored = true; }
      catch { ignored = false; }
    } else {
      // 未 init：用 .gitignore 规则做轻量匹配（精确名 / 通配 / 目录前缀）
      ignored = ignoreLines.some(line => {
        if (line.startsWith('!')) return false;
        if (line === f) return true;
        if (line.startsWith('*') && f.endsWith(line.slice(1))) return true;
        if (line.endsWith('/')) return f.startsWith(line);
        if (line.startsWith('.env') && f.startsWith('.env') && f !== '.env.example') return true;
        return false;
      });
    }
    if (!ignored) findings.push({ file: f, type: '未被 .gitignore 排除的敏感文件', line: null });
  }
} catch { /* 规则文件不可用时跳过此项 */ }

// 检查 B：真实密钥值出现在将提交的文件里
const files = walk(ROOT);
for (const rel of files) {
  let text;
  try { text = readFileSync(p(rel), 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (const v of realValues) {
    const idx = lines.findIndex(l => l.includes(v));
    if (idx >= 0) findings.push({ file: rel, type: '包含本地真实凭据（完整值）', line: idx + 1 });
  }
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      const matched = m[0];
      // 模板/文档里的占位符不计
      const isPlaceholder = /xxxx|your|YOUR|示例|example|placeholder|sk-\.\.\.|sk-…|<|＞/.test(matched) || PLACEHOLDER_ALLOWLIST.has(rel);
      if (!isPlaceholder) findings.push({ file: rel, type: `匹配 ${name} 格式`, line });
    }
  }
}

if (findings.length) {
  console.error('\n❌ 检测到可能泄漏的敏感信息，已阻止提交：\n');
  for (const f of findings) console.error(`   · ${f.file}${f.line ? `:${f.line}` : ''} — ${f.type}`);
  console.error('\n处理方式：把值放进 .env（已在 .gitignore），代码里只引用 process.env；模板用空占位符。\n');
  process.exit(1);
}
console.log(`✅ 密钥检查通过：扫描 ${files.length} 个将提交文件，未发现真实凭据或私钥格式。`);
