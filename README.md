# MORU · Garmin 每日健康仪表盘

参考所给图片设计的高保真中文健康仪表盘。后端通过 **Garmin 官方 Personal API**（推荐）或第三方 `garmin-connect-mcp`（备用）读取 Garmin Connect，网页不接触 Garmin 密码。

## 已实现

- 六张健康卡片（健身年龄、血氧、HRV、睡眠、压力、活动）、人体指标标记、今日时间线、近期洞察
- **点卡片右上角 ↗ 箭头打开详情抽屉**：7/30 天趋势图（可切换指标）+ 每日明细表；睡眠详情含起止、评分、深睡/REM/浅睡/清醒/小睡分钟数、睡眠血氧与呼吸（以官方 API 返回为准）
- 扩展卡片（默认全部展开，可在「自定义卡片」里勾选）：
  - **体重** — 当前体重、较上次变化量、目标进度条（你的目标 70kg）
  - **身体电量** — 当前值 + 充能/消耗/晨起值/睡眠恢复量/今日区间
  - **活动强度** — 睡眠/久坐/活动/高强度时间占比环形图
  - **压力分布** — 休息/低/中/高压力时长堆叠图
  - **卡路里、心率** — 基础/活动消耗、静息/最高心率及 7/30 天趋势
  - **训练负荷 PMC** — 独立页面：CTL/ATL/TSB（五色区间 + ±15/±30% 色带）、体重图
  - **AI 健康对话** — 独立页面：本地或云端 OpenAI 兼容模型 + 数据查询工具 + 模型管理（列表/切换/增删自定义）
- **每日 10 点健康简报**（见下方专门章节）
- 日期切换、手动刷新、10 分钟缓存、加载/错误/空数据状态
- 桌面/手机响应式布局、本地字体和图标、个人照片人物形象
- JSON / CSV / 元宝健康摘要导出（点击右上角头像，摘要含全部新增维度与当日活动明细）
- 可选密码登录、签名 HttpOnly 会话、登录限流、安全响应头
- Docker 部署和 Cloudflare Tunnel 远程访问配置

**未配置任何数据源时显示演示数据，并在页面顶部明确标注。** 配置官方 API key 或账号后自动切换到真实数据，演示回退关闭。

## 1. 数据源配置（二选一）

### 方式 A：官方 Personal API（推荐）

