# Provider 元数据化方案（Provider Metadata Plan）

> 调研结论:"把主流 web-search 供应商集成进插件"这件事,**不做每个 provider 的定制代码**,而是在主干上放一张**静态元数据表**,由**一个通用 REST 后端**按元数据驱动执行。本文档回答两个关键质疑:① 元数据表会不会影响 LLM 调用效果;② 面对不同请求头 / 不同查询字段 / 不同 HTTP 方法,这一套能不能真正用起来。本文档是可拍板的方案,确认后再进入代码实现。

---

## 0. 结论速览(TL;DR)

1. **元数据表对 LLM 调用效果零影响** —— 三个既有后端(`brave.js` / `tavily.js` / `deepseek.js`)产出的**都是同一个 `WebSearchResult`(`{ content?, sources[], truncated }`)**,元数据表只接管"如何拿到原始数据"(HTTP 层),不碰"产出什么"(LLM 消费层)。效果只由"你选了哪个 provider"决定。

2. **请求头 / 查询字段 / 鉴权 / 响应结构四类差异,现有 `custom.js` 已覆盖**;但 **HTTP 方法 + 参数映射是硬缺口**,当前 `custom.js` 硬编码 `POST {baseURL}/search` + 固定 `{query, max_results}`,无法表达 Brave/SearXNG 的 `GET ?q=&count=` 形态。**要接管它们必须先补 `method` / `queryIn` / `params` 三个元数据字段。**

3. **模型工具型搜索不能进表** —— `deepseek-official`(以及 Perplexity 工具型、OpenAI Responses)是"模型自己做推理 + `web_search` 工具返回 token",不是"输入查询 → 输出结果数组",必须保留专用后端。

4. **带副作用的钩子要升格为可选回调** —— Tavily 的 `onUsage`(额度回传)、Brave 的 `onRateLimit`(限流头)+ `proxy`(undici ProxyAgent)不能写死进通用体,要作为元数据条目上的可选回调字段。

---

## 1. 定位:与官方 `deepseek-official` 的关系与区别

> 本插件是运行在 DeepSeek Harness `ctx.web` 接缝上的 web-search 提供方,供 LLM 在需要时调用。核心问题:**我们做的,和官方 `deepseek-official` 是不是一回事?有什么区别?**

### 1.1 接口契约:一样

本插件在注册时声明了**与官方完全相同的提供方约定**(见 `lib/index.js` 与 README):

```
inject: ['web'] + installSettingsSection + ctx.web.registerSearchProvider
```

也就是说,在 DSH 眼里,本插件和官方 `web-search-deepseek` 是**同一个接缝(`ctx.web`)上的同一个接口**:`WebSearchProvider`(`id` / `available()` / `search(request, signal)`),返回 `WebSearchResult`。**LLM 调用本插件或官方,走的是同一个调用点,拿到的是同一种数据结构。** 这是"接口契约一样"的含义,也是 README 说"与官方相同的提供方约定"的由来。

因此,**"能不能像官方那样让 LLM 拿到搜索结果"这个能力,本插件天然具备**——契约层面没有门槛。

### 1.2 搜索本质:不一样(关键区别)

差别不在接口,而在**"搜索结果是怎么产生的"**:

| 维度 | 官方 `deepseek-official` | 本插件(其余后端) |
|---|---|---|
| **谁做搜索推理** | DeepSeek 模型自己,Messages API 里的 `web_search_20250305` 工具 | 一个**第三方搜索 API**(Tavily / Brave / 通用 REST) |
| **一次搜索的代价** | 消耗**一个模型轮次**(LLM 调 DeepSeek 官方,拿到中间 token) | 一次**纯 HTTP 请求**,不碰模型 |
| **搜索本质** | 模型"自己上网搜",搜完把网页引用融进回答 | 把查询词丢给搜索引擎,拿回结构化结果数组,喂给模型 |

一句话:**两类 provider 在"给 LLM 供数"这件事上的接口一样,但"谁在做检索功课"不同**——`deepseek-official` 是模型自己做检索推理、花模型轮次;REST 类 provider 是调用第三方搜索 API、花 HTTP 请求而不花模型轮次。

### 1.3 本插件内部正是这两类的合体

本插件目前内部就同时容纳这两类,`provider` 字段据此分发(`lib/index.js:backend()`):

1. **`deepseek-official`** —— **模型工具型**,与官方同源。`lib/deepseek.js` 走 DeepSeek 的 Anthropic 兼容 Messages API + `web_search_20250305` 工具,本质是"复刻官方那套搜索,只是把配置挪到了本插件的设置卡里"。
2. **`tavily` / `brave` / `custom`** —— **REST 型**,调用第三方搜索 API,**完全不经过 DeepSeek 模型**,只返回规范化结果数组(`lib/tavily.js` / `lib/brave.js` / `lib/custom.js`)。

