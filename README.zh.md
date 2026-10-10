# dsh-web-search-plugin

[English](./README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Agent 提供更多联网搜索选择，沿用 Harness 原有的 `web_search` 工具。内置 **9 个搜索后端**，在 **设置 → 网页搜索** 的卡片中统一管理搜索引擎、API key 和搜索选项。

## 为什么使用本插件？

- **减少搜索时额外的 DeepSeek 模型调用。** 8 个第三方后端直接请求搜索 API，不经过 DeepSeek 官方的模型搜索接口，因此不会产生该次搜索请求额外的 DeepSeek 模型 token 消耗。（对话本身和模型读取搜索结果仍会消耗 token，搜索服务也可能单独收取费用或扣除额度。）
- **在设置卡片中完成配置。** 在 **设置 → 网页搜索** 中切换引擎、填写密钥、调整结果数量，保存后下一次搜索即可生效，无需重启插件或编辑 YAML。
- **按需求选择搜索服务。** 可以通过 Serper 获取 Google 结果，使用 Exa 进行语义搜索，或接入自建 SearXNG。Tavily 的 keyless 模式无需账号和 API key，方便先体验。
- **一键恢复内置搜索。** 在侧栏的 **插件** 页面关闭整个 `dsh-web-search-plugin` 组合包，即可撤销它的搜索配置覆盖，在标准 Profile 配置下恢复 Harness 内置的 DeepSeek 搜索。详见[停用或卸载](#停用或卸载)。

**默认引擎仍为 DeepSeek（官方）。** 若要避免官方搜索额外的模型调用，安装后需要在设置卡片中选择第三方引擎并保存。选择 DeepSeek（官方）时，会使用官方搜索 API，可能产生模型调用费用。

## 支持的搜索后端

- **DeepSeek（官方，默认）** — 使用 DeepSeek 的 Anthropic 兼容 Messages API，原生搜索工具类型为 `web_search_20250305`，支持账号令牌或 `DEEPSEEK_API_KEY`。每次搜索会发起模型请求，可能产生模型调用费用。
- **Tavily** — `keyless`（免费、限流、无需账号）或 `keyed`（`TAVILY_API_KEY`，Bearer token）。keyed 会在设置卡显示额度进度条。
- **Brave Search** — `GET https://api.search.brave.com/res/v1/web/search`，请求头 `X-Subscription-Token`（凭据名 `BRAVE_API_KEY`）。一次搜索就是一次 HTTP 请求，不走模型轮次；设置卡按响应头展示 Capacity / 月配额。
- **Serper** — Google 结果（`POST /search`，头 `X-API-KEY`，凭据名 `SERPER_API_KEY`）。
- **SerpApi** — `GET /search.json`，key 走 query（`api_key=`），凭据名 `SERPAPI_API_KEY`。
- **Exa** — 语义/神经搜索（`POST /search`，Bearer，凭据名 `EXA_API_KEY`），请求 `contents.highlights` 作为结果摘要。
- **SearXNG** — 自建/协议免 key 的元搜索（`GET /search?format=json`），可填自托管实例地址；实例须启用 JSON 输出。
- **Scavio** — Google SERP（`POST /api/v2/google`，Bearer，凭据名 `SCAVIO_API_KEY`），响应与 SerpApi 同构。
- **Firecrawl** — 网页搜索（`POST /v2/search`，Bearer，凭据名 `FIRECRAWL_API_KEY`），`sources: ["web"]`；当前请求没有启用整页抓取。

若需要 DuckDuckGo 结果，可选择聚合了 DuckDuckGo 的 SearXNG 实例。DuckDuckGo 在引擎下拉中仅作为禁用提示项。

## 运行要求

- DeepSeek Harness `0.2.0-rc.2` 或兼容的 `0.2.x` 版本
- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm，用于通过 `dsh plugin` 把插件装进 profile

## 安装

### 从 npm 安装

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

安装后，在 Harness Web 界面中完成配置：

1. 打开 **设置 → 网页搜索**，找到本插件的设置卡片。侧栏的 **插件** 页面负责启用或停用组合包，引擎参数在设置卡片中配置。
2. 选择搜索引擎。若要直接调用搜索 API、避免额外的 DeepSeek 模型调用，可选 Tavily、Brave、Serper、SerpApi、Exa、SearXNG、Scavio 或 Firecrawl。
3. 按需填写所选引擎的 API key，需要密钥的引擎会显示「获取 API key ↗」，点击即可打开官方控制台。Tavily 免 key 使用时选择 `keyless`；SearXNG 填写已启用 JSON 搜索的实例地址，这两种免 key 方式不显示密钥获取链接。已有凭据可以复用，例如 Brave 的 `BRAVE_API_KEY`。
4. 调整返回结果数量等选项，点击 **保存**。下一次搜索会使用保存后的引擎与配置。

> 从源码仓库本地安装（含 Windows 跨盘注意事项）见 [开发 → 本地安装与验证](#本地安装与验证)。

## 配置

日常使用在 **设置 → 网页搜索** 的卡片中配置即可。卡片按当前引擎显示相关选项，普通设置保存到当前 Profile 的 `dsh-web-search-plugin` 配置中。下表是底层配置参考，包含卡片中隐藏的高级字段，并非所有字段都会同时显示。

### 通用配置

| 键 | 默认值 | 含义与范围 |
|---|---|---|
| `provider` | `deepseek-official` | 当前搜索引擎：`deepseek-official`、`tavily`、`brave`、`serper`、`serpapi`、`exa`、`searxng`、`scavio` 或 `firecrawl`。一次请求只使用所选引擎，不会在失败后自动切换到其他引擎；未知值会回退到 DeepSeek 官方引擎 |
| `maxResults` | `8` | 所有引擎的返回源数量上限，范围 1–20，同时受调用方 `request.maxResults` 上限约束。SearXNG 和 Scavio 不发送请求级数量参数，只在收到响应并按 URL 去重后截取；实际可返回的数量取决于上游结果 |

### 密钥与凭据引用

**卡片里的「API Key」输入框与下表的字面量字段不同。** 输入新密钥并保存时，卡片将它写入当前引擎的凭据引用名，而不是把明文密钥写入插件配置；同时将对应的字面量字段设为空字符串，避免旧配置中的密钥覆盖新凭据。输入框留空表示保留现有密钥，不表示删除密钥；删除凭据需通过 Harness 的凭据管理能力完成。

| 引擎 | 配置字面量字段 | 凭据引用字段 | 默认引用名 |
|---|---|---|---|
| DeepSeek（API key 认证） | `deepseekApiKey` | `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` |
| Tavily（仅 `keyed`） | `tavilyApiKey` | `tavilyApiKeyEnv` | `TAVILY_API_KEY` |
| Brave | `braveApiKey` | `braveApiKeyEnv` | `BRAVE_API_KEY` |
| Serper | `serperApiKey` | `serperApiKeyEnv` | `SERPER_API_KEY` |
| SerpApi | `serpapiApiKey` | `serpapiApiKeyEnv` | `SERPAPI_API_KEY` |
| Exa | `exaApiKey` | `exaApiKeyEnv` | `EXA_API_KEY` |
| Scavio | `scavioApiKey` | `scavioApiKeyEnv` | `SCAVIO_API_KEY` |
| Firecrawl | `firecrawlApiKey` | `firecrawlApiKeyEnv` | `FIRECRAWL_API_KEY` |

所有字面量字段默认均为空字符串。手动设置的非空字面量密钥优先使用；否则插件按引用名依次查询 **凭据服务 → Harness 启动环境 → 进程环境变量**。`*ApiKeyEnv`填写的是引用名，不是密钥本身；卡片要求名称符合 `[A-Za-z_][A-Za-z0-9_]*`。

DeepSeek 官方账号会话（provider 为 `deepseek-account`）会优先尝试由账号服务获取获准用于该端点的账号令牌；未取得令牌时才使用上述 API key 路径。Tavily `keyless` 和 SearXNG 的搜索请求无需 API key；为 Tavily 配置密钥不会自动切换到 `keyed`，需手动选择该模式。当前 SearXNG 后端不提供实例 token 或自定义鉴权头配置。

凭据写入与 Profile 配置保存分两步执行：保存失败时卡片会保留草稿，但已成功写入的凭据不会自动回滚。日常使用建议通过卡片管理密钥，避免在配置文件中保存明文字面量。

### 接口地址

下表列出未指定自定义地址或环境变量覆盖时实际使用的地址。通常无需填写接口地址；Tavily 和 DeepSeek 也支持通过启动环境变量指定地址。

| 键 | 默认使用地址 | 地址规则 |
|---|---|---|
| `deepseekBaseURL` | `https://api.deepseek.com/anthropic/v1` | DeepSeek Anthropic 兼容 Messages 基址：非空配置 → 启动环境中的 `DEEPSEEK_SEARCH_BASE_URL` → 默认地址；追加 `/messages` |
| `tavilyBaseURL` | `https://api.tavily.com` | Tavily 基址：非空配置 → 启动环境中的 `TAVILY_BASE_URL` → 默认地址；追加 `/search` |
| `braveBaseURL` | `https://api.search.brave.com/res/v1/web/search` | 完整网页搜索接口，不再追加路径 |
| `serperBaseURL` | `https://google.serper.dev` | 追加 `/search` |
| `serpapiBaseURL` | `https://serpapi.com` | 追加 `/search.json` |
| `exaBaseURL` | `https://api.exa.ai` | 追加 `/search` |
| `searxngBaseURL` | `https://searx.be` | 追加 `/search?format=json` 并传入搜索词；实例必须允许 JSON 搜索。默认地址不保证可用，可改为自建实例 |
| `scavioBaseURL` | `https://api.scavio.dev` | 追加 `/api/v2/google` |
| `firecrawlBaseURL` | `https://api.firecrawl.dev` | 追加 `/v2/search` |

以上都是各引擎的地址配置，修改地址不会改变请求方法、鉴权方式或响应解析规则。自定义端点必须兼容对应引擎的协议，不能仅靠替换地址接入任意搜索 API。除 Brave 外，填写基址时不要重复包含表中自动追加的路径。除 Tavily 和 DeepSeek 外，有效地址配置为空时回退到内置默认地址，没有额外的专用环境变量回退。

卡片中文本框清空或「恢复默认」通常会移除当前 Profile 的覆盖，重新使用继承值或默认值；这与手动在配置中写入空字符串不同。地址回退按最终生效的配置值判断。

### 供应商专用选项

<table>
  <thead>
    <tr><th>供应商</th><th>键</th><th>默认值</th><th>含义与范围</th></tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="4"><strong>DeepSeek（官方）</strong></td>
      <td><code>deepseekModel</code></td>
      <td><code>deepseek-flash</code></td>
      <td>仅 DeepSeek 搜索请求使用的模型名，不会修改会话的聊天模型；需由目标端点支持</td>
    </tr>
    <tr>
      <td><code>deepseekApiVersion</code></td>
      <td><code>2023-06-01</code></td>
      <td><code>anthropic-version</code> 请求头值；设置卡不显示，保留为高级配置，通常保持默认</td>
    </tr>
    <tr>
      <td><code>deepseekMaxTokens</code></td>
      <td><code>4096</code></td>
      <td>单次 DeepSeek Messages 搜索请求的生成 token 上限，正整数；不是整个对话的 token 上限</td>
    </tr>
    <tr>
      <td><code>deepseekMaxUses</code></td>
      <td><code>5</code></td>
      <td>单次 DeepSeek Messages 请求中原生 <code>web_search</code> 工具的最大使用次数，正整数；不是引擎重试次数或结果数量</td>
    </tr>
    <tr>
      <td rowspan="4"><strong>Tavily</strong></td>
      <td><code>tavilyMode</code></td>
      <td><code>keyless</code></td>
      <td>仅 Tavily：免 key 的 <code>keyless</code> 或使用 API key 的 <code>keyed</code>；不是其他引擎的鉴权开关</td>
    </tr>
    <tr>
      <td><code>tavilySearchDepth</code></td>
      <td><code>basic</code></td>
      <td>仅 Tavily：<code>basic</code> 或 <code>advanced</code>，对应 <code>search_depth</code></td>
    </tr>
    <tr>
      <td><code>tavilyIncludeAnswer</code></td>
      <td><code>true</code></td>
      <td>仅 Tavily：开启时请求 <code>include_answer: true</code>。当前通用 REST 后端关闭时省略该参数；若上游仍返回 answer，仍可能写入结果 <code>content</code>，不保证彻底移除摘要</td>
    </tr>
    <tr>
      <td><code>tavilyTopic</code></td>
      <td><code>general</code></td>
      <td>仅 Tavily：<code>general</code> 或 <code>news</code></td>
    </tr>
    <tr>
      <td rowspan="4"><strong>Brave</strong></td>
      <td><code>braveCountry</code></td>
      <td>空字符串</td>
      <td>仅 Brave：发送 <code>country</code>（两位国家码，如 <code>cn</code>）；有效值为空时省略参数</td>
    </tr>
    <tr>
      <td><code>braveSearchLang</code></td>
      <td>空字符串</td>
      <td>仅 Brave：发送 <code>search_lang</code>（如 <code>zh-hans</code>）；有效值为空时省略参数</td>
    </tr>
    <tr>
      <td><code>braveFreshness</code></td>
      <td>空字符串</td>
      <td>仅 Brave：<code>pd</code> / <code>pw</code> / <code>pm</code> / <code>py</code>，分别为过去一天 / 一周 / 一个月 / 一年；空值不限制时间</td>
    </tr>
    <tr>
      <td><code>braveProxy</code></td>
      <td>空字符串</td>
      <td>仅 Brave 的显式 HTTP(S) 代理覆盖。为空时不设置独立代理，沿用 Harness 的全局网络策略；其他引擎不使用该字段</td>
    </tr>
    <tr>
      <td rowspan="2"><strong>Scavio</strong></td>
      <td><code>scavioCountry</code></td>
      <td>空字符串</td>
      <td>仅 Scavio：发送 <code>gl</code>，使用该服务接受的国家/地区码；有效值为空时省略参数</td>
    </tr>
    <tr>
      <td><code>scavioSearchLang</code></td>
      <td>空字符串</td>
      <td>仅 Scavio：发送 <code>hl</code>，使用该服务接受的语言码；有效值为空时省略参数，不与 Brave 共享新配置</td>
    </tr>
  </tbody>
</table>

启动环境变量 `DSH_WEB_SEARCH_PROVIDER=dsh-web-search` 选择的是 Harness 的搜索提供方 id，并不会替代本插件的 `provider` 引擎选项。通常安装组合包已完成提供方选择，无需额外设置此变量。

## 额度

- **DeepSeek（官方）**：不展示额度条。仍会发起模型搜索请求，用量按所用账号或 API 的计费规则处理。
- **Tavily keyless**：不展示额度条，免费且有限流。
- **Tavily keyed**：搜索时请求 `include_usage`，在内存中累加当前凭据的 credits。Host 定时调用 `GET /usage`，设置卡也可手动刷新；手动刷新之间至少间隔 10 秒，自动对账不受此限制。用 `account.current_plan` / `plan_limit` 做限额，用量取当前凭据的本地累计与远端的较大值；换 key 时清空旧账户用量并立即重新对账。旧 Tavily 额度不再持久化到磁盘。
- **Brave**：没有 usage / 花费接口。控制台 **Capacity** 就是响应头里的每秒窗口（例如 50 次/秒）。月限额 `0` 表示不限请求次数，不是额度用完。计费 credits 只能看 [Brave API 控制台](https://api-dashboard.search.brave.com/)。
- 浏览器只读 `GET /dsh-web-search/usage`（不直打上游）。进度条：剩余超过 20% 为绿色，不超过 20% 为黄色，不超过 10% 为红色。

## 停用或卸载

### 优先切换到 DeepSeek（官方）

如果只是想重新使用官方搜索，在 **设置 → 网页搜索** 中选择 **DeepSeek（官方）** 并保存即可，无需关闭或卸载本插件。下一次搜索会使用本插件接入的官方搜索 API，仍可能产生模型调用费用。

### 停用并恢复内置搜索

若希望停用本插件、恢复 Harness 原装的搜索插件，再执行以下操作。切换到本插件中的 DeepSeek 引擎与恢复原装插件是两种不同操作。

打开侧栏 **插件** 页面，关闭 **整个 `dsh-web-search-plugin` 组合包的开关**。在标准 Harness Profile 配置下，这会撤销组合包对搜索提供方的覆盖，以及禁用内置 DeepSeek 插件的覆盖，恢复官方自带的搜索，无需卸载安装包；之后也可以重新打开组合包。

请使用组合包的总开关：仅关闭包内某个组件，其他配置覆盖仍会保留。启用配置热更新的 Profile 会立即应用改动，否则需要重启 Harness。

如果曾手工设置 `web.searchProvider: dsh-web-search`、`DSH_WEB_SEARCH_PROVIDER=dsh-web-search`，或另行禁用内置 DeepSeek 插件，还需移除或恢复这些覆盖。组合包开关不会撤销你单独添加的配置。

### 卸载安装包

若要同时移除安装包，可执行：

```powershell
dsh plugin --profile web remove dsh-web-search-plugin
```

卸载后同样需要检查单独添加的覆盖。若曾显式选用 `dsh-web-search`，可移除该覆盖以使用 Profile 默认值，或将 `web.searchProvider` 改回 `deepseek-official`。

## 工作方式

本插件通过 `ctx.web` 注册一个稳定 id 为 `dsh-web-search` 的 `WebSearchProvider`，遵循与官方 `@deepseek-ai/dsh-web-search-deepseek` 相同的提供方约定（`inject: ['web']` 和 `ctx.web.registerSearchProvider`）。切换内部引擎无需改动 `web.searchProvider`。各引擎结果规范化为 `WebSearchResult`（可选 `content` 和 `sources[]`），按 URL 去重。全部配置字段声明为 `volatile()`，保存后无需重启插件即可读取新配置。

本包是 **bundle**：`dsh.bundle.patch` 声明指向 `cordis.patch.yml`，组合包启用时会插入 Host 行、选用 `dsh-web-search`，并禁用内置 `web-search-deepseek` Host 插件。本插件的内部 `deepseek-official` 引擎选项与其注册的 `dsh-web-search` id 不同。关闭整个组合包会移除这一补丁层，仅关闭其中的 Host 行则不会。没有 bundle 声明时，`dsh plugin add` 只写入依赖，插件不会挂载。

- **DeepSeek** — `POST {deepseekBaseURL}/messages`，工具 `web_search_20250305`。会话运行在 DeepSeek 官方账号路由（provider 为 `deepseek-account`）且账号服务允许该端点时，用账号令牌发 `x-dsh-auth-token`；否则回落到 API key（`x-api-key` / `authorization: Bearer`，凭据名 `DEEPSEEK_API_KEY`）。有会话发起者时，在派发前把脱敏请求记录为会话事件 `web/deepseek-search-llm-request`。
- **纯 REST 类（Tavily / Brave / Serper / SerpApi / Exa / SearXNG / Scavio / Firecrawl）** — 由静态元数据表（`lib/providers.js`）+ 通用后端（`lib/rest.js`）驱动。请求方法 / 路径 / 查询字段名 / 鉴权（bearer / header / none / query）/ 固定参数 / 响应形态由表中的行决定。REST 后端不追加自定义会话事件。
  - **Tavily** — `POST {tavilyBaseURL}/search`。keyless 发送 `x-tavily-access-mode: keyless`；keyed 发送 `authorization: Bearer <key>`，并带 `include_usage` 回传 credits。
  - **Brave** — `GET {braveBaseURL}?q=&count=`，请求头 `x-subscription-token`。不向 session 追加自定义事件。
  - **其余六种 REST 引擎** — 按各自表的 `method` / `auth` / `params` 约定请求。
- 非 2xx 映射为 `WEB_PROVIDER_ERROR`；调用方取消映射为 `WEB_ABORTED`；缺少凭据映射为 `WEB_PROVIDER_CREDENTIAL_MISSING`。

## 仓库布局

```
lib/config.js      供应商字段命名与旧配置兼容解析
lib/index.js       Host 插件：volatile Config、按元数据分发提供方、额度路由
lib/deepseek.js    DeepSeek 后端（Anthropic Messages + web_search_20250305 + 账号令牌）
lib/providers.js   静态元数据表：8 个 REST provider（另加 deepseek.js 的 DeepSeek，共9 个后端）的请求/鉴权/响应/官方跳转（纯数据，无定制代码）
lib/rest.js        通用 REST 后端：按元数据驱动请求构造与响应规范化（含 Tavily / Brave 的额度与限流 hook）
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