1. 登录 [Garmin Connect 网页](https://connect.garmin.com)，进入 **设置 → Personal API Key**（[直达链接](https://connect.garmin.com/app/settings/personalApiToken)）。
2. Create Key → 接受条款 → 选择过期时间 → 复制生成的 `GCDC_` 开头的 key（只显示一次，请妥善保存）。
3. 写入 `.env`：

```dotenv
GARMIN_API_KEY=GCDC_xxxxxxxxxxxxxxxx
```

后端自动用 key 换取 access token（本地缓存 `.garmin-token.json`，已加入 `.gitignore`），访问官方端点获取：每日汇总（步数/目标/距离/楼层/卡路里/强度分钟）、睡眠（起止/时长/评分/深睡 REM 浅睡/睡眠呼吸与血氧）、心率（静息/最值）、HRV（昨晚/周均/基线/7 日历史/状态）、压力（均值/峰值）、身体电量、血氧（最新/均值/最低/逐时曲线）、健身年龄（含实际年龄与可达年龄）、活动列表与时间线。

官方文档：<https://developer.garmin.com/gc-developer-program/personal/personal-api/>，端点清单见其 Swagger Docs 页面。

### 方式 B：第三方 MCP（备用）

```dotenv
GARMIN_TRANSPORT=mcp
GARMIN_USERNAME=你的 Garmin Connect 邮箱
GARMIN_PASSWORD=你的 Garmin Connect 密码
```

需要先 `npm install -g garmin-connect-mcp@latest`。此通道不支持开启 2FA 的账号，字段覆盖不如官方 API 完整，保留是为了兼容。

两种方式都不需要把凭据发给前端、聊天或 Git。

## 2. 本地启动

### 最简单：双击启动（推荐）

项目根目录下有两个启动器，双击任一即可：

| 文件 | 效果 |
|---|---|
| **打开健康仪表盘.vbs** | 静默启动（无黑窗口），自动打开浏览器；服务已在运行则直接打开网页 |
| **启动健康仪表盘.bat** | 显示命令行窗口，可看到启动日志；关闭窗口即停止服务 |

首次运行会自动构建前端（约 30 秒），之后启动约 10–20 秒。启动后浏览器自动打开 <http://127.0.0.1:8787>。

> 英文名副本：`open-dashboard.vbs`、`start-dashboard.bat`（功能相同）。

**停止服务**：关闭那个批处理/命令行窗口即可；静默模式可用任务管理器结束 `node.exe`。

### 命令行方式

需要 Node.js 20 或更新版本（当前已验证 Node.js 24）。

```bash
npm install
cp .env.example .env   # Windows 可手动复制
# 编辑 .env 填入 GARMIN_API_KEY
npm run dev
```

打开 <http://127.0.0.1:5173>（开发模式，支持热更新）。生产模式：

```bash
npm run build
# Windows PowerShell:
$env:NODE_ENV="production"; npx tsx server/index.ts
```

生产地址为 <http://127.0.0.1:8787>。开发模式 Vite 把 `/api` 转发到此端口。

### 数据说明与本地记录

- 当天数据要等手表同步到 Garmin Connect 后才有；查看昨天及更早日期最完整。
- 上游没有的指标显示 `—`，不会生成虚假数值。人体图是状态可视化示意图，不是医学影像。
- **所有数据接口缓存 10 分钟**，避免频繁调用 Garmin API；只有点「刷新」按钮才强制重新获取。
- **Garmin Personal API 是纯只读的**（官方 26 个端点全是 GET，POST 返回 404），所以**体脂/体重无法写回 Garmin**。
  若你想记录体脂：在「自定义卡片」面板顶部填写体重/体脂，会保存在本机 `.local-metrics.json`（已加入 .gitignore）。
  要在 Garmin 里看到体脂，需要连接 Garmin 体脂秤，或在 Garmin Connect App「体重」里手动添加体脂字段。
- 官方 API key 等同账号只读权限，请像密码一样保管；`api_key.txt` 与 `.garmin-token.json` 均在 `.gitignore` 中。
- 个人照片 `public/human.png` 仅在本地处理背景，不上传任何在线服务。

### 可选：仅在本机留存 HRV / 静息心率

在 `.env` 设置 `HEALTH_HISTORY_DIR=./.health-history` 后重启。需要支持内置 SQLite 的 Node.js 22.13+；留空时不开库，不改变原先的运行要求。仅记录真实数据源的夜间平均 HRV（ms）、静息心率（bpm）和日期，不保存凭据、AI 对话或整包健康数据，也不替换原有体重 JSON。数据未加密，请选择自己有权限的私有目录；停止服务后备份或删除整个目录。容器部署需单独挂载一个运行用户可写的持久卷。

成功查看真实仪表盘会按日新增/更新；同一天的修正会覆盖旧读数，缺测不会当作零或抹掉已有记录。官方通道另支持 `POST /api/history/sync`，传 JSON `{"date":"2026-01-31"}`，只补截至所选日的 30 天；MCP 仅累积实际打开过的日期。演示数据不入库。通过 `GET /api/history?date=2026-01-31` 读取截至该日最近 90 个日历日的已有记录。密码模式下两者均需登录。

官方密钥或 MCP 用户名变更会隔离到另一个库（换官方密钥也会重新积累），不会把不同账号合算。关闭开关不会自动删历史；库及 SQLite 辅助文件均不应提交或上传。

首页「个人基线」可按所选日期补同步近 30 天，分开显示夜间 HRV 与静息心率的读数、样本数、中位数和常见区间。参照窗口为此前 28 个日历日，不含当天；每项至少 21 个有效日才展示 P10–P90。样本不足、缺测与超出区间分别标注，不据一次偏离判断疾病或训练强度。这是本应用的描述统计，不复刻 Garmin 算法。

同一卡片可展开「习惯对照」：手记某日晚 18:00 后是否喝含咖啡因的饮品，分「有 / 无 / 未记录」。只比较前 56 晚有明确标签、次日有对应指标的样本；两组各至少 7 天才展示次日 HRV、静息心率的两组中位数及差值。未填写绝不当作无，历史视图不使用所选日期之后的数据。这个探索性对照不消除混杂，不能证明因果或代替医学判断。

## 2. Claude 接入

### Claude Code

在项目目录执行（将占位符换成自己的凭据）：

```bash
claude mcp add --transport stdio \
  --env GARMIN_USERNAME=你的邮箱 \
  --env GARMIN_PASSWORD=你的密码 \
  garmin-connect -- npx -y garmin-connect-mcp@latest
claude mcp list
```

此命令会把凭据写入本机 Claude 用户配置。若不希望出现在 shell 历史里，可编辑 Claude 的本地 MCP 配置。不要使用会提交到仓库的 project scope。

### Claude Desktop

打开 **Settings → Developer → Edit Config**，Windows 对应：

```text
%APPDATA%\Claude\claude_desktop_config.json
```

把 `claude-desktop-config.example.json` 的 `mcpServers` 内容合并进去，替换两个占位符，完全退出并重启 Claude Desktop。项目模板使用 Windows `cmd /c`，确保全局安装后 `garmin-connect-mcp` 命令可用。

然后询问：“查询我今天的 Garmin 每日健康概览”。请仅允许只读工具；该第三方包也提供创建、安排和删除训练的工具，本项目网页不会调用它们。

## 3. 元宝访问：远程网页 + 摘要

元宝是否支持自定义 MCP 没有可确认的官方依据，因此这里不依赖元宝 MCP，也不声称已接入元宝 MCP。

### 最可靠：发送健康摘要

1. 点击右上角 `Z` → **元宝健康摘要**。
2. 将下载的 `.txt` 上传给元宝，或复制内容到对话。
3. 摘要包含当日指标和数据来源，并要求元宝只做一般趋势分析、不作医疗诊断。

### 手机/元宝内置浏览器：安全远程网页

在 `.env` 中增加高强度独立密码：

```dotenv
DASHBOARD_PASSWORD=请换成足够长的随机密码
SESSION_SECRET=请换成另一条足够长的随机字符串
SECURE_COOKIES=true
HOST=127.0.0.1
```

构建并启动生产服务，然后使用 **Cloudflare 固定域名 Tunnel + Cloudflare Access** 暴露 `http://127.0.0.1:8787`。不要把 Garmin 凭据写进 Tunnel URL、网页或元宝。

固定 Tunnel 示例（需自己的域名及 Cloudflare 账号）：

```yaml
# 用户自己的 cloudflared config.yml
tunnel: 你的 Tunnel ID
credentials-file: C:\\Users\\你的用户名\\.cloudflared\\你的 Tunnel ID.json
ingress:
  - hostname: health.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

```bash
cloudflared tunnel run 你的隧道名
```

建议在 Cloudflare Zero Trust → Access 再限制允许登录的邮箱。应用本身也有独立登录页，二者不冲突。临时演示可以使用 Quick Tunnel，但域名会变化、无可用性保证，不应长期暴露健康数据：

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

外网验证前必须确认：访问页面要求登录、错误密码被拒绝、未认证 API 返回 401、Garmin 凭据不出现在任何响应中。元宝内置浏览器能否保存 Cookie 或完成 Access 登录取决于客户端；如果它不能直接打开，使用摘要导出仍然可靠。

### Docker 云服务器

```bash
docker compose up -d --build
```

仅绑定 `127.0.0.1:8787`，前面仍需 HTTPS 反向代理/Tunnel，不能直接把无 TLS 的端口暴露到公网。

## 4. 每日健康简报（定时推送）

参考 Whoop / Oura 的「每日 readiness 简报」，每天 **10:00 左右**基于**前一天完整数据**生成一份个人健康/健身洞察：

- **数据**：前一日仪表盘（睡眠阶段、HRV、身体电量、压力、活动明细）+ 7 天趋势 + PMC 训练负荷（CTL/ATL/TSB）
- **AI 洞察**：调用「模型管理」里当前选中的模型，输出结构化简报——一句话标题、总评、3–5 条关键洞察、**当日训练建议**、恢复作息建议、注意事项（不作医疗诊断）
- **降级保障**：AI 不可用/超时自动改为本地规则简报，保证每天都有内容
- **调度**：服务常驻时 10 点后生成；若 10 点后才启动（比如双击启动器），**启动 5 秒后自动补生成**，每天仅一次；结果写入 `.briefings.json`（已 gitignore）
- **推送**：Windows 桌面气球通知 + 网页顶部简报横幅 + 铃铛红点；浏览器系统通知需授予本站通知权限
- **入口**：点顶部铃铛或横幅「查看简报」打开抽屉，含「今日简报 / 历史 / 推送设置」三个标签；设置里可关闭自动生成、改时间（6–12 点）、手动「立即生成」

简报与数据接口共用 10 分钟缓存，不会因简报额外频繁请求 Garmin；每天仅一次 AI 调用。

## 5. 常用命令

```bash
npm run dev            # 前后端开发
npm run build          # TypeScript 检查 + 前端生产构建
npm test               # 数据与后端测试
npm start              # 类 Unix 生产启动
npm run check:secrets  # 提交前密钥/隐私扫描
```

## 6. 上传到 GitHub 前的安全事项

**`.env` 里的 Garmin API key 与账号密码绝不能提交。** 完整的密级分层、轮换与历史清理说明见 [SECURITY.md](./SECURITY.md)。

简要步骤：

```bash
npm install                 # 自动安装 pre-commit 钩子
npm run check:secrets       # 确认无泄漏，命中会非零退出
git init && git add -A      # 敏感文件已被 .gitignore 排除
git commit -m "..."         # 钩子会再次自动扫描
```

三道防线：`.gitignore` + `.env.example` 空模板 → `check:secrets` 与 pre-commit 钩子 → GitHub Actions（`.github/workflows/security.yml`，含 gitleaks 全历史扫描）。CI 里没有 `.env`，能抓到"把真实值写死进代码"的情况。

需要提交的是 `claude-desktop-config.example.json` 这类**占位符模板**；`REA_BIN/` 里的 APK 样本与所有运行期生成的健康数据文件都不上传。

## 技术说明

- React 19 + TypeScript + Vite + Express
- 主数据源：**Garmin 官方 Personal API**（`personal.connectapi.garmin.com`，ApiKey 换 token）；备用通道：`@modelcontextprotocol/sdk` stdio 调用 `epodivilov/garmin-connect-mcp`
- AI 对话：任意 OpenAI 兼容端点（本地 WorkBuddy2API / DeepSeek 等），凭据仅在服务端 `.env`
- 只读取 Garmin 数据，不调用写入/删除工具；不上传凭据到第三方字体、分析或广告服务
- 网络目标仅：Garmin 官方 API、你配置的 AI 端点；字体与图标均为本地资源
- Cookie 会话是 HMAC 签名、7 天过期；`SECURE_COOKIES=true` 时仅 HTTPS 发送

本项目不是医疗设备或诊断工具。第三方 Garmin API 行为可能变化，数据仅供个人健康趋势参考。