### 1.4 对元数据化改造的直接影响

1. **`deepseek-official` 链路零改变** —— 元数据表**不碰**模型工具型,它继续用 `deepseek.js`。"能不能像官方那样搜"的能力,是**已具备、且不会被改造影响**的能力。
2. **REST 型 provider 迁到元数据表,改变的是"取数方式",不是"供数契约"** —— 迁完后 LLM 拿到的仍是 `WebSearchResult`,与迁移前一致;元数据表只是把手写的 GET/POST/鉴权/解析换成数据驱动,**LLM 感知不到任何区别**。

> 这一区分是后文 §3(元数据表是否影响 LLM)与 §4(进表/不进表边界)的前提:凡"模型自己做检索推理"的,不进元数据表;凡"一个查询 → 一次 HTTP → 一个结果数组"的,进元数据表。

---

## 2. 目标

在现有 `dsh-web-search-plugin`(单一 seam id `dsh-web-search`,内部按 `provider` 分发)基础上,把"纯 REST 搜索 API"这一大类 provider 从"每个一个后端类"改造成:

- **一张静态元数据表** `lib/providers.js` 描述主流 provider 的全部 HTTP 行为;
- **一个通用后端** `lib/rest.js`(在现有 `custom.js` 基础上扩展)按元数据驱动执行;
- **模型工具型**(`deepseek-official`)单独保留专用后端,不进表;
- 每个 provider 元数据携带 `officialUrl`,设置卡渲染"获取 API key ↗"跳官方控制台。

最终效果:**新增一个纯 REST provider ≈ 在表里加一行数据 + 可选一个官方跳转链接,零定制代码。**

---

## 3. 关键质疑的逐条回应(带代码依据)

### 3.1 元数据表会不会影响 LLM 调用效果?

**不会。** 证据是三个既有后端的返回形状完全一致:

| 后端 | 返回结构 | 出处 |
|---|---|---|
| `brave.js` | `{ sources[], truncated: false }` | `lib/brave.js:52-55` |
| `tavily.js` | `{ content?, sources[], truncated: false }` | `lib/tavily.js:42-46` |
| `deepseek.js` | `{ sources[], truncated: false }` | `lib/deepseek.js:62` |

LLM 端拿到的是同一份规范化结果。元数据表改变的是请求构造(`GET`/`POST`、鉴权头、查询字段名、结果数组位置),这些在 `search()` 内部完成,**不改变 `search()` 的返回契约**。因此对 LLM 透明。

> 例外:provider 之间的"效果差异"始终存在(Brave 结果 ≠ Tavily 结果),但这来自**数据源本身**,与"是不是元数据表"无关。

### 3.2 不同请求头 / 不同查询字段,这一套能用起来吗?

**能,但要先补两个缺口。** 逐项核对:

| 差异维度 | 现状支持 | 说明 |
|---|---|---|
| 不同鉴权头 | ✅ `auth: header` + `authHeader` | Brave 的 `X-Subscription-Token` |
| 不同鉴权方式 | ✅ `auth: bearer / header / none` | Tavily / Brave / SearXNG / DDG |
| 不同查询字段名 | ✅ `queryParam` | Serper 用 `q`,Tavily 用 `query` |
| 不同响应结构 | ✅ 宽容解析 `mapCustomResponse` | `web.results` / `organic` / 裸数组 |
| **不同 HTTP 方法** | ❌ `custom.js` 硬编码 `POST {baseURL}/search` | **缺口 1** |
| **不同参数名 / 额外固定参数** | ❌ 固定 `{query, max_results}` | **缺口 2** |

**缺口 1 —— HTTP 方法硬编码。** `lib/custom.js:127` `const endpoint = .../search` + `method: "POST"`。而:
- Brave = `GET {baseURL}?q=&count=country=&search_lang=&freshness=`(`lib/brave.js:78-84`);
- Tavily = `POST {baseURL}/search`(`lib/tavily.js:70`);
- SearXNG = `GET /search?q=&format=json`。

**缺口 2 —— 参数映射与固定参数。** `lib/custom.js:128-131` 只发 `{ [queryParam]: query, max_results: n }`。而:
- Tavily 还有 `search_depth / topic / include_answer / include_usage`(`lib/tavily.js:72-80`),且 keyed 才带 `include_usage`;
- Brave 的 `count`(不是 `max_results`)、`country`、`search_lang`、`freshness`(`lib/brave.js:77-83`)。

> **结论:** 再给元数据条目加 `method`、`queryIn`(query 放 URL 还是 body)、`params`(固定参数及 `maxResults` 的目标字段名映射)三个字段,即可**在不写定制代码的前提下**覆盖 Brave/SearXNG/DDG 这类 GET 型与 Tavily/Serper/SerpApi 这类 POST 型。

