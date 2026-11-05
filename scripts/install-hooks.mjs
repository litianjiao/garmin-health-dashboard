#!/usr/bin/env node
/**
 * 安装 pre-commit 钩子：每次 git commit 前自动运行 check:secrets。
 * 由 npm 的 prepare 脚本触发（npm install 时），也可用 `npm run prepare` 手动执行。
 * 不覆盖用户已有的自定义钩子内容——会把我们的检查追加进去。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const gitDir = join(ROOT, '.git');
if (!existsSync(gitDir)) {
  console.log('[hooks] 尚未 git init，跳过安装；init 后再运行 npm run prepare 即可。');
  process.exit(0);
}
const hooksDir = join(gitDir, 'hooks');
if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
const hookPath = join(hooksDir, 'pre-commit');

const MARKER = '# >>> moru check:secrets >>>';
const BLOCK = `${MARKER}
node scripts/check-secrets.mjs || exit 1
# <<< moru check:secrets <<<`;

let existing = '';
if (existsSync(hookPath)) {
  existing = readFileSync(hookPath, 'utf8');
  if (existing.includes(MARKER)) {
    console.log('[hooks] pre-commit 已安装，跳过。');
    process.exit(0);
  }
}

let content;
if (existing.trim()) {
  // 保留用户已有逻辑，确保 sh 解释器，追加我们的块
  content = existing.replace(/^#!.*\n/, '');
  content = `#!/bin/sh\n${content}\n\n${BLOCK}\n`;
} else {
  content = `#!/bin/sh\n# 提交前阻止密钥泄漏（由 npm prepare 自动生成）\n${BLOCK}\n`;
}
writeFileSync(hookPath, content);
try { chmodSync(hookPath, 0o755); } catch { /* Windows 下忽略 */ }
console.log('[hooks] pre-commit 已安装：commit 前自动运行 check:secrets。');
