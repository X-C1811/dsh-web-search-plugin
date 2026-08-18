/**
 * Web-search provider plugin for the DeepSeek Harness web capability seam
 * (`ctx.web`). Registers a single `WebSearchProvider` under the stable id
 * `dsh-web-search` and dispatches each search to Tavily or Brave according
 * to the `provider` setting — so switching backends does not require a
 * `web.searchProvider` patch change.
 *
 * Tavily supports `keyless` (free, rate-limited) and `keyed` modes.
 * Brave always needs a subscription token (`BRAVE_API_KEY` by default).
 *
 * Neither backend writes custom session events. The community Brave plugin
 * used to append `web/brave-search-request`, which is outside DSH's known
 * event vocabulary and cannot be marked `ignorable`, so a cold load refused
 * the conversation. Tool results already go through the seam's own events.
 *
 * @module dsh-web-search-plugin
 */
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_RESULTS_CAP } from "./shared.js";
import { TAVILY_DEFAULT_API_KEY_ENV, TAVILY_DEFAULT_BASE_URL, TavilySearchProvider, resolveTavilyOptions } from "./tavily.js";
import { BRAVE_DEFAULT_API_KEY_ENV, BRAVE_DEFAULT_BASE_URL, BraveSearchProvider, resolveBraveOptions } from "./brave.js";

/** Stable id this plugin registers under on `ctx.web`. */
const SEARCH_PROVIDER_ID = "dsh-web-search";

/** Cordis plugin name used by loader diagnostics. */
const name = "dsh-web-search-plugin";
/** The web seam this provider registers into. */
const inject = ["web"];

/** Plugin config (all optional — `apply` fills defaults). */
const Config = z.object({
	/** Active backend: `tavily` (default) or `brave`. */
	provider: z.string().default("tavily"),
	/** Tavily auth mode: `keyless` (default) or `keyed`. */
	mode: z.string().default("keyless"),
	/** Literal Tavily API key; prefer {@link apiKeyEnv}. */
	apiKey: z.string().role("secret").default(""),
	/** Credential reference for keyed Tavily search. */
	apiKeyEnv: z.string().role("credential-ref").default(TAVILY_DEFAULT_API_KEY_ENV),
	/** Tavily REST API base. `/search` is appended. */
	baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL),
	/** Upper bound on returned sources; both backends accept 1..20. */
	maxResults: z.number().step(1).min(1).max(MAX_RESULTS_CAP).default(8),
	/** Tavily search depth: `basic` (default) or `advanced`. */
	searchDepth: z.string().default("basic"),
	/** Request Tavily's generated answer text; surfaced as the result `content`. */
	includeAnswer: z.boolean().default(true),
	/** Tavily topic: `general` (default) or `news`. */
	topic: z.string().default("general"),
	/** Literal Brave subscription token; prefer {@link braveApiKeyEnv}. */
	braveApiKey: z.string().role("secret").default(""),
	/** Credential reference for Brave search. */
	braveApiKeyEnv: z.string().role("credential-ref").default(BRAVE_DEFAULT_API_KEY_ENV),
	/** Brave Search API web-results endpoint. */
	braveBaseURL: z.string().default(BRAVE_DEFAULT_BASE_URL),
	/** Optional Brave `country` (ISO 2-letter, e.g. `cn`). */
	country: z.string().default(""),
	/** Optional Brave `search_lang` (e.g. `zh-hans`). */
	searchLang: z.string().default(""),
	/** Optional Brave `freshness` (`pd` / `pw` / `pm` / `py`). */
	freshness: z.string().default(""),
	/** Optional HTTP(S) proxy URL for Brave (falls back to HTTPS_PROXY / HTTP_PROXY). */
	proxy: z.string().default("")
});

/** Settings namespace carrying this plugin's backend switch and options. */
const WEB_SEARCH_SETTINGS_NAMESPACE = settingsNamespace("dsh-web-search-plugin");
/** @deprecated Use {@link WEB_SEARCH_SETTINGS_NAMESPACE}. */
const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = WEB_SEARCH_SETTINGS_NAMESPACE;

/**
 * One seam-facing provider whose `id` stays `dsh-web-search`. The active
 * backend is read from the live settings section on every `available` /
 * `search` call, so a card save takes effect on the next search.
 */
class PluginSearchProvider {
	id = SEARCH_PROVIDER_ID;

	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
		this.tavily = new TavilySearchProvider(() => this.resolveOptions().tavily);
		this.brave = new BraveSearchProvider(() => this.resolveOptions().brave);
	}

	available() {
		return this.backend().available();
	}

	async search(request, signal) {
		return this.backend().search(request, signal);
	}

	backend() {
		return this.resolveOptions().provider === "brave" ? this.brave : this.tavily;
	}
}

/** Project one resolved section into options for both backends. */
function resolveOptions(ctx, config) {
	return {
		provider: config.provider === "brave" ? "brave" : "tavily",
		tavily: resolveTavilyOptions(ctx, config),
		brave: resolveBraveOptions(ctx, config)
	};
}

/** Register the dispatched search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, WEB_SEARCH_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.web.registerSearchProvider(new PluginSearchProvider(() => resolveOptions(ctx, current())));
}

export {
	BRAVE_DEFAULT_API_KEY_ENV,
	BRAVE_DEFAULT_BASE_URL,
	BraveSearchProvider,
	Config,
	SEARCH_PROVIDER_ID,
	TAVILY_DEFAULT_API_KEY_ENV,
	TAVILY_DEFAULT_BASE_URL,
	TavilySearchProvider,
	WEB_SEARCH_SETTINGS_NAMESPACE,
	WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE,
	apply,
	inject,
	name
};
