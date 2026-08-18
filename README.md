# dsh-web-search-plugin

A [Tavily](https://tavily.com)-backed web search provider for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web capability seam (`ctx.web`). It registers a `WebSearchProvider` under the stable id `tavily`, so the model-facing `web_search` tool runs against Tavily instead of the built-in DeepSeek search endpoint — with or without an API key.

- **Keyless mode (default)** — free and rate-limited; no account or API key required. Activated by a single `X-Tavily-Access-Mode: keyless` request header.
- **Keyed mode** — uses a Tavily API key resolved from the `TAVILY_API_KEY` credential / launch-environment reference (or a literal `apiKey`), sent as a Bearer token.
- **UI-configurable** — ships a configuration card in the DSH web settings (Settings → Plugins → Plugin configuration → Web search (Tavily)) to switch modes and edit options live.

## Features

- Implements the same provider contract as the official `@deepseek-ai/dsh-web-search-deepseek` plugin: `inject: ['web']` + `installSettingsSection` + `ctx.web.registerSearchProvider`.
- Zero-config keyless search works out of the box; switch to an API key in one click for higher limits.
- Normalizes Tavily's `answer` into the result `content` and `results[]` into citeable `sources[]` (url, title, snippet, published date), deduplicated by URL.
- Settings section `web-search-tavily` is exposed dynamically through rc.7's `settings.describe()` — no host allowlist patch required.
- Maps provider errors and caller cancellation to the seam's `WEB_PROVIDER_ERROR` / `WEB_ABORTED` codes; credentials are resolved per search, so a key stored or rotated in the web credentials domain applies to the next search without a restart.

## Requirements

- DeepSeek Harness `0.1.0-rc.7` or newer (keyed plugin slots and dynamic settings exposure)
- pnpm, for installing plugins into a profile via `dsh plugin`

## Install

### From npm

```powershell
dsh plugin --profile web add dsh-web-search-plugin
```

### From a local checkout

```powershell
dsh plugin --profile web add "path/to/dsh-web-search-plugin"
```

Then route the web seam to the Tavily provider and enable the plugin in `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`:

```yaml
# Replaces the base `web` config, which pins `searchProvider: deepseek-official`.
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

Restart the DSH web process; the browser picks up the plugin's client bundle on the next page refresh.

> **Note on `file:` (local) installs** — pnpm treats a `file:path` dependency as a snapshot: changes made to the source directory are **not** propagated into the profile's `node_modules` automatically. After editing the plugin, re-run `dsh plugin --profile web add "path/to/dsh-web-search-plugin"` (or copy the files over) and restart.

## Configuration

The settings card (Settings → Plugins → Plugin configuration → Web search (Tavily)) edits the `web-search-tavily` namespace:

| Key | Default | Meaning |
|---|---|---|
| `mode` | `keyless` | `keyless` (free, rate-limited) or `keyed` (Tavily API key) |
| `apiKey` | — | Literal Tavily API key (never echoed back; stored via the credentials domain) |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential/env reference resolved on each keyed search |
| `baseURL` | `https://api.tavily.com` | Tavily REST base URL; `/search` is appended |
| `maxResults` | `8` | Sources per search (1–20) |
| `searchDepth` | `basic` | `basic` (faster) or `advanced` (deeper) |
| `includeAnswer` | `true` | Request Tavily's generated answer; surfaced as the result `content` |
| `topic` | `general` | `general` or `news` |

Environment overrides: `DSH_WEB_SEARCH_PROVIDER=tavily` selects this provider at boot; the plugin's base URL falls back to `$TAVILY_BASE_URL` when `baseURL` is unset.

## Switching back to the built-in search

Change `searchProvider` back to `deepseek-official` in the profile patch. The plugin may stay registered; it is then simply not selected.

## How it works

- One `POST https://api.tavily.com/search` per search; keyless requests send `x-tavily-access-mode: keyless`, keyed requests send `authorization: Bearer <key>`.
- Non-2xx responses become `WEB_PROVIDER_ERROR` (Tavily's `detail.error` text is preserved); caller cancellation becomes `WEB_ABORTED`.

## Repository layout

```
lib/index.js    Host plugin: schemastery Config, TavilySearchProvider, settings section
lib/client.js   Browser bundle (window.__ModuleLoader__.load): the configuration card
```

## Development

```powershell
node --check lib/index.js
node --check lib/client.js
```

The client bundle must stay in the `window.__ModuleLoader__.load({ id, factory })` wire format — it is loaded by `dsh-client-modules`, not by a bundler. It must export **both** `apply` and `inject` (the array of cordis service names it reads: `slots`, `locale`, `connection`, `remote`, `settingsScope`) and register its card into the keyed `settings.plugin.item` slot with a `key`.

## Contributing

Issues and pull requests are welcome. See the [issue tracker](https://github.com/X-C1811/dsh-web-search-plugin/issues) for known limitations and the roadmap; the provider is shaped so additional search APIs can be added beside Tavily.

## License

[MIT](LICENSE)