# 安全与凭据管理

本项目读取 Garmin 健康数据并调用 AI 服务，涉及**两类私密信息**：凭据（API key / 账号密码）和健康数据。推到 GitHub 前请按本文件检查。

## 密级分层

| 类别 | 文件 | 是否提交 | 说明 |
|---|---|---|---|
| **真实凭据** | `.env` | ❌ | 含 `GARMIN_API_KEY`、`AI_API_KEY`、Garmin 账号密码、会话密钥 |
| | `api_key.txt` | ❌ | Garmin 官方 Personal API key 原件 |
| | `.env.local` / `.env.*.local` | ❌ | 任何本地覆盖配置 |
| | `*.pem` / `*.key` / `*.p12` / `*.pfx` | ❌ | 证书与私钥 |
| **运行期私密数据** | `.garmin-token.json` | ❌ | 官方 API 换取的 access token（每小时刷新） |
| | `.briefings.json` | ❌ | 每日简报与历史（含健康数据） |
| | `.local-metrics.json` | ❌ | 手动记录的体重/体脂 |
| | `.ai-models.json` | ❌ | AI 模型管理配置 |
| | `.garmin-session/` / `.token-cache.json` | ❌ | MCP 会话与调试缓存 |
| **模板（可提交）** | `.env.example` | ✅ | **只含空占位符**，无任何真实值 |
| | `claude-desktop-config.example.json` | ✅ | 占位符示例 |
| **逆向样本** | `REA_BIN/*.apk` 等 | ❌ | 体积大且涉及第三方版权 |

`.gitignore` 已覆盖以上全部「❌」项。前端代码永远不读取凭据：所有密钥只在服务端通过 `process.env` 使用。

## 首次 clone 后的配置

```bash
cp .env.example .env
# 编辑 .env，填入你自己的值（不要提交）
npm install          # 自动安装 pre-commit 钩子
npm run check:secrets # 确认干净
```

`.env` 需要的键见 `.env.example`。**不要把 `.env` 复制进 Docker 镜像或 CI**；生产环境用部署平台的 Secret/环境变量注入。

## 三道防线

1. **`npm run check:secrets`**：扫描将提交的文件里是否出现本地真实凭据值、`GCDC_`/`sk-`/私钥头等密钥格式、以及敏感文件是否被 `.gitignore` 漏掉。只报文件名与行号，不打印密钥内容。
2. **pre-commit 钩子**：`npm install` 通过 `prepare` 脚本自动写入 `.git/hooks/pre-commit`，每次 `git commit` 前运行检查，命中即阻止提交。不会覆盖你已有的自定义钩子。
3. **GitHub Actions**（`.github/workflows/security.yml`）：push/PR 时再次跑密钥扫描 + `gitleaks` 全历史扫描 + 构建测试。CI 里没有 `.env`，因此能抓到"把真实值写死进代码"的情况。

## 如果怀疑密钥已泄露

1. **立刻轮换**（撤销旧的，不要只删文件）：
   - Garmin Personal API key：Garmin Connect → 设置 → Personal API Key，删除旧 key 并新建，更新本地 `.env`
   - AI API key：在对应服务商后台重置
   - Garmin 账号密码：改密码（并注意该第三方 MCP 通道不支持 2FA）
2. **清理 Git 历史**：若密钥曾进入提交，删除文件后推送还不够——用 `git filter-repo` 或 BFG 重写历史并强推（涉及协作时需协调）。
3. 检查 `.garmin-token.json`（短期 token）与 `.briefings.json`（健康数据）是否也曾外泄。

## 远程访问提醒

`DASHBOARD_PASSWORD` / `SESSION_SECRET` 为空时本地模式跳过登录。若通过 Cloudflare Tunnel / 反代暴露到公网，**必须**设置这两项并开启 `SECURE_COOKIES=true`；详见 README「元宝访问」章节。健康数据不应在无鉴权的公网端点上暴露。
