# 更新日志

本项目的重要变更都记录在此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **内置 REST provider 元数据化**（`lib/providers.js` 静态表 + `lib/rest.js` 通用后端）：内置 REST 供应商由单一元数据表驱动，新增即"表里加一行 + 官方跳转链接"，零定制执行代码。
  - 新增内置 provider：**Serper / SerpApi / Exa / SearXNG**（`provider` 值 `serper` / `serpapi` / `exa` / `searxng`）。
  - 元数据字段：`method`（GET/POST）/ `queryIn`（query-string / body）/ `queryParam` / `countParam` / `params[]`（`when: always` / `nonEmpty` / `keyed` / `keyless`，受限谓词清单）/ `auth.type`（bearer / header / none / **query**）/ `response` / `hooks` / `officialUrl`。
  - 通用后端 `RestSearchProvider` 接管 brave / tavily / serper / serpapi / exa / searxng；`deepseek-official`（模型工具型）仍走专用 `lib/deepseek.js`。
  - Tavily 额度回传、Brave 限流头/代理作为可选 hook 注入，通用体不写死业务逻辑。
  - 设置卡对需要 key 的内置 provider 渲染「获取 API key ↗」跳官方控制台；免 key 的（SearXNG / Tavily keyless）不渲染。

### 变更

- **默认引擎从 `tavily` 改为 `deepseek-official`**：schema 默认、服务端/客户端回退、bundle patch 初始值一致改为官方默认（已保存的显式 `provider` 不被覆盖）。
- `provider` 取值扩展为 `tavily` / `brave` / `deepseek-official` / `serper` / `serpapi` / `exa` / `searxng`。

## [0.2.1] - 2026-08-18

相对 0.2.0 的补丁：设置卡补上额度进度条、两列布局和输入校验，并收紧空态文案。

### 新增

- 设置导航「网页搜索」补上地球 logo（与 dsh-credits 相同的 nav mask 做法）。
- **Tavily keyed 额度**：搜索请求带 `include_usage`，把本次 credits 累加到本地高水位；每 10 分钟拉一次 `GET /usage`（计划名 / `plan_limit`），显示 `max(本地, 远端)`。换计划或远端用量回落视为新周期。
- **Brave 额度**：从搜索响应的 `X-RateLimit-*` 解析月配额、剩余量和重置时间，写入本地缓存。
- 设置卡在搜索引擎切换下方展示进度条（已用/剩余、重置时间、绿/黄/红提醒）。DeepSeek 官方与 Tavily keyless 不展示。

### 变更

- 设置卡同一区域的短配置改为两列（搜索引擎/认证、API key/凭据名、深度/主题、国家/语言、模型/版本等）；Base URL、代理仍单行。
- 去掉卡片顶部说明文案；**结果数量**改为 1–20 下拉。
- 国家/语言、代理的「留空…」改到输入框 placeholder，字段下方不再重复。Brave 额度卡把「月请求不限额 / 重置时间」收进卡片内。

### 修复

- 保存按钮在「看起来可点、实际 disabled」时没有反馈。现在始终可点（只读或保存中除外），成功/无变更/失败都会弹出 toast，对齐 dsh-credits。
- 未保存草稿对齐官方插件卡：卡片右上角「未保存」角标、字段「已覆盖 / 恢复默认」，离开设置页再回来仍保留草稿，可继续保存或放弃。
- Tavily keyed 额度卡在 `plan_limit` 尚未拉到时会把已用量藏成「未公布限额 / —」。本地扣费现在会直接显示「已用 N」；首次填入套餐名不再把本地计数清零。
- Brave 月限额 `0` 的套餐按控制台 **Capacity** 展示每秒窗口（例如 50 次/秒），不再把月配额渲染成「已用 0 / 0」。Brave 没有花费/credits 接口。
- 数字框只接受不小于 1 的整数；非法输入用红色错误文案替换灰色 hint，保存会被拦住。超出 20 的结果数量会夹到上限。

## [0.2.0] - 2026-08-19

### 新增

