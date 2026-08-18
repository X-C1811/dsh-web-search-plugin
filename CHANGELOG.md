# 更新日志

本项目的重要变更都记录在此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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

[0.1.2]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/X-C1811/dsh-web-search-plugin/releases/tag/v0.1.0
