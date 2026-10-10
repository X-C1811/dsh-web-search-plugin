# dsh-web-search-plugin

[English](./README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web 能力接缝（`ctx.web`）的统一网页搜索插件，内置 **DeepSeek（官方，默认）/ Tavily / [Brave Search](https://brave.com/search/api/) / Serper / SerpApi / Exa / SearXNG / Scavio / Firecrawl 九个后端**。本包只向接缝注册 **一个** `WebSearchProvider`，稳定 id 为 `dsh-web-search`。在 **设置 → 网页搜索** 里切换引擎即可，不必再改 `web.searchProvider`。

- **DeepSeek（官方，默认）** — 走 DeepSeek 的 Anthropic 兼容 Messages API（原生 `web_search_20250305` 工具，支持账号令牌或 `DEEPSEEK_API_KEY`），一次搜索消耗一个模型轮次。
- **Tavily** — `keyless`（免费、限流、无需账号）或 `keyed`（`TAVILY_API_KEY`，Bearer token）。keyed 会在设置卡显示额度进度条。
- **Brave Search** — `GET https://api.search.brave.com/res/v1/web/search`，请求头 `X-Subscription-Token`（凭据名 `BRAVE_API_KEY`）。一次搜索就是一次 HTTP 请求，不走模型轮次；设置卡按响应头展示 Capacity / 月配额。
- **Serper** — Google 结果（`POST /search`，头 `X-API-KEY`，凭据名 `SERPER_API_KEY`）。
- **SerpApi** — `GET /search.json`，key 走 query（`api_key=`），凭据名 `SERPAPI_API_KEY`。
- **Exa** — 语义/神经搜索（`POST /search`，Bearer，凭据名 `EXA_API_KEY`），请求 `contents.highlights` 作为结果摘要。
- **SearXNG** — 自建/协议免 key 的元搜索（`GET /search?format=json`），可填自托管实例地址；实例须启用 JSON 输出。
- **Scavio** — Google SERP（`POST /api/v2/google`，Bearer，凭据名 `SCAVIO_API_KEY`），响应与 SerpApi 同构。
- **Firecrawl** — 网页搜索（`POST /v2/search`，Bearer，凭据名 `FIRECRAWL_API_KEY`），`sources: ["web"]`；当前请求没有启用整页抓取。
- **DuckDuckGo** — 无官方搜索 API，不提供独立后端；下拉中以禁用项提示：选 SearXNG 并指向聚合了 DuckDuckGo 的实例即可。
- **官方 key 跳转** — 需要 key 的内置 provider 在设置卡带「获取 API key ↗」一键跳官方控制台；免 key 的（SearXNG / Tavily keyless）不渲染。
- **会话事件** — 有会话发起者时，DeepSeek 在派发前记录脱敏模型请求到 `web/deepseek-search-llm-request`；REST 后端不追加自定义事件。

## 特性

- 与官方 `@deepseek-ai/dsh-web-search-deepseek` 相同的提供方约定：`inject: ['web']` + 全`volatile()` 配置字段 + `ctx.web.registerSearchProvider`。
- 自定义配置卡片位于 **设置 → 网页搜索**。
- **默认引擎为 DeepSeek（官方）**：新装 / 未显式改动时，搜索直接走 `deepseek-official`，不再依赖 keyless 的 Tavily。
- **9 个后端**中，8 个纯 REST 后端由**静态元数据表 + 通用后端**驱动；只有 DeepSeek 官方走模型轮次。新增内置 REST 引擎还需同步配置字段和客户端引擎列表。
- Tavily keyless 无需密钥即可用；Brave 需要订阅 token（若本机已有 `BRAVE_API_KEY` 凭据，可直接复用）。
- Tavily keyed / Brave 在设置卡展示额度进度条（DeepSeek 官方与 Tavily keyless / 其余 REST 后端不展示）。
- 各引擎结果都规范化为接缝的 `WebSearchResult`（可选 `content` + `sources[]`），按 URL 去重。
- 配置由当前 Profile 的插件配置保存，全部字段声明为 `volatile()`：改引擎或端点后无需重启插件即可生效。
- 插件列表页与详情页的标题、描述随界面语言切换（`locale/*.json`）；卡片内文案自带中英字典。
- 错误映射为 `WEB_PROVIDER_ERROR` / `WEB_ABORTED` / `WEB_PROVIDER_CREDENTIAL_MISSING`。

## 运行要求

- DeepSeek Harness `0.2.0-rc.2` 或兼容的 `0.2.x` 版本
- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm，用于通过 `dsh plugin` 把插件装进 profile

## 安装

本包是 **bundle**：`dsh.bundle.patch` + `cordis.patch.yml` 会插入 Host 行、把 `web.searchProvider` 设为 `dsh-web-search`，并禁用内置 `web-search-deepseek` Host 插件，使此 profile 的 DeepSeek 搜索由本插件统一配置。本插件注册到接缝的 id 是 `dsh-web-search`；`deepseek-official` 是内部引擎选项，和内置插件注册的 id 不同。没有 bundle 声明时，`dsh plugin add` 只写入依赖，插件不会挂载。

### 从 npm 安装

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

> 从源码仓库本地安装（含 Windows 跨盘注意事项）见 [开发 → 本地安装与验证](#本地安装与验证)。

## 配置

设置卡编辑的是 `dsh-web-search-plugin` 命名空间。设置卡中的 API key 输入框把密钥写入凭据服务；若直接在插件配置中填写 `*ApiKey` 字段，则该字面量保存在插件配置中。建议使用设置卡或凭据引用名，避免在配置文件中保存密钥。

| 键 | 默认值 | 含义 |
|---|---|---|
| `provider` | `deepseek-official` | `tavily`、`brave`、`deepseek-official`、`serper`、`serpapi`、`exa`、`searxng`、`scavio` 或 `firecrawl` |
| `mode` | `keyless` | 仅 Tavily：`keyless` 或 `keyed` |
| `apiKey` | — | Tavily API key 配置字面量；设置卡的 key 输入框写入凭据服务 |
| `apiKeyEnv` | `TAVILY_API_KEY` | keyed Tavily 使用的凭据/环境变量名 |
| `baseURL` | 空 | Tavily REST 基址；留空时依次使用 `TAVILY_BASE_URL` 和 `https://api.tavily.com`，再拼 `/search` |
| `maxResults` | `8` | 插件返回的源数量上限，与调用方的 `request.maxResults` 取较小值。设置卡为 1–20 下拉；SearXNG 不支持请求级数量参数，只在收到结果后截取 |
| `searchDepth` | `basic` | 仅 Tavily：`basic` 或 `advanced` |
| `includeAnswer` | `true` | 仅 Tavily：请求生成摘要，写入结果 `content` |
| `topic` | `general` | 仅 Tavily：`general` 或 `news` |
| `deepseekApiKey` | — | DeepSeek API key 配置字面量；设置卡的 key 输入框写入凭据服务 |
| `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` | DeepSeek 使用的凭据/环境变量名 |
| `deepseekBaseURL` | 空 | DeepSeek Anthropic 兼容 Messages 基址；留空时依次使用 `DEEPSEEK_SEARCH_BASE_URL` 和 `https://api.deepseek.com/anthropic/v1`，再拼 `/messages` |
| `model` | `deepseek-v4-flash` | Anthropic 格式模型名 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 请求头 |
| `maxTokens` | `4096` | Messages 请求生成 token 上限 |
| `maxUses` | `5` | 每次请求 `web_search` 工具的最大调用次数 |
| `braveApiKey` | — | Brave 订阅 token 配置字面量；设置卡的 key 输入框写入凭据服务 |
| `braveApiKeyEnv` | `BRAVE_API_KEY` | Brave 使用的凭据/环境变量名 |
| `braveBaseURL` | `https://api.search.brave.com/res/v1/web/search` | Brave 网页搜索接口 |
| `country` | — | Brave 的 `country`（ISO 两位码，如 `cn`）；留空使用 Brave 默认 |
| `searchLang` | — | Brave 的 `search_lang`（如 `zh-hans`）；留空使用 Brave 默认 |
| `freshness` | — | Brave 的 `freshness`：`pd` / `pw` / `pm` / `py` |
| `proxy` | — | Brave 使用的 HTTP(S) 代理覆盖；留空继承 DSH 的全局 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 策略 |
| `serperApiKey` / `serperApiKeyEnv` / `serperBaseURL` | — / `SERPER_API_KEY` / `https://google.serper.dev` | Serper 的配置字面量 key / 凭据引用名 / REST 基址 |
| `serpapiApiKey` / `serpapiApiKeyEnv` / `serpapiBaseURL` | — / `SERPAPI_API_KEY` / `https://serpapi.com` | SerpApi 的配置字面量 key / 凭据引用名 / REST 基址 |
| `exaApiKey` / `exaApiKeyEnv` / `exaBaseURL` | — / `EXA_API_KEY` / `https://api.exa.ai` | Exa 的配置字面量 key / 凭据引用名 / REST 基址 |
| `searxngBaseURL` | `https://searx.be` | SearXNG 实例基址；可改为自托管地址 |
| `scavioApiKey` / `scavioApiKeyEnv` / `scavioBaseURL` | — / `SCAVIO_API_KEY` / `https://api.scavio.dev` | Scavio 的配置字面量 key / 凭据引用名 / REST 基址 |
| `firecrawlApiKey` / `firecrawlApiKeyEnv` / `firecrawlBaseURL` | — / `FIRECRAWL_API_KEY` / `https://api.firecrawl.dev` | Firecrawl 的配置字面量 key / 凭据引用名 / REST 基址 |

环境变量：启动时 `DSH_WEB_SEARCH_PROVIDER=dsh-web-search` 会选中本接缝 id。`baseURL` 留空时，Tavily 基址回退 `TAVILY_BASE_URL`；`deepseekBaseURL` 留空时回退 `DEEPSEEK_SEARCH_BASE_URL`。

## 额度

- **Tavily keyless / DeepSeek 官方**：不展示额度条。前者是免费限流、没有账户配额；后者按次扣费、没有月度限额。
- **Tavily keyed**：搜索时请求 `include_usage`，在内存中累加当前凭据的 credits。Host 定时调用 `GET /usage`，设置卡也可手动刷新；手动刷新之间至少间隔 10 秒，自动对账不受此限制。用 `account.current_plan` / `plan_limit` 做限额，用量取当前凭据的本地累计与远端的较大值；换 key 时清空旧账户用量并立即重新对账。旧 Tavily 额度不再持久化到磁盘。
- **Brave**：没有 usage / 花费接口。控制台 **Capacity** 就是响应头里的每秒窗口（例如 50 次/秒）。月限额 `0` 表示不限请求次数，不是额度用完。计费 credits 只能看 [Brave API 控制台](https://api-dashboard.search.brave.com/)。
- 浏览器只读 `GET /dsh-web-search/usage`（不直打上游）。进度条：剩余超过 20% 为绿色，不超过 20% 为黄色，不超过 10% 为红色。

## 卸载

若要改用 DSH 内置的 DeepSeek host 插件，先卸载本插件及其 bundle patch：

```powershell
dsh plugin --profile web remove dsh-web-search-plugin
```

随后检查 profile 中实际生效的 `web.searchProvider`；若曾手工覆盖为 `dsh-web-search`，将该覆盖改回 `deepseek-official`。

## 工作方式

- **DeepSeek** — `POST {deepseekBaseURL}/messages`，工具 `web_search_20250305`。会话运行在 DeepSeek 官方账号路由（provider 为 `deepseek-account`）且账号服务允许该端点时，用账号令牌发 `x-dsh-auth-token`；否则回落到 API key（`x-api-key` / `authorization: Bearer`，凭据名 `DEEPSEEK_API_KEY`）。有会话发起者时，在派发前把脱敏请求记录为会话事件 `web/deepseek-search-llm-request`。
- **纯 REST 类（Tavily / Brave / Serper / SerpApi / Exa / SearXNG / Scavio / Firecrawl）** — 由静态元数据表（`lib/providers.js`）+ 通用后端（`lib/rest.js`）驱动。请求方法 / 路径 / 查询字段名 / 鉴权（bearer / header / none / query）/ 固定参数 / 响应形态由表中的行决定。
  - **Tavily** — `POST {baseURL}/search`。keyless 发送 `x-tavily-access-mode: keyless`；keyed 发送 `authorization: Bearer <key>`，并带 `include_usage` 回传 credits。
  - **Brave** — `GET {braveBaseURL}?q=&count=`，请求头 `x-subscription-token`。不向 session 追加自定义事件。
  - **其余六种 REST 引擎** — 按各自表的 `method` / `auth` / `params` 约定请求。
- 非 2xx 映射为 `WEB_PROVIDER_ERROR`；调用方取消映射为 `WEB_ABORTED`。

## 仓库布局

```
lib/index.js       Host 插件：volatile Config、按元数据分发提供方、额度路由
lib/providers.js   静态元数据表：8 个 REST provider（另加 deepseek.js 的 DeepSeek，共9 个后端）的请求/鉴权/响应/官方跳转（纯数据，无定制代码）
lib/rest.js        通用 REST 后端：按元数据驱动请求构造与响应规范化（含 Tavily / Brave 的额度与限流 hook）
lib/deepseek.js    DeepSeek 后端（Anthropic Messages + web_search_20250305 + 账号令牌）
lib/tavily.js      Tavily 专用后端与选项解析（当前分发使用 rest 通用后端）
lib/brave.js       Brave 专用后端与选项解析（当前分发使用 rest 通用后端）
lib/usage.js       Tavily/Brave 用量本地缓存与 /usage 对账
lib/shared.js      中止 / 凭据解析辅助
lib/client.js      浏览器 bundle：设置分区 + 引擎切换 + 官方 key 跳转 + 额度条
locale/en.json     插件列表页 / 详情页的英文标题与描述
locale/zh.json     同上，中文
cordis.patch.yml   Bundle patch：插入 Host 行、设 searchProvider、禁用内置 deepseek
```

## 开发

### 本地安装与验证

改源码后本机验证，把仓库装进某个 profile（以 `web` 为例）。**同盘**可以直接用相对路径：

```powershell
dsh plugin --profile web add ".\dsh-web-search-plugin"
```

**Windows 跨盘不要 `dsh plugin add` 绝对路径。** Profile 与仓库不在同一盘时，它会写成 `link:` 或 `file:` 加绝对盘符；pnpm 会把盘符当成相对路径，junction 指向一个不存在的目录。做法是先把仓库快照到与 profile **同盘**，再用相对 `file:`：

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\web\.local\dsh-web-search-plugin"
robocopy "<仓库路径>" $dst /E /XD node_modules .git .github .snapshots .workbuddy docs /NFL /NDL /NJH /NJS
```

在 profile 的 `package.json` 里：

```json
"dsh-web-search-plugin": "file:.local/dsh-web-search-plugin"
```

并保证 `dsh.profile.bundles` 含本包，然后：

```powershell
dsh plugin --profile web install
```

`file:` 是快照：改完仓库后要再 robocopy + `install` 并重启 DSH。改了 `package.json` 的 `files` 字段时，pnpm 可能认为快照未变化而跳过更新，需要先删掉 `node_modules/dsh-web-search-plugin` 再装。

用 `dsh --profile web --dump-config` 确认：组成树里应有 `dsh-web-search-plugin` 行，且 `web.searchProvider` 为 `dsh-web-search`。

### 语法检查

```powershell
npm run check
npm test
```

客户端 bundle 必须保持 `window.__ModuleLoader__.load({ id, factory })` 线格式 — 由 `dsh-client-modules` 加载，不是打包器。必须同时导出 `apply` 和 `inject`（`slots`、`locale`、`remote`、`remote.credentials`、`configForms`）。

配置卡片的宿主就是**设置 → 网页搜索**（`settings.section`，`id: "web-search"`），数据来自 `ctx.configForms.get("dsh-web-search-plugin")`，并通过 `configForms.whileServed([namespace], register)` 条件注册：Host 未下发该命名空间时不留痕迹。

本插件不在插件详情页（`plugins.bundle.config`）显示配置。

## 本地化

插件列表页与详情页的标题和描述走 `locale/<lang>.json`，随界面语言切换：

```
locale/en.json    {"meta": {"title": "Web search", "description": "…"}}
locale/zh.json    {"meta": {"title": "网页搜索", "description": "…"}}
```

卡片内的文案由 `lib/client.js` 的 `zh` / `en` 两份字典提供，改动时须保持键名对齐。

## 发布

发布由 GitHub Actions（`.github/workflows/publish.yml`）自动完成：**推送与 `package.json` 版本一致的 `v*` 标签**会带 provenance 发到 npm。向 `main` 的普通推送不会发布。

1. 确认 `package.json` 的 `version` 与即将推送的标签一致，并在 `CHANGELOG.md` 中为该版本填写非空的 `## [版本号]` 章节。
2. 在 GitHub **Settings → Secrets and variables → Actions** 里配置有 publish 权限的 npm automation token（仓库密钥 `NPM_TOKEN`），并允许 Actions 运行。
3. 打标签并推送：

   ```powershell
   $version = node -p "require('./package.json').version"
   git tag "v$version"
   git push origin "v$version"
   ```

工作流会先核对标签与 `package.json` 的 `version`，确认 `CHANGELOG.md` 中对应版本的发布说明非空，再执行 `npm publish --provenance --access public`。

## 参与贡献

欢迎提 issue 和 pull request，见 [issue tracker](https://github.com/X-C1811/dsh-web-search-plugin/issues)。还可以在同一接缝 id 下继续加搜索后端。

## 许可证

[MIT](LICENSE)