- **DeepSeek（官方）后端**（`lib/deepseek.js`）。设置项 `provider: deepseek-official` 走 DeepSeek 的 Anthropic 兼容 Messages API（原生 `web_search_20250305` 工具，凭据名 `DEEPSEEK_API_KEY`）。bundle 层顺带禁用内置 `web-search-deepseek` Host 插件，从而移除旧的「插件 → 网页搜索」卡片、避免重复注册 provider。
- **顶层「设置 → 网页搜索」分区**。配置入口从「设置 → 插件 → 插件配置」里的 keyed 卡片改为 `settings.section`（id `web-search`）——与「插件」分区同级，一张卡内切换 DeepSeek / Tavily / Brave，并各自展开对应配置项（模型、API 版本、max tokens / max uses 等）。

### 变更

- `provider` 取值扩展为 `deepseek-official` / `tavily`（默认）/ `brave`；接缝 id 仍为 `dsh-web-search`。
- 新增 `lib/deepseek.js`；`package.json` 版本号 bump 到 `0.2.0`，`check` 脚本纳入新文件。

## [0.1.2] - 2026-08-18

### 新增

- **Brave Search 后端**（`lib/brave.js`）。设置项 `provider: brave` 会调用 Brave Search API（`X-Subscription-Token`，凭据名 `BRAVE_API_KEY`），与 Tavily 共用同一张设置卡。默认仍是 Tavily。
- **Bundle 层**（`cordis.patch.yml` + `dsh.bundle.patch`）：`dsh plugin add` 会把本包加入 profile 层栈、插入 Host 行，并把 `web.searchProvider` 设为 `dsh-web-search`。没有这一层时，DSH 只把它当普通依赖安装（没有 loader 行、Host 不会 `apply`、也不会提供 `/plugins/dsh-web-search-plugin/client.js`）。
- 接缝 id 固定为 **`dsh-web-search`**。Tavily 与 Brave 的切换是插件自己的设置，不必再改一次 `web.searchProvider`。

### 修复

- **不再写入自定义 session 事件。** 社区 Brave 插件每次搜索都会 `append("web/brave-search-request")`；该类型不在 DSH 已知事件表里，且 `Session.append` 无法加上 `ignorable: true`，冷加载会整段拒绝会话。

### 变更

- Host 代码拆到 `lib/index.js` / `lib/tavily.js` / `lib/brave.js` / `lib/shared.js`。

## [0.1.1] - 2026-08-18

### 新增

- **GitHub Actions 发布**（`.github/workflows/publish.yml`）：推送 `v*` 标签会带 provenance 发布到 npm；`ci.yml` 在每次推送/PR 上跑语法检查和 pack dry-run。

### 修复

- **客户端 bundle 缺少 `exports.inject`**（`lib/client.js`）。浏览器插件原先只导出 `apply`，cordis 的 `fiber.inject` 为空，访问 `ctx.locale` 等服务会抛 `cannot get property "locale" without inject`。现在导出 `inject = ["slots", "locale", "connection", "remote", "settingsScope"]`。
- **插件卡片的 slot 注册**（`lib/client.js`）。卡片按 rc.6 的 `id`/`order` 形状注册进 `settings.plugin.item`；该 slot 从 rc.6+ 起是 keyed 的，必须带 `key: "dsh-web-search-plugin"`。
- **`CardForm.field("apiKey")` 崩溃**（`lib/client.js`）。只写凭据字段没有 section spec，对 `undefined` 调用 `spec.format(...)` 会在卡片投影时抛 `Cannot read properties of undefined (reading 'format')`。已加上 secret 字段分支（对齐官方 `CardForm`）。
- **`dsh.client.inject` 补上 `@deepseek-ai/dsh-client-ui-slots`**（`package.json`），与社区插件的加载集合一致。

### 变更

- 不再需要 rc.6 那种给 `dsh-host-apiproxy` 打设置命名空间白名单的补丁：rc.7 的 `settings.describe()` 会动态暴露已注册的 namespace。
- **更名为 `dsh-web-search-plugin`**：包名与仓库名对齐；插件 id、设置 namespace、卡片 key 同步改名，全程只用一个身份。当时尚未对外发过版，这次改名没有迁移成本。

## [0.1.0] - 2026-08-18

### 新增

- 首个版本：`TavilySearchProvider`（id 为 `tavily`）注册进 `ctx.web`，带 `dsh-web-search-plugin` 设置段。
- Keyless 模式（`X-Tavily-Access-Mode: keyless`）与 keyed 模式（通过 `TAVILY_API_KEY` 凭据引用发送 Bearer token）。
- DSH 插件配置页上的浏览器设置卡片。

[0.2.1]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/X-C1811/dsh-web-search-plugin/releases/tag/v0.1.0