---

## 4. 边界:什么进表,什么不进

### 4.1 进表(纯 REST,单次请求,返回结果数组)

满足 **"一个查询 → 一次 HTTP 请求 → 一个结果数组"** 的 provider:

| provider | method | 鉴权 | 备注 |
|---|---|---|---|
| Brave Search | GET | header `X-Subscription-Token` | 需 key;`count` 不是 `max_results` |
| Tavily | POST | bearer(或 keyless 无 key) | 带 `search_depth` 等固定参数;keyed 回传 credits |
| Serper | POST | header `X-API-KEY` | 查询字段 `q` |
| SerpApi | GET | query param `api_key` | 查询字段 `q` |
| Exa | POST | bearer | 裸 `results[]` |
| SearXNG | GET | none(自建) | `format=json`,`results[]` |

### 4.2 不进表(专用后端 / 工具型 / 库调用)

| 项 | 归类 | 原因 |
|---|---|---|
| `deepseek-official` | **模型工具型** | Anthropic Messages + `web_search_20250305`,烧模型轮次,非 REST(见 §1.3、`lib/deepseek.js`) |
| Perplexity 工具型(`sonar` Chat Completions) | **模型工具型** | 同上,LLM 调用形态 |
| DuckDuckGo | **self-host / no-key** | 无官方免费 API;Open WebUI 走 `ddgs` 库或社区端点,非单一 REST 端点 |

> DDG 不作为"一等内置 provider"进表,而是归类为 **self-host / no-key 社区项**,由用户走 `customProviders` 入口自行填端点(或后续作为"免 key 端点预设"单独呈现)。

---

## 5. 元数据条目设计

新增 `lib/providers.js`,导出一个纯数据数组 `REST_PROVIDERS` 与一个 lookup 函数。条目结构:

```js
{
  id: "brave",                                  // 稳定主键(与现有 provider 值一致)
  name: "Brave Search",
  kind: "rest",                                 // "rest" | "tool"(tool 不进此表,占位说明)
  method: "GET",                                // GET | POST
  baseURL: "https://api.search.brave.com/res/v1/web/search",
  path: "",                                     // POST 型追加的路径段(Tavily 为 "/search")
  queryIn: "query",                             // query 放 URL(query)还是 body(body)
  queryParam: "q",                              // 查询词字段名(Serper "q" / Tavily "query")
  countParam: "count",                          // maxResults 映射的目标字段名(Tavily "max_results" / Brave "count" / Serper "num")
  auth: { type: "header", header: "X-Subscription-Token" },  // type: bearer | header | none | query
  keyRequired: true,
  apiKeyRef: "BRAVE_API_KEY",                   // 默认凭据引用名
  response: "brave",                            // tavily | brave | exa | serper(现有宽容解析)
  params: [                                     // 额外固定参数(可选)
    { key: "country", setting: "country", when: "nonEmpty" },
    { key: "search_lang", setting: "searchLang" },
    { key: "freshness", setting: "freshness" },
    { key: "format", value: "json", when: "always" }   // SearXNG 需要
  ],
  officialUrl: "https://api-dashboard.search.brave.com/",  // "获取 API key" 跳转
  hooks: ["rate-limit", "proxy"]               // 该 provider 需要的可选回调(见 §6)
}
```

**字段语义澄清:**

- `queryIn` — `query` 表示查询词进 URL 查询串(GET 型);`body` 表示进 JSON 请求体(POST 型)。避免"GET 一定放 URL / POST 一定放 body"的隐含假设(SerpApi 是 GET 但 key 在 query,查询词也在 query)。
- `countParam` — 把 seam 的 `maxResults` 映射成 provider 自己的字段名,替代现在写死的 `max_results`。
- `params[]` — 固定/可选参数,`when` 取**受限谓词清单**中的一个(不引入任意函数,保持元数据为纯数据/可 JSON 序列化):
  - `always` —— 常量参数始终发送(如 SearXNG 的 `format=json`);
  - `nonEmpty` —— 对应 setting 非空才发送(如 Brave 的 `country` / `search_lang` / `freshness`);
  - `keyed` —— 仅 keyed 运行时发送(如 Tavily 的 `include_usage`);
  - `keyless` —— 仅 keyless 运行时发送。
- `auth.type: query` —— **已纳入首批**:SerpApi 的 `api_key` 作为 query param、DDG 无鉴权(`type: none`)这两类都要能表达(现有 `custom.js` 只认 header/bearer/none,需新增 `query` 取值)。

---

## 6. 副作用钩子:从写死升格为可选回调

现有三类"带副作用"能力不能写死进通用体,改为元数据 `hooks[]` 触发的可选值:

