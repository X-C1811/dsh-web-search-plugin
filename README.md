# dsh-web-search-plugin

English | [中文](./README.zh.md)

A unified web search plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with **nine built-in providers: DeepSeek (official, default), Tavily, [Brave Search](https://brave.com/search/api/), Serper, SerpApi, Exa, SearXNG, Scavio, and Firecrawl**. Switch engines in **Settings → Web search** without changing `web.searchProvider`. The plugin registers a single `WebSearchProvider` with the stable ID `dsh-web-search` through the `ctx.web` extension point.

- **DeepSeek (official, default)** — Uses DeepSeek's Anthropic-compatible Messages API with the native `web_search_20250305` tool. Supports account tokens or `DEEPSEEK_API_KEY`; each search consumes one model turn.
- **Tavily** — Supports `keyless` access (free, rate-limited, no account required) or `keyed` access (`TAVILY_API_KEY`, Bearer token). The settings card shows a quota bar in keyed mode.
- **Brave Search** — Calls `GET https://api.search.brave.com/res/v1/web/search` with the `X-Subscription-Token` header (credential name: `BRAVE_API_KEY`). Each search is one HTTP request and does not consume a model turn. The settings card displays Capacity and monthly quota from response headers.
- **Serper** — Google results via `POST /search`, using the `X-API-KEY` header (credential name: `SERPER_API_KEY`).
- **SerpApi** — Calls `GET /search.json` with the key in the query string (`api_key=`; credential name: `SERPAPI_API_KEY`).
- **Exa** — Semantic/neural search via `POST /search` with Bearer authentication (credential name: `EXA_API_KEY`). Requests `contents.highlights` for result summaries.
- **SearXNG** — Metasearch with no API key required by the protocol. Calls `GET /search?format=json` and supports a self-hosted instance URL. The instance must enable JSON output.
- **Scavio** — Google SERP via `POST /api/v2/google` with Bearer authentication (credential name: `SCAVIO_API_KEY`). Uses the same response structure as SerpApi.
- **Firecrawl** — Web search via `POST /v2/search` with Bearer authentication (credential name: `FIRECRAWL_API_KEY`) and `sources: ["web"]`. Full-page scraping is not enabled in the current request.
- **DuckDuckGo** — No standalone backend is provided because there is no official search API. A disabled entry in the engine selector directs users to SearXNG with an instance that aggregates DuckDuckGo.
- **API key links** — Built-in providers that require a key include a “Get API key ↗” link to the official dashboard in the settings card. Providers that do not require a key (SearXNG and Tavily keyless) do not show this link.
- **Session events** — When a session initiator is available, DeepSeek records a redacted model request as `web/deepseek-search-llm-request` before dispatch. REST backends do not append custom events.

## Features

- Follows the same provider contract as the official `@deepseek-ai/dsh-web-search-deepseek`: `inject: ['web']`, all configuration fields declared with `volatile()`, and `ctx.web.registerSearchProvider`.
- A dedicated configuration card in **Settings → Web search**.
- **Official DeepSeek search is the default** for new installations and unchanged configurations, using `deepseek-official` rather than keyless Tavily.
- Of the **nine backends**, eight REST backends use a **static metadata table and a shared backend**. Only official DeepSeek search consumes model turns. Adding a built-in REST engine also requires updating the configuration fields and client engine list.
- Tavily keyless works without a key. Brave requires a subscription token; an existing `BRAVE_API_KEY` credential can be reused.
- Tavily keyed and Brave display quota bars in the settings card. Official DeepSeek, Tavily keyless, and the other REST backends do not.
- Results are normalized to `WebSearchResult` (optional `content` and `sources[]`) and deduplicated by URL.
- Configuration is saved in the current profile's plugin configuration. All fields use `volatile()`, so changes to engines or endpoints take effect without restarting the plugin.
- Plugin list and detail page titles and descriptions follow the interface language through `locale/*.json`. The settings card has its own English and Chinese dictionaries.
- Errors are mapped to `WEB_PROVIDER_ERROR`, `WEB_ABORTED`, or `WEB_PROVIDER_CREDENTIAL_MISSING`.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` or a compatible `0.2.x` release
- Node.js `^22.19.0` or `>=24.0.0`
- pnpm, used by `dsh plugin` to install the plugin into a profile

## Installation

This package is a **bundle**. `dsh.bundle.patch` and `cordis.patch.yml` add the Host entry, set `web.searchProvider` to `dsh-web-search`, and disable the built-in `web-search-deepseek` Host plugin, so this plugin manages DeepSeek search for the profile. The registered provider ID is `dsh-web-search`; `deepseek-official` is an internal engine option and differs from the ID registered by the built-in plugin. Without a bundle declaration, `dsh plugin add` only adds the dependency and does not mount the plugin.

### Install from npm

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

> For installation from a local source checkout, including Windows cross-drive considerations, see [Development → Local installation and verification](#local-installation-and-verification).

## Configuration

The settings card edits the `dsh-web-search-plugin` namespace. Its API key inputs write keys to the credentials service. If you set `*ApiKey` fields directly in the plugin configuration, those literal values are stored in the configuration instead. Use the settings card or credential reference names to avoid storing keys in configuration files.

| Key | Default | Description |
|---|---|---|
| `provider` | `deepseek-official` | `tavily`, `brave`, `deepseek-official`, `serper`, `serpapi`, `exa`, `searxng`, `scavio`, or `firecrawl` |
| `mode` | `keyless` | Tavily only: `keyless` or `keyed` |
| `apiKey` | — | Literal Tavily API key in configuration; the settings card's key input writes to the credentials service |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential/environment variable name for keyed Tavily |
| `baseURL` | Empty | Tavily REST base URL; if empty, tries `TAVILY_BASE_URL`, then `https://api.tavily.com`, and appends `/search` |
| `maxResults` | `8` | Maximum number of sources returned, capped by the caller's `request.maxResults`. The settings card offers 1–20. SearXNG has no request-level result count parameter, so results are truncated after retrieval |
| `searchDepth` | `basic` | Tavily only: `basic` or `advanced` |
| `includeAnswer` | `true` | Tavily only: requests a generated summary and writes it to the result's `content` |
| `topic` | `general` | Tavily only: `general` or `news` |
| `deepseekApiKey` | — | Literal DeepSeek API key in configuration; the settings card's key input writes to the credentials service |
| `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` | Credential/environment variable name for DeepSeek |
| `deepseekBaseURL` | Empty | DeepSeek Anthropic-compatible Messages base URL; if empty, tries `DEEPSEEK_SEARCH_BASE_URL`, then `https://api.deepseek.com/anthropic/v1`, and appends `/messages` |
| `model` | `deepseek-v4-flash` | Model name in Anthropic format |
| `apiVersion` | `2023-06-01` | Value of the `anthropic-version` request header |
| `maxTokens` | `4096` | Maximum generated tokens for the Messages request |
| `maxUses` | `5` | Maximum number of `web_search` tool calls per request |
| `braveApiKey` | — | Literal Brave subscription token in configuration; the settings card's key input writes to the credentials service |
| `braveApiKeyEnv` | `BRAVE_API_KEY` | Credential/environment variable name for Brave |
| `braveBaseURL` | `https://api.search.brave.com/res/v1/web/search` | Brave web search endpoint |
| `country` | — | Brave `country` (two-letter ISO code, such as `cn`); left empty to use Brave's default |
| `searchLang` | — | Brave `search_lang` (such as `zh-hans`); left empty to use Brave's default |
| `freshness` | — | Brave `freshness`: `pd` / `pw` / `pm` / `py` |
| `proxy` | — | HTTP(S) proxy override for Brave; if empty, inherits DSH's global `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` policy |
| `serperApiKey` / `serperApiKeyEnv` / `serperBaseURL` | — / `SERPER_API_KEY` / `https://google.serper.dev` | Serper literal key / credential reference name / REST base URL |
| `serpapiApiKey` / `serpapiApiKeyEnv` / `serpapiBaseURL` | — / `SERPAPI_API_KEY` / `https://serpapi.com` | SerpApi literal key / credential reference name / REST base URL |
| `exaApiKey` / `exaApiKeyEnv` / `exaBaseURL` | — / `EXA_API_KEY` / `https://api.exa.ai` | Exa literal key / credential reference name / REST base URL |
| `searxngBaseURL` | `https://searx.be` | SearXNG instance base URL; can point to a self-hosted instance |
| `scavioApiKey` / `scavioApiKeyEnv` / `scavioBaseURL` | — / `SCAVIO_API_KEY` / `https://api.scavio.dev` | Scavio literal key / credential reference name / REST base URL |
| `firecrawlApiKey` / `firecrawlApiKeyEnv` / `firecrawlBaseURL` | — / `FIRECRAWL_API_KEY` / `https://api.firecrawl.dev` | Firecrawl literal key / credential reference name / REST base URL |

## Services not included

The following services have **no built-in backend**:

| Service | Reason |
|---|---|
| **TinyFish** | Very small free allowance (5 requests per minute). Its Search + Fetch model extends beyond the scope of REST-only search, with limited value from the search portion alone |
| **Google CSE** | Registration is closed to new users, and the service is scheduled to shut down on 2027-01-01 |
| **SERPJET** | The official website is currently inaccessible, so integration is deferred |
| **DuckDuckGo** | No official search API; HTML/community-library scraping does not fit the metadata table's REST-only scope. A disabled selector entry directs users to SearXNG |

These services are not selectable engines. DuckDuckGo appears only as a disabled hint, as described above.

Environment variables: setting `DSH_WEB_SEARCH_PROVIDER=dsh-web-search` at startup selects this registered provider ID. When `baseURL` is empty, Tavily falls back to `TAVILY_BASE_URL`; when `deepseekBaseURL` is empty, DeepSeek falls back to `DEEPSEEK_SEARCH_BASE_URL`.

## Quotas

- **Tavily keyless / official DeepSeek**: No quota bar. Tavily keyless is free and rate-limited, with no account quota; official DeepSeek is billed per use, with no monthly limit.
- **Tavily keyed**: Requests `include_usage` during searches and accumulates credits for the current credential in memory. The Host periodically calls `GET /usage`, and the settings card supports manual refresh. Manual refreshes must be at least 10 seconds apart; automatic reconciliation is not subject to this limit. The quota comes from `account.current_plan` / `plan_limit`; usage is the larger of the local total for the current credential and the remote value. Changing keys clears the previous account's usage and triggers immediate reconciliation. Tavily quota data is no longer persisted to disk.
- **Brave**: No usage/spending endpoint. Dashboard **Capacity** represents the per-second window from response headers (for example, 50 requests/second). A monthly limit of `0` means unlimited requests, not an exhausted quota. Billing credits are available only in the [Brave API dashboard](https://api-dashboard.search.brave.com/).
- The browser reads only `GET /dsh-web-search/usage` and does not call upstream services directly. Quota bars are green when more than 20% remains, yellow at 20% or less, and red at 10% or less.

## Uninstallation

To switch back to DSH's built-in DeepSeek Host plugin, remove this plugin and its bundle patch first:

```powershell
dsh plugin --profile web remove dsh-web-search-plugin
```

Then check the profile's effective `web.searchProvider`. If you manually overrode it with `dsh-web-search`, change that override back to `deepseek-official`.

## How it works

- **DeepSeek** — Calls `POST {deepseekBaseURL}/messages` with the `web_search_20250305` tool. If the session uses the official DeepSeek account route (provider: `deepseek-account`) and the account service allows the endpoint, the request uses an account token in `x-dsh-auth-token`. Otherwise, it falls back to an API key (`x-api-key` / `authorization: Bearer`, credential name: `DEEPSEEK_API_KEY`). When a session initiator is available, a redacted request is recorded as the session event `web/deepseek-search-llm-request` before dispatch.
- **REST backends (Tavily / Brave / Serper / SerpApi / Exa / SearXNG / Scavio / Firecrawl)** — Driven by a static metadata table (`lib/providers.js`) and a shared backend (`lib/rest.js`). Table rows define the request method, path, query field names, authentication (`bearer` / `header` / `none` / `query`), fixed parameters, and response shape.
  - **Tavily** — Calls `POST {baseURL}/search`. Keyless mode sends `x-tavily-access-mode: keyless`; keyed mode sends `authorization: Bearer <key>` and requests `include_usage` for credits.
  - **Brave** — Calls `GET {braveBaseURL}?q=&count=` with the `x-subscription-token` header. Does not append custom session events.
  - **The other six REST engines** — Follow their metadata entries' `method`, `auth`, and `params` definitions.
- Non-2xx responses map to `WEB_PROVIDER_ERROR`; caller cancellation maps to `WEB_ABORTED`.

## Repository layout

```text
lib/index.js       Host plugin: volatile Config, metadata-based provider dispatch, quota routes
lib/providers.js   Static metadata: requests/auth/responses/API key links for 8 REST providers (plus DeepSeek in deepseek.js, for 9 backends total)
lib/rest.js        Shared REST backend: metadata-driven requests and response normalization, including Tavily/Brave quota and rate-limit hooks
lib/deepseek.js    DeepSeek backend: Anthropic Messages, web_search_20250305, account tokens
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
