# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-19

### Fixed

- **Client bundle: missing `exports.inject`** (`lib/client.js`). The browser
  plugin only exported `apply`, so cordis had an empty `fiber.inject` and any
  `ctx.*` service access (e.g. `ctx.locale`) threw
  `cannot get property "locale" without inject`. Now exports
  `inject = ["slots", "locale", "connection", "remote", "settingsScope"]`.
- **Plugin-card slot registration** (`lib/client.js`). The card registered into
  `settings.plugin.item` with the rc.6 `id`/`order` shape; the slot is keyed
  since rc.6+ and requires `key: "web-search-tavily"`.
- **`CardForm.field("apiKey")` crash** (`lib/client.js`). The write-only
  credential field has no section spec; `spec.format(...)` on `undefined`
  threw `Cannot read properties of undefined (reading 'format')` during the
  card projection. Added the secret-field branch (mirroring the official
  `CardForm`).
- **`dsh.client.inject` now includes `@deepseek-ai/dsh-client-ui-slots`**
  (`package.json`), matching the load set used by community plugins.

### Changed

- No longer requires the `dsh-host-apiproxy` settings-namespace allowlist
  patch that rc.6 needed: rc.7's `settings.describe()` exposes registered
  namespaces dynamically.
- **Package renamed to `dsh-web-search-plugin`** (matching the repository name)
  ahead of its first npm publish; the plugin id, settings namespace and card
  key remain `web-search-tavily`.

## [0.1.0] - 2026-08-19

### Added

- Initial release: `TavilySearchProvider` (`id: "tavily"`) registered into
  `ctx.web`, with `web-search-tavily` settings section.
- Keyless mode (`X-Tavily-Access-Mode: keyless`) and keyed mode
  (Bearer token via `TAVILY_API_KEY` credential reference).
- Browser configuration card for the DSH plugin configuration surface.

[0.1.1]: https://github.com/X-C1811/dsh-web-search-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/X-C1811/dsh-web-search-plugin/releases/tag/v0.1.0