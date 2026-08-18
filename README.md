# dsh-web-search-plugin

Tavily-backed search provider plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web capability seam (`ctx.web`). It registers a `WebSearchProvider` under the stable id `tavily`, so the model-facing `web_search` tool runs against [Tavily](https://tavily.com) instead of the DeepSeek search endpoint.

- **Keyless mode (default)** — free, rate-limited, no account or API key. One `X-Tavily-Access-Mode: keyless` header activates it.
- **Keyed mode** — resolves `TAVILY_API_KEY` (or a custom credential reference) through the credentials service / launching environment / a literal `apiKey`; sent as a Bearer token.
- Ships a browser card under **设置 → 插件 → 插件配置 → 网页搜索（Tavily）** to switch modes and edit the settings live.

## Features

- Implements the official provider contract exactly like `@deepseek-ai/dsh-web-search-deepseek`: `inject: ['web']` + `installSettingsSection` + `ctx.web.registerSearchProvider`.
- Zero-config keyless search out of the box; one click in the UI to switch to an API key for higher limits.
- Normalizes Tavily's `answer` → result `content` and `results[]` → citeable `sources[]` (url/title/snippet/published date), deduplicated by URL.
- Settings section `web-search-tavily` is dynamically exposed by rc.7's `settings.describe()` — no host allowlist patch required (rc.6 needed one; rc.7 does not).
- Cancellation and provider errors map to the seam's `WEB_ABORTED` / `WEB_PROVIDER_ERROR` codes; credentials are resolved per search, so a key stored/rotated in the web Models credentials domain applies to the next search without a restart.

## Requirements

- DeepSeek Harness `0.1.0-rc.7` or newer (relies on rc.7's dynamic settings exposure and keyed plugin slots)
- pnpm (for installing into a profile via `dsh plugin`)

## Install

From the machine where DSH runs:

```powershell
dsh plugin --profile web add "path/to/dsh-web-search-plugin"   # local checkout
# or once published:  dsh plugin --profile web add dsh-web-search-plugin
```

Then add to `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`:

```yaml
# Route the web seam to the Tavily provider (REPLACES the base's whole `web`
# config, which pins `searchProvider: deepseek-official`) and enable the plugin.
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tavily

- insert:
    - id: web-search-tavily
      name: dsh-web-search-plugin
      config:
        mode: keyless
```

Restart the DSH web process. The browser loads the plugin's client bundle on the
next page refresh.

> **Note on `file:` dependencies** — pnpm treats a `file:path` dependency as a
> snapshot: changes to the source directory are **not** propagated to the
> profile's `node_modules` automatically. After editing the plugin, re-run
> `dsh plugin --profile web add "path/to/dsh-web-search-plugin"` (or copy the files
> over) and restart.

## Configuration

The settings card ("设置 → 插件 → 插件配置 → 网页搜索（Tavily）") edits the
`web-search-tavily` namespace:

| Key | Default | Meaning |
|---|---|---|
| `mode` | `keyless` | `keyless` (free, rate-limited) or `keyed` (Tavily API key) |
| `apiKey` | — | Literal Tavily API key (never rides a response; stored via the credentials domain) |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential/env reference resolved per keyed search |
| `baseURL` | `https://api.tavily.com` | Tavily REST base; `/search` is appended |
| `maxResults` | `8` | Sources per search (1–20) |
| `searchDepth` | `basic` | `basic` (faster) or `advanced` (deeper) |
| `includeAnswer` | `true` | Request Tavily's generated answer; surfaced as result `content` |
| `topic` | `general` | `general` or `news` |

Equivalent CLI/env overrides: `DSH_WEB_SEARCH_PROVIDER=tavily` selects the
provider; the plugin's base URL falls back to `$TAVILY_BASE_URL`.

## Switching back to DeepSeek search

Change `searchProvider` back to `deepseek-official` in the profile patch. The
Tavily plugin may stay registered; it is then simply not selected.

## Layout

```
lib/index.js    Host plugin: Config (schemastery), TavilySearchProvider, settings section
lib/client.js   Browser bundle (window.__ModuleLoader__.load): the configuration card
```

- The provider performs one POST `https://api.tavily.com/search` per search;
  keyless sends `x-tavily-access-mode: keyless`, keyed sends `authorization: Bearer <key>`.
- Errors other than 2xx become `WEB_PROVIDER_ERROR` (Tavily's `detail.error`
  text is preserved); caller cancellation becomes `WEB_ABORTED`.

## Development

```powershell
node --check lib/index.js
node --check lib/client.js
```

The client bundle must stay in the `window.__ModuleLoader__.load({ id, factory })`
wire format — it is loaded by `dsh-client-modules`, not by a bundler. It must
export **both** `apply` and `inject` (the array of cordis service names it
reads: `slots`, `locale`, `connection`, `remote`, `settingsScope`), and it
registers its card into the keyed `settings.plugin.item` slot with a `key`.

## License

MIT