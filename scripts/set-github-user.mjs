#!/usr/bin/env node
// 用法: node scripts/set-github-user.mjs <github用户名>
// 一次性把本地 git 身份与 origin 从占位符替换为真实用户名（noreply 邮箱 + SSH remote）
import { execFileSync } from 'node:child_process';
const u = process.argv[2];
if (!u || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(u)) {
  console.error('用法: node scripts/set-github-user.mjs <合法GitHub用户名>'); process.exit(1);
}
const run = (...args) => execFileSync('git', args, { cwd: process.cwd(), stdio: 'inherit' });
run('config', '--local', 'user.name', u);
run('config', '--local', 'user.email', `${u}@users.noreply.github.com`);
run('remote', 'set-url', 'origin', `git@github.com:${u}/garmin-health-dashboard.git`);
// 清掉可能残留的 pushurl，确保 fetch/push 都走同一个 SSH 地址
try { execFileSync('git', ['config', '--local', '--unset-all', 'remote.origin.pushurl'], { cwd: process.cwd(), stdio: 'ignore' }); } catch {}
console.log(`\n已设置:\n  user.name  = ${u}\n  user.email = ${u}@users.noreply.github.com\n  origin     = git@github.com:${u}/garmin-health-dashboard.git`);
console.log('\n下一步: 把公钥加到 https://github.com/settings/keys，然后 git add -A && git commit && git push -u origin master');
