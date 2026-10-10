# dsh-web-search-plugin

English | [中文](./README.zh.md)

A web search plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that gives your agent more search options through Harness's existing `web_search` tool. Choose from **nine providers** and manage engines, API keys, and search options in **Settings → Web search**.

## Why use this plugin?

- **Avoid an extra DeepSeek model call for search.** The eight third-party backends call search APIs directly instead of DeepSeek's official model-backed search endpoint. This avoids the additional DeepSeek model token usage for that search request. (Your conversation and the model's processing of search results still use tokens, and search providers may charge their own fees or credits.)
- **Configure everything in a settings card.** Switch engines, enter keys, and adjust result limits in **Settings → Web search**, then save. Changes take effect on the next search without restarting the plugin or editing YAML.
- **Choose the search service that fits your needs.** Use Google results through Serper, semantic search through Exa, or a self-hosted SearXNG instance. Tavily's keyless mode lets you try search without an account or API key.
- **Return to built-in search with one switch.** Turn off the entire `dsh-web-search-plugin` bundle in the sidebar's **Plugins** page to remove its search overrides and restore Harness's built-in DeepSeek search under the standard profile configuration. See [Disable or uninstall](#disable-or-uninstall).

**The default engine is still DeepSeek (official).** To avoid the extra official search model call, select a third-party engine in the settings card after installation and save your changes. Selecting DeepSeek (official) uses the official search API and may incur model invocation charges.

## Supported providers

- **DeepSeek (official, default)** — Uses DeepSeek's Anthropic-compatible Messages API with the native search tool type `web_search_20250305`. Supports account tokens or `DEEPSEEK_API_KEY`. Each search sends a model request and may incur model invocation charges.
- **Tavily** — Supports `keyless` access (free, rate-limited, no account required) or `keyed` access (`TAVILY_API_KEY`, Bearer token). The settings card shows a quota bar in keyed mode.
- **Brave Search** — Calls `GET https://api.search.brave.com/res/v1/web/search` with the `X-Subscription-Token` header (credential name: `BRAVE_API_KEY`). Each search is one HTTP request and does not consume a model turn. The settings card displays Capacity and monthly quota from response headers.
- **Serper** — Google results via `POST /search`, using the `X-API-KEY` header (credential name: `SERPER_API_KEY`).
- **SerpApi** — Calls `GET /search.json` with the key in the query string (`api_key=`; credential name: `SERPAPI_API_KEY`).
- **Exa** — Semantic/neural search via `POST /search` with Bearer authentication (credential name: `EXA_API_KEY`). Requests `contents.highlights` for result summaries.
- **SearXNG** — Metasearch with no API key required by the protocol. Calls `GET /search?format=json` and supports a self-hosted instance URL. The instance must enable JSON output.
- **Scavio** — Google SERP via `POST /api/v2/google` with Bearer authentication (credential name: `SCAVIO_API_KEY`). Uses the same response structure as SerpApi.
- **Firecrawl** — Web search via `POST /v2/search` with Bearer authentication (credential name: `FIRECRAWL_API_KEY`) and `sources: ["web"]`. Full-page scraping is not enabled in the current request.

For DuckDuckGo results, choose a SearXNG instance that aggregates DuckDuckGo. DuckDuckGo appears only as a disabled hint in the engine selector.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` or a compatible `0.2.x` release
- Node.js `^22.19.0` or `>=24.0.0`
- pnpm, used by `dsh plugin` to install the plugin into a profile

## Installation

### Install from npm

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

After installation, configure the plugin in the Harness Web UI:

1. Open **Settings → Web search** and find the plugin's settings card. The sidebar's **Plugins** page controls whether the bundle is enabled; engine settings live in this card.
2. Choose a search engine. For direct API search without an extra DeepSeek model call, select Tavily, Brave, Serper, SerpApi, Exa, SearXNG, Scavio, or Firecrawl.
3. Enter the engine's API key if required. Engines that require a key show “Get API key ↗”, which opens the official dashboard. For Tavily without a key, choose `keyless`; for SearXNG, set an instance URL with JSON search enabled. These two keyless options do not show a key dashboard link. Existing credentials can be reused, such as `BRAVE_API_KEY` for Brave.
4. Adjust the result limit and other options, then click **Save**. The next search uses the saved engine and settings.

> For installation from a local source checkout, including Windows cross-drive considerations, see [Development → Local installation and verification](#local-installation-and-verification).

## Configuration

For normal use, configure the plugin in **Settings → Web search**. The card shows options for the selected engine and saves ordinary settings to the current profile's `dsh-web-search-plugin` configuration. The tables below describe the underlying configuration, including advanced fields hidden from the card; not every field is shown at once.

### General settings

| Key | Default | Meaning and scope |
|---|---|---|
| `provider` | `deepseek-official` | Active engine: `deepseek-official`, `tavily`, `brave`, `serper`, `serpapi`, `exa`, `searxng`, `scavio`, or `firecrawl`. Each request uses only the selected engine, with no automatic failover to another engine on error. Unknown values fall back to official DeepSeek |
| `maxResults` | `8` | Maximum returned sources for all engines, from 1–20, also capped by the caller's `request.maxResults`. SearXNG and Scavio send no request-level count parameter; their results are truncated after retrieval and URL deduplication. The upstream response determines how many results are actually available |

### Keys and credential references

**The card's “API Key” input differs from the literal configuration fields below.** When you enter and save a new key, the card writes it under the current engine's credential reference rather than storing the plaintext key in plugin configuration. It also sets the corresponding literal field to an empty string so an old configuration key cannot override the new credential. Leaving the input blank preserves the existing key; it does not delete it. Use Harness's credential management capabilities to delete a credential.

| Engine | Literal configuration field | Credential reference field | Default reference |
|---|---|---|---|
| DeepSeek (API key authentication) | `deepseekApiKey` | `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` |
| Tavily (`keyed` only) | `tavilyApiKey` | `tavilyApiKeyEnv` | `TAVILY_API_KEY` |
| Brave | `braveApiKey` | `braveApiKeyEnv` | `BRAVE_API_KEY` |
| Serper | `serperApiKey` | `serperApiKeyEnv` | `SERPER_API_KEY` |
| SerpApi | `serpapiApiKey` | `serpapiApiKeyEnv` | `SERPAPI_API_KEY` |
| Exa | `exaApiKey` | `exaApiKeyEnv` | `EXA_API_KEY` |
| Scavio | `scavioApiKey` | `scavioApiKeyEnv` | `SCAVIO_API_KEY` |
| Firecrawl | `firecrawlApiKey` | `firecrawlApiKeyEnv` | `FIRECRAWL_API_KEY` |

All literal fields default to an empty string. A manually configured nonempty literal key takes priority. Otherwise, the plugin resolves the reference through **the credentials service → the Harness launching environment → process environment variables**, in that order. `*ApiKeyEnv` holds a reference name, not the key itself; the card requires names matching `[A-Za-z_][A-Za-z0-9_]*`.

Official DeepSeek account sessions (provider: `deepseek-account`) first try an account token authorized for the endpoint by the account service. If no token is obtained, search uses the API key path above. Tavily `keyless` and SearXNG search requests require no API key. Configuring a Tavily key does not automatically select `keyed`; choose that mode explicitly. The current SearXNG backend has no instance-token or custom authentication-header setting.

Credential writes and profile configuration saves happen in separate steps. Failed saves retain the draft, but successfully written credentials are not automatically rolled back. Prefer the card for everyday key management to avoid storing plaintext literals in configuration files.

### Endpoints

The table lists the addresses used when no custom endpoint or environment override is provided. Normally, you do not need to enter an endpoint. Tavily and DeepSeek also support endpoint overrides through the launching environment.

| Key | Default address | Address rules |
|---|---|---|
| `deepseekBaseURL` | `https://api.deepseek.com/anthropic/v1` | DeepSeek Anthropic-compatible Messages base: nonempty configuration → `DEEPSEEK_SEARCH_BASE_URL` in the launching environment → default address; appends `/messages` |
| `tavilyBaseURL` | `https://api.tavily.com` | Tavily base: nonempty configuration → `TAVILY_BASE_URL` in the launching environment → default address; appends `/search` |
| `braveBaseURL` | `https://api.search.brave.com/res/v1/web/search` | Full web search endpoint; no path is appended |
| `serperBaseURL` | `https://google.serper.dev` | Appends `/search` |
| `serpapiBaseURL` | `https://serpapi.com` | Appends `/search.json` |
| `exaBaseURL` | `https://api.exa.ai` | Appends `/search` |
| `searxngBaseURL` | `https://searx.be` | Appends `/search?format=json` with the search query; the instance must allow JSON search. The default address is not guaranteed to work; a self-hosted instance can be used |
| `scavioBaseURL` | `https://api.scavio.dev` | Appends `/api/v2/google` |
| `firecrawlBaseURL` | `https://api.firecrawl.dev` | Appends `/v2/search` |

Changing an engine's address does not change its request method, authentication, or response parsing. Custom endpoints must implement the corresponding engine's protocol; replacing a URL alone cannot connect an arbitrary search API. Except for Brave, omit the automatically appended paths listed above when entering a base URL. Engines other than Tavily and DeepSeek fall back to their built-in address when the effective address setting is empty, with no additional dedicated environment variable fallback.

Clearing a text input or using “Restore default” in the card normally removes the current profile's override and uses the inherited or default value. This differs from manually writing an empty string into configuration. Endpoint fallbacks are evaluated against the effective configuration value.

### Provider-specific options

<table>
  <thead>
    <tr><th>Provider</th><th>Key</th><th>Default</th><th>Meaning and scope</th></tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="4"><strong>DeepSeek (official)</strong></td>
      <td><code>deepseekModel</code></td>
      <td><code>deepseek-v4-flash</code></td>
      <td>Model used only for the DeepSeek search request; does not change the conversation's chat model. Must be supported by the target endpoint</td>
    </tr>
    <tr>
      <td><code>deepseekApiVersion</code></td>
      <td><code>2023-06-01</code></td>
      <td>Value of the <code>anthropic-version</code> header. Hidden from the settings card and retained as advanced configuration; normally leave at the default</td>
    </tr>
    <tr>
      <td><code>deepseekMaxTokens</code></td>
      <td><code>4096</code></td>
      <td>Maximum generated tokens for one DeepSeek Messages search request, a positive integer; not a conversation-wide token limit</td>
    </tr>
    <tr>
      <td><code>deepseekMaxUses</code></td>
      <td><code>5</code></td>
      <td>Maximum native <code>web_search</code> tool uses within one DeepSeek Messages request, a positive integer; not an engine retry count or result count</td>
    </tr>
    <tr>
      <td rowspan="4"><strong>Tavily</strong></td>
      <td><code>tavilyMode</code></td>
      <td><code>keyless</code></td>
      <td>Tavily only: keyless access (<code>keyless</code>) or API key access (<code>keyed</code>); does not control authentication for other engines</td>
    </tr>
    <tr>
      <td><code>tavilySearchDepth</code></td>
      <td><code>basic</code></td>
      <td>Tavily only: <code>basic</code> or <code>advanced</code>, sent as <code>search_depth</code></td>
    </tr>
    <tr>
      <td><code>tavilyIncludeAnswer</code></td>
      <td><code>true</code></td>
      <td>Tavily only: requests <code>include_answer: true</code> when enabled. The current shared REST backend omits the parameter when disabled; if upstream still returns an answer, it can still become result <code>content</code>. This does not guarantee removal of all answer text</td>
    </tr>
    <tr>
      <td><code>tavilyTopic</code></td>
      <td><code>general</code></td>
      <td>Tavily only: <code>general</code> or <code>news</code></td>
    </tr>
    <tr>
      <td rowspan="4"><strong>Brave</strong></td>
      <td><code>braveCountry</code></td>
      <td>Empty string</td>
      <td>Brave only: sent as <code>country</code> (two-letter country code, such as <code>cn</code>); omitted when the effective value is empty</td>
    </tr>
    <tr>
      <td><code>braveSearchLang</code></td>
      <td>Empty string</td>
      <td>Brave only: sent as <code>search_lang</code> (such as <code>zh-hans</code>); omitted when the effective value is empty</td>
    </tr>
    <tr>
      <td><code>braveFreshness</code></td>
      <td>Empty string</td>
      <td>Brave only: <code>pd</code> / <code>pw</code> / <code>pm</code> / <code>py</code> for the past day / week / month / year. Empty means no time filter</td>
    </tr>
    <tr>
      <td><code>braveProxy</code></td>
      <td>Empty string</td>
      <td>Explicit HTTP(S) proxy override for Brave only. If empty, no separate proxy is set and Harness's global network policy applies. Other engines do not use this field</td>
    </tr>
    <tr>
      <td rowspan="2"><strong>Scavio</strong></td>
      <td><code>scavioCountry</code></td>
      <td>Empty string</td>
      <td>Scavio only: sent as <code>gl</code>, using a country/region code accepted by that service; omitted when the effective value is empty</td>
    </tr>
    <tr>
      <td><code>scavioSearchLang</code></td>
      <td>Empty string</td>
      <td>Scavio only: sent as <code>hl</code>, using a language code accepted by that service; omitted when the effective value is empty. New settings are independent of Brave</td>
    </tr>
  </tbody>
</table>

The startup environment variable `DSH_WEB_SEARCH_PROVIDER=dsh-web-search` selects Harness's registered search provider ID, not this plugin's `provider` engine option. Installing the bundle normally selects the provider already, so this variable is not required.

## Quotas

- **DeepSeek (official)**: No quota bar. Search still makes a model request, with usage subject to your account or API billing.
- **Tavily keyless**: No quota bar; access is free and rate-limited.
- **Tavily keyed**: Requests `include_usage` during searches and accumulates credits for the current credential in memory. The Host periodically calls `GET /usage`, and the settings card supports manual refresh. Manual refreshes must be at least 10 seconds apart; automatic reconciliation is not subject to this limit. The quota comes from `account.current_plan` / `plan_limit`; usage is the larger of the local total for the current credential and the remote value. Changing keys clears the previous account's usage and triggers immediate reconciliation. Tavily quota data is no longer persisted to disk.
- **Brave**: No usage/spending endpoint. Dashboard **Capacity** represents the per-second window from response headers (for example, 50 requests/second). A monthly limit of `0` means unlimited requests, not an exhausted quota. Billing credits are available only in the [Brave API dashboard](https://api-dashboard.search.brave.com/).
- The browser reads only `GET /dsh-web-search/usage` and does not call upstream services directly. Quota bars are green when more than 20% remains, yellow at 20% or less, and red at 10% or less.

## Disable or uninstall

### Switch to DeepSeek (official) first

If you only want to use official search again, select **DeepSeek (official)** in **Settings → Web search** and save. There is no need to disable or uninstall this plugin. The next search uses the official search API through this plugin and may still incur model invocation charges.

### Disable and restore built-in search

Use the following steps when you want to stop using this plugin and restore Harness's original search plugin. Selecting this plugin's DeepSeek engine and restoring the original plugin are separate operations.

Open **Plugins** in the sidebar and turn off the **entire `dsh-web-search-plugin` bundle**. Under the standard Harness profile configuration, this removes the bundle's search-provider override and its override disabling the built-in DeepSeek plugin, restoring built-in search without uninstalling the package. You can turn the bundle back on later.

Use the bundle's main switch: disabling only an individual component inside the bundle leaves its other configuration overrides in place. Profiles with configuration hot reload apply the change immediately; otherwise, restart Harness.

If you manually set `web.searchProvider: dsh-web-search`, `DSH_WEB_SEARCH_PROVIDER=dsh-web-search`, or a separate override disabling the built-in DeepSeek plugin, also remove or revert those overrides. The bundle switch does not undo settings you added separately.

### Uninstall the package

To remove the installed package as well, run:

```powershell
dsh plugin --profile web remove dsh-web-search-plugin
```

The same checks for manually added overrides apply after uninstallation. If you explicitly selected `dsh-web-search`, remove that override to use the profile default, or set `web.searchProvider` back to `deepseek-official`.

## How it works

The plugin registers a single `WebSearchProvider` with the stable ID `dsh-web-search` through `ctx.web`, following the same provider contract as `@deepseek-ai/dsh-web-search-deepseek` (`inject: ['web']` and `ctx.web.registerSearchProvider`). Switching internal engines does not require changing `web.searchProvider`. Results are normalized to `WebSearchResult` (optional `content` and `sources[]`) and deduplicated by URL. All configuration fields use `volatile()`, so saved settings are read without restarting the plugin.

This package is a **bundle**. The `dsh.bundle.patch` declaration points to `cordis.patch.yml`, which adds the Host entry, selects `dsh-web-search`, and disables the built-in `web-search-deepseek` Host plugin while the bundle is enabled. The plugin's internal `deepseek-official` engine option is distinct from its registered `dsh-web-search` ID. Disabling the entire bundle removes this patch layer; disabling only its Host entry does not. Without a bundle declaration, `dsh plugin add` only adds the dependency and does not mount the plugin.

- **DeepSeek** — Calls `POST {deepseekBaseURL}/messages` with the `web_search_20250305` tool. If the session uses the official DeepSeek account route (provider: `deepseek-account`) and the account service allows the endpoint, the request uses an account token in `x-dsh-auth-token`. Otherwise, it falls back to an API key (`x-api-key` / `authorization: Bearer`, credential name: `DEEPSEEK_API_KEY`). When a session initiator is available, a redacted request is recorded as the session event `web/deepseek-search-llm-request` before dispatch.
- **REST backends (Tavily / Brave / Serper / SerpApi / Exa / SearXNG / Scavio / Firecrawl)** — Driven by a static metadata table (`lib/providers.js`) and a shared backend (`lib/rest.js`). Table rows define the request method, path, query field names, authentication (`bearer` / `header` / `none` / `query`), fixed parameters, and response shape. REST backends do not append custom session events.
  - **Tavily** — Calls `POST {tavilyBaseURL}/search`. Keyless mode sends `x-tavily-access-mode: keyless`; keyed mode sends `authorization: Bearer <key>` and requests `include_usage` for credits.
  - **Brave** — Calls `GET {braveBaseURL}?q=&count=` with the `x-subscription-token` header. Does not append custom session events.
  - **The other six REST engines** — Follow their metadata entries' `method`, `auth`, and `params` definitions.
- Non-2xx responses map to `WEB_PROVIDER_ERROR`; caller cancellation maps to `WEB_ABORTED`; missing credentials map to `WEB_PROVIDER_CREDENTIAL_MISSING`.

## Repository layout

```text
lib/config.js      Supplier field naming and legacy configuration resolution
lib/index.js       Host plugin: volatile Config, metadata-based provider dispatch, quota routes
lib/deepseek.js    DeepSeek backend: Anthropic Messages, web_search_20250305, account tokens
lib/providers.js   Static metadata: requests/auth/responses/API key links for 8 REST providers (plus DeepSeek in deepseek.js, for 9 backends total)
lib/rest.js        Shared REST backend: metadata-driven requests and response normalization, including Tavily/Brave quota and rate-limit hooks
lib/tavily.js      Dedicated Tavily backend and option parsing (current dispatch uses the shared REST backend)
lib/brave.js       Dedicated Brave backend and option parsing (current dispatch uses the shared REST backend)
lib/usage.js       Local Tavily/Brave usage cache and /usage reconciliation
lib/shared.js      Cancellation and credential resolution helpers
lib/client.js      Browser bundle: settings section, engine switching, API key links, quota bars
locale/en.json     English titles and descriptions for plugin list/detail pages
locale/zh.json     Chinese titles and descriptions for the same pages
cordis.patch.yml   Bundle patch: adds Host entry, sets searchProvider, disables built-in DeepSeek
```

## Development

### Local installation and verification

After editing the source, install the checkout into a profile (using `web` as the example) for local verification. If the checkout and profile are on the **same drive**, you can use a relative path:

```powershell
dsh plugin --profile web add ".\dsh-web-search-plugin"
```

**On Windows, do not pass an absolute path to `dsh plugin add` across drives.** If the profile and checkout are on different drives, the dependency is written as `link:` or `file:` with an absolute drive letter. pnpm treats the drive letter as a relative path, leaving the junction pointing to a nonexistent directory. Copy a snapshot of the checkout onto the **same drive** as the profile, then use a relative `file:` reference:

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\web\.local\dsh-web-search-plugin"
robocopy "<repository-path>" $dst /E /XD node_modules .git .github .snapshots .workbuddy docs /NFL /NDL /NJH /NJS
```

In the profile's `package.json`:

```json
"dsh-web-search-plugin": "file:.local/dsh-web-search-plugin"
```

Ensure that `dsh.profile.bundles` includes this package, then run:

```powershell
dsh plugin --profile web install
```

`file:` is a snapshot: after source changes, copy the files again with robocopy, run `install`, and restart DSH. If you change the package's `files` field, pnpm may consider the snapshot unchanged and skip the update; remove `node_modules/dsh-web-search-plugin` before reinstalling in that case.

Use `dsh --profile web --dump-config` to verify that the composition tree includes `dsh-web-search-plugin` and that `web.searchProvider` is `dsh-web-search`.

### Syntax checks

```powershell
npm run check
npm test
```

The client bundle must retain the `window.__ModuleLoader__.load({ id, factory })` wire format: it is loaded by `dsh-client-modules`, not a bundler. It must export both `apply` and `inject` (`slots`, `locale`, `remote`, `remote.credentials`, `configForms`).

The configuration card is hosted in **Settings → Web search** (`settings.section`, `id: "web-search"`). Its data comes from `ctx.configForms.get("dsh-web-search-plugin")`, and registration is conditional through `configForms.whileServed([namespace], register)`. When the Host does not serve this namespace, the card is not registered.

The plugin does not show configuration on the plugin detail page (`plugins.bundle.config`).

## Localization

Plugin list and detail page titles and descriptions use `locale/<lang>.json` and follow the interface language:

```text
locale/en.json    {"meta": {"title": "Web search", "description": "…"}}
locale/zh.json    {"meta": {"title": "网页搜索", "description": "…"}}
```

Settings card text comes from the `zh` and `en` dictionaries in `lib/client.js`. Keep their keys aligned when editing them.

## Publishing

GitHub Actions (`.github/workflows/publish.yml`) handles publishing automatically. **Pushing a `v*` tag that matches the version in `package.json`** publishes to npm with provenance. Ordinary pushes to `main` do not publish a package.

1. Check that `package.json`'s `version` matches the tag you will push, and add a nonempty `## [version]` section for that version in `CHANGELOG.md`.
2. Configure an npm automation token with publishing permissions as the repository secret `NPM_TOKEN` under GitHub **Settings → Secrets and variables → Actions**, and enable Actions.
3. Tag and push:

   ```powershell
   $version = node -p "require('./package.json').version"
   git tag "v$version"
   git push origin "v$version"
   ```

The workflow checks that the tag matches `package.json`'s `version` and that the corresponding release notes in `CHANGELOG.md` are nonempty, then runs `npm publish --provenance --access public`.

## Contributing

Issues and pull requests are welcome. See the [issue tracker](https://github.com/X-C1811/dsh-web-search-plugin/issues). Additional search backends can be added under the same registered provider ID.

## License

[MIT](LICENSE)