| 现能力 | 出处 | 归属(已定) |
|---|---|---|
| Tavily keyed 的 `include_usage` 请求参数 | `lib/tavily.js:72-80` | **归入 `params[]{ key, value, when: "keyed" }`**(元数据管"发什么") |
| Tavily keyed `credits` 的响应回传 `onUsage(credits)` | `lib/tavily.js:112-116` | hook `usage`:通用后端调用后,若 provider 声明且回调存在,则回传 credits(元数据/hook 管"回来干嘛") |
| Brave `onRateLimit(headers)` | `lib/brave.js:104` | hook `rate-limit`:响应后把 headers 交给回调 |
| Brave `undici ProxyAgent` | `lib/brave.js:130-140` | hook `proxy`:通用后端在 `proxy` 配置非空时构造 dispatcher |

通用后端在构造时接收一个可选的 `hooks` 对象,有对应 hook 才调用,没有则跳过。这样**通用体保持干净**,Tavily/Brave 的特有能力仍由主干 register 处的 option 闭包注入(与现在 `PluginSearchProvider` 的 `onUsage` / `onRateLimit` 注入方式一致)。

---

## 7. 落地结构(拟)

```
lib/providers.js   新增:静态元数据表 + lookup(REST_PROVIDERS)
lib/rest.js        新增:通用 REST 后端(由 custom.js 扩展而成,支持 method/queryIn/params/hooks)
lib/custom.js      保留/改造:customProviders[] 复用通用 REST 后端(用户自建)
lib/index.js       改:backend() 按元数据路由;内置 REST provider 走通用后端;deepseek 仍走专用
lib/brave.js       降级:保留 mapBraveResponse 与 resolveBraveOptions(或其能力并入元数据);不再有独立执行类
lib/tavily.js      降级:同上;额度/usage 能力以 hook 形式由通用后端回调
lib/deepseek.js    不变:模型工具型专用后端
lib/client.js      改:provider 下拉从元数据驱动;每条卡渲染 officialUrl "获取 API key" 跳转
```

> **兼容性红线:** `provider` 的取值(`tavily` / `brave` / `deepseek-official` / 自定义 id)必须保持不变,已保存会话引用的 provider id 不受影响;`search()` 返回契约(`WebSearchResult`)不变。

---

## 8. 已拍板的决定

> 以下条目已经定案,作为实现的硬约束;不再是待议项。

1. **DDG 定位(已定)** —— self-host / no-key 社区项,**不进**一等内置表,走 `customProviders` 或后续"免 key 预设"。DDG 无官方免费搜索 API(Instant Answer 不适用于通用网页搜索,网页搜索需抓取/社区库,非单一 REST 端点)。

2. **SerpApi 的 `api_key` 走 query param(已定:纳入首批)** —— 元数据 `auth.type` 新增 `query` 取值,通用后端的鉴权构造支持 `type: query`(key 进 URL 查询串)。`auth.type` 最终取值:`bearer` / `header` / `none` / `query`。

3. **`params[].when` 用受限谓词清单(已定)** —— 不引入任意函数,取值仅限 `always` / `nonEmpty` / `keyed` / `keyless`,保证元数据是纯数据、可 JSON 序列化、可校验。凡超出这四个谓词的运行时分支,不做本次基线(见 §10)。

4. **`include_usage` 与额度回传解耦(已定)** —— 请求侧的 `include_usage` 是参数,归入 `params[]{ key, value, when: "keyed" }`;响应侧的 credits 记账走 hook `usage`。二者职责分离:元数据管"发什么",hook 管"回来干嘛"。

---

## 9. 验收标准(待实现后勾选)

- [ ] `break` 到"新增一个纯 REST provider = 表里加一行 + 官方跳转链接",不写定制执行代码。
- [ ] Brave / Tavily 迁到通用 REST 后端后,`provider: brave` / `provider: tavily` 搜索行为与迁移前一致(方法、鉴权头、参数、结果规范化)。
- [ ] GET 型(Brave/SearXNG)与 POST 型(Tavily/Serper/SerpApi)都能被通用后端正确处理。
- [ ] Tavily keyed 额度回传、Brave 限流头与代理能力经 hook 保留,不退化。
- [ ] `deepseek-official` 仍走专用后端,行为不变。
- [ ] `provider` 取值与 `WebSearchResult` 返回契约不变(兼容已保存会话)。
- [ ] 设置卡对"需要 key"的 provider 渲染"获取 API key ↗"跳官方控制台;免 key 的(SearXNG / keyless)不渲染。

---

## 10. 未覆盖(明确排除,留待后续)

- 模型工具型 provider 的通用化(Perplexity 工具型 / OpenAI Responses)——保持专用,不入本次基线。
- MCP 形态的搜索工具。
- 任意函数式参数模板(`when` 仅限受限谓词清单 `always` / `nonEmpty` / `keyed` / `keyless`,见 §8.3)。
- 多页 / 分页结果聚合。
