# dsh-web-search-plugin

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web 能力接缝（`ctx.web`）的统一网页搜索插件，内置 **DeepSeek（官方）/ Tavily / [Brave Search](https://brave.com/search/api/) 三个后端**。本包只向接缝注册 **一个** `WebSearchProvider`，稳定 id 为 `dsh-web-search`。在 **设置 → 网页搜索** 里切换引擎即可，不必再改 `web.searchProvider`。

- **DeepSeek（官方）** — 走 DeepSeek 的 Anthropic 兼容 Messages API（原生 `web_search_20250305` 工具，凭据名 `DEEPSEEK_API_KEY`），一次搜索消耗一个模型轮次。
- **Tavily（默认）** — `keyless`（免费、限流、无需账号）或 `keyed`（`TAVILY_API_KEY`，Bearer token）。keyed 会在设置卡显示额度进度条。
- **Brave Search** — `GET https://api.search.brave.com/res/v1/web/search`，请求头 `X-Subscription-Token`（凭据名 `BRAVE_API_KEY`）。一次搜索就是一次 HTTP 请求，不走模型轮次；设置卡按响应头展示 Capacity / 月配额。
- **不写自定义 session 事件** — 工具结果已经走接缝自己的事件，无需多余信封。

## 特性

- 与官方 `@deepseek-ai/dsh-web-search-deepseek` 相同的提供方约定：`inject: ['web']` + `installSettingsSection` + `ctx.web.registerSearchProvider`。
- 顶层 **设置 → 网页搜索** 分区：两列布局、未保存草稿、保存 toast；结果数量为 1–20 下拉。
- Tavily keyless 无需密钥即可用；Brave 需要订阅 token（若本机已有 `BRAVE_API_KEY` 凭据，可直接复用）。
- Tavily keyed / Brave 在设置卡展示额度进度条（DeepSeek 官方与 Tavily keyless 不展示）。
- 各引擎结果都规范化为接缝的 `WebSearchResult`（可选 `content` + `sources[]`），按 URL 去重。
- 设置段 `dsh-web-search-plugin` 通过 rc.7 的 `settings.describe()` 动态暴露，不需要宿主白名单补丁，也不需要自建回环 settings 桥。
- 错误映射为 `WEB_PROVIDER_ERROR` / `WEB_ABORTED` / `WEB_PROVIDER_CREDENTIAL_MISSING`。

## 运行要求

- DeepSeek Harness `0.1.0-rc.7` 或更新
- pnpm，用于通过 `dsh plugin` 把插件装进 profile

## 安装

本包是 **bundle**：`dsh.bundle.patch` + `cordis.patch.yml` 会插入 Host 行、把 `web.searchProvider` 设为 `dsh-web-search`，并**禁用内置 `web-search-deepseek` Host 插件**（本插件已自行托管 DeepSeek 后端，禁用它能移除旧的「插件 → 网页搜索」卡片、避免重复注册 provider）。没有这一声明时，`dsh plugin add` 只写入依赖，插件不会挂载。

### 从 npm 安装

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

### 从本地目录安装

同盘可以用相对路径：

```powershell
dsh plugin --profile web add ".\dsh-web-search-plugin"
```

**Windows 跨盘不要 `dsh plugin add` 绝对路径。** Profile 在 `C:`、仓库在 `D:` 时，它会写成 `link:d:/...`；pnpm 把盘符当成相对路径，junction 会指到 `profiles\web\D:\...` 并链坏。也不要写 `file:D:/...`：pnpm 10 同样会把跨盘绝对路径拼进 profile 目录。

正确做法是快照到与 profile **同盘**，再用 `file:`：

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\web\.local\dsh-web-search-plugin"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy "D:\gddi\dsh-web-search-plugin" $dst /E /XD node_modules .git .github /NFL /NDL /NJH /NJS
```

在 profile 的 `package.json` 里：

```json
"dsh-web-search-plugin": "file:.local/dsh-web-search-plugin"
```

并保证 `dsh.profile.bundles` 含本包，然后：

```powershell
dsh plugin --profile web install
```

`file:` 是快照：改完仓库后要再 robocopy + `install` 并重启 DSH。

用 `dsh --profile web --dump-config` 确认：组成树里应有 `dsh-web-search-plugin` 行，且 `web.searchProvider` 为 `dsh-web-search`。

若 profile 已经覆盖了 `web`（例如旧包 `@dsh-ltctfer/dsh-web-search-brave` 留下的 `brave-official`），后打的 patch 仍会生效。请改指向本插件，并卸掉旧包：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: dsh-web-search
```

```powershell
dsh plugin --profile web remove @dsh-ltctfer/dsh-web-search-brave
```

然后在 **设置 → 网页搜索** 里把引擎切到想要的提供方，即可继续使用对应的 API key。

> **关于 `file:`（本地）安装** — pnpm 会把 `file:` 依赖做成快照。改完本仓库后，需要再同步快照并 `dsh plugin --profile web install`，然后重启。Windows 上 profile 与仓库不在同一盘时，用同盘 `file:.local/...`，不要 `link:` / `file:` 指向另一块盘。

## 配置

设置卡编辑的是 `dsh-web-search-plugin` 命名空间：

| 键 | 默认值 | 含义 |
|---|---|---|
| `provider` | `tavily` | `tavily`、`brave` 或 `deepseek-official` |
| `mode` | `keyless` | 仅 Tavily：`keyless` 或 `keyed` |
| `apiKey` | — | Tavily API key 字面量（走凭据域，不会回显） |
| `apiKeyEnv` | `TAVILY_API_KEY` | keyed Tavily 使用的凭据/环境变量名 |
| `baseURL` | `https://api.tavily.com` | Tavily REST 基址；会再拼 `/search` |
| `maxResults` | `8` | 每次搜索返回的源数量，三个后端共用。设置卡为 1–20 下拉，超出上限会夹到 20 |
| `searchDepth` | `basic` | 仅 Tavily：`basic` 或 `advanced` |
| `includeAnswer` | `true` | 仅 Tavily：请求生成摘要，写入结果 `content` |
| `topic` | `general` | 仅 Tavily：`general` 或 `news` |
| `deepseekApiKey` | — | DeepSeek API key 字面量（走凭据域） |
| `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` | DeepSeek 使用的凭据/环境变量名 |
| `deepseekBaseURL` | `https://api.deepseek.com/anthropic/v1` | DeepSeek Anthropic 兼容 Messages 基址；再拼 `/messages` |
| `model` | `deepseek-v4-flash` | Anthropic 格式模型名 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 请求头 |
| `maxTokens` | `4096` | Messages 请求生成 token 上限 |
| `maxUses` | `5` | 每次请求 `web_search` 工具的最大调用次数 |
| `braveApiKey` | — | Brave 订阅 token 字面量（走凭据域） |
| `braveApiKeyEnv` | `BRAVE_API_KEY` | Brave 使用的凭据/环境变量名 |
| `braveBaseURL` | `https://api.search.brave.com/res/v1/web/search` | Brave 网页搜索接口 |
| `country` | — | Brave 的 `country`（ISO 两位码，如 `cn`）；留空使用 Brave 默认 |
| `searchLang` | — | Brave 的 `search_lang`（如 `zh-hans`）；留空使用 Brave 默认 |
| `freshness` | — | Brave 的 `freshness`：`pd` / `pw` / `pm` / `py` |
| `proxy` | — | Brave 使用的 HTTP(S) 代理；留空回退 `HTTPS_PROXY` / `HTTP_PROXY` |

环境变量：启动时 `DSH_WEB_SEARCH_PROVIDER=dsh-web-search` 会选中本接缝 id。未设置 `baseURL` 时，Tavily 基址回退 `$TAVILY_BASE_URL`。

## 额度

- **Tavily keyless / DeepSeek 官方**：不展示额度条。前者是免费限流、没有账户配额；后者按次扣费、没有月度限额。
- **Tavily keyed**：搜索时请求 `include_usage`，把本次 credits 累加到 `%DSH_HOME%\storages\dsh-web-search-usage.json`。Host 每 10 分钟（以及设置卡点刷新）调用 `GET /usage`，用 `account.current_plan` / `plan_limit` 做限额，用量取本地累计与远端的较大值。换套餐或远端用量回落会重置本地计数。
- **Brave**：没有 usage / 花费接口。控制台 **Capacity** 就是响应头里的每秒窗口（例如 50 次/秒）。月限额 `0` 表示不限请求次数，不是额度用完。计费 credits 只能看 [Brave API 控制台](https://api-dashboard.search.brave.com/)。
- 浏览器只读 `GET /dsh-web-search/usage`（不直打上游）。进度条：剩余超过 20% 为绿色，不超过 20% 为黄色，不超过 10% 为红色。

## 切回内置 DeepSeek

DeepSeek 已并入本插件（`provider: deepseek-official`），无需切回。若确要恢复 DSH 内置的 DeepSeek host 插件，请在 profile patch 里去掉对 `web-search-deepseek` 的 `disabled` 并把 `searchProvider` 设回 `deepseek-official`；本插件可以继续挂着，只是不会被选中。

## 工作方式

- **DeepSeek** — `POST {deepseekBaseURL}/messages`，请求头 `x-api-key` / `authorization: Bearer`，工具 `web_search_20250305`。
- **Tavily** — `POST {baseURL}/search`。keyless 发送 `x-tavily-access-mode: keyless`；keyed 发送 `authorization: Bearer <key>`。
- **Brave** — `GET {braveBaseURL}?q=&count=`，请求头 `x-subscription-token`。不向 session 追加自定义事件。
- 非 2xx 映射为 `WEB_PROVIDER_ERROR`；调用方取消映射为 `WEB_ABORTED`。

## 仓库布局

```
lib/index.js       Host 插件：Config、分发提供方、设置段、额度路由
lib/deepseek.js    DeepSeek 后端（Anthropic Messages + web_search_20250305）
lib/tavily.js      Tavily 后端（keyed 时带 include_usage）
lib/brave.js       Brave 后端（解析 X-RateLimit-*，不写自定义 session 事件）
lib/usage.js       Tavily/Brave 用量本地缓存与 /usage 对账
lib/shared.js      中止 / 凭据解析辅助
lib/client.js      浏览器 bundle：顶层「网页搜索」分区 + 引擎切换 + 额度条
cordis.patch.yml   Bundle patch：插入 Host 行、设 searchProvider、禁用内置 deepseek
```

## 开发

```powershell
npm run check
```

客户端 bundle 必须保持 `window.__ModuleLoader__.load({ id, factory })` 线格式 — 由 `dsh-client-modules` 加载，不是打包器。必须同时导出 `apply` 和 `inject`（`slots`、`locale`、`connection`、`remote`、`settingsScope`），并把分区注册进 `settings.section`（`id: "web-search"`）。

## 发布

发布由 GitHub Actions（`.github/workflows/publish.yml`）自动完成：**推送 `v*` 标签**（例如 `v0.2.1`）会带 provenance 发到 npm。向 `main` 的普通推送不会发布。

1. 确认 `package.json` 的 `version` 与即将推送的标签一致（例如 `0.2.1` → `v0.2.1`）。
2. 在 GitHub **Settings → Secrets and variables → Actions** 里配置有 publish 权限的 npm automation token（仓库密钥 `NPM_TOKEN`），并允许 Actions 运行。
3. 打标签并推送：

   ```powershell
   git tag v0.2.1
   git push origin v0.2.1
   ```

工作流会先核对标签与 `package.json` 的 `version`，再执行 `npm publish --provenance --access public`。

## 参与贡献

欢迎提 issue 和 pull request，见 [issue tracker](https://github.com/X-C1811/dsh-web-search-plugin/issues)。还可以在同一接缝 id 下继续加搜索后端。

## 许可证

[MIT](LICENSE)
