/**
 * Web-search provider plugin for the DeepSeek Harness web capability seam
 * (`ctx.web`). Registers a single `WebSearchProvider` under the stable id
 * `dsh-web-search` and dispatches each search to one of nine backends
 * according to the `provider` setting — so switching backends does
 * not require a `web.searchProvider` patch change.
 *
 * Tavily supports `keyless` (free, rate-limited) and `keyed` modes. Brave
 * always needs a subscription token (`BRAVE_API_KEY` by default). DeepSeek
 * uses the Anthropic-compatible Messages API native `web_search_20250305`
 * tool and authenticates with an account token or `DEEPSEEK_API_KEY` (the
 * in-box `web-search-deepseek` host plugin is disabled by the bundle patch).
 *
 * DeepSeek records a secret-free model request as a session event before
 * dispatch; the REST backends do not write custom session events.
 *
 * Adapted to DeepSeek Harness `0.2.x`: configuration is read from `volatile()`
 * Config accessors instead of the `settings.installSection()` callback pair
 * removed in `0.2.0`.
 *
 * @module dsh-web-search-plugin
 */
import z from "@deepseek-ai/schemastery";
import { SUPPLIER_CONFIG_ALIASES, resolveSupplierConfig } from "./config.js";
import { MAX_RESULTS_CAP } from "./shared.js";
import { TAVILY_DEFAULT_API_KEY_ENV, TAVILY_DEFAULT_BASE_URL, TavilySearchProvider, resolveTavilyOptions } from "./tavily.js";
import { BRAVE_DEFAULT_API_KEY_ENV, BRAVE_DEFAULT_BASE_URL, BraveSearchProvider, resolveBraveOptions } from "./brave.js";
import { DEEPSEEK_DEFAULT_API_KEY_ENV, DEEPSEEK_DEFAULT_BASE_URL, DeepSeekSearchProvider, resolveDeepseekOptions } from "./deepseek.js";
import { TAVILY_USAGE_POLL_MS, UsageTracker } from "./usage.js";
import { RestSearchProvider, resolveRestProvider } from "./rest.js";
import { BUILTIN_REST_IDS, REST_PROVIDERS, findProvider } from "./providers.js";

/** Stable id this plugin registers under on `ctx.web`. */
const SEARCH_PROVIDER_ID = "dsh-web-search";

/** Cordis plugin name used by loader diagnostics. */
const name = "dsh-web-search-plugin";
/** The web seam this provider registers into. */
const inject = ["web"];
/** Settings namespace carrying this plugin's backend switch and options. */
const WEB_SEARCH_SETTINGS_NAMESPACE = "dsh-web-search-plugin";

/**
 * Plugin config. Every field is `volatile()`: DeepSeek Harness `0.2.x` saves
 * settings into the active Profile's plugin configuration and only reloads a
 * running instance when a *non*-volatile field changes, so a volatile field can
 * be edited from the settings form without restarting the plugin. The previous
 * `settings.installSection()` + `setSource` mechanism was removed in `0.2.0`,
 * which makes these accessors the only way to read live configuration.
 */
const Config = z.object({
	// No defaults here: absent prefixed fields must still inherit legacy values.
	deepseekModel: z.string().volatile(),
	deepseekApiVersion: z.string().volatile(),
	deepseekMaxTokens: z.number().step(1).min(1).volatile(),
	deepseekMaxUses: z.number().step(1).min(1).volatile(),
	tavilyApiKey: z.string().role("secret").volatile(),
	tavilyApiKeyEnv: z.string().role("credential-ref").volatile(),
	tavilyBaseURL: z.string().volatile(),
	tavilyMode: z.string().volatile(),
	tavilySearchDepth: z.string().volatile(),
	tavilyIncludeAnswer: z.boolean().volatile(),
	tavilyTopic: z.string().volatile(),
	braveCountry: z.string().volatile(),
	braveSearchLang: z.string().volatile(),
	braveFreshness: z.string().volatile(),
	braveProxy: z.string().volatile(),
	scavioCountry: z.string().volatile(),
	scavioSearchLang: z.string().volatile(),
	// Legacy fields remain accepted for existing profiles.
	/** Active backend: `deepseek-official` (default), `tavily`, `brave`, `serper`, `serpapi`, `exa`, `searxng`, `scavio`, or `firecrawl`. */
	provider: z.string().default("deepseek-official").volatile(),
	/** Tavily auth mode: `keyless` (default) or `keyed`. */
	mode: z.string().default("keyless").volatile(),
	/** Literal Tavily API key; prefer {@link apiKeyEnv}. */
	apiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for keyed Tavily search. */
	apiKeyEnv: z.string().role("credential-ref").default(TAVILY_DEFAULT_API_KEY_ENV).volatile(),
	/** Tavily REST API base. `/search` is appended. */
	baseURL: z.string().default("").volatile(),
	/** Upper bound on returned sources; both backends accept 1..20. */
	maxResults: z.number().step(1).min(1).max(MAX_RESULTS_CAP).default(8).volatile(),
	/** Tavily search depth: `basic` (default) or `advanced`. */
	searchDepth: z.string().default("basic").volatile(),
	/** Request Tavily's generated answer text; surfaced as the result `content`. */
	includeAnswer: z.boolean().default(true).volatile(),
	/** Tavily topic: `general` (default) or `news`. */
	topic: z.string().default("general").volatile(),
	/** Literal Brave subscription token; prefer {@link braveApiKeyEnv}. */
	braveApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for Brave search. */
	braveApiKeyEnv: z.string().role("credential-ref").default(BRAVE_DEFAULT_API_KEY_ENV).volatile(),
	/** Brave Search API web-results endpoint. */
	braveBaseURL: z.string().default(BRAVE_DEFAULT_BASE_URL).volatile(),
	/** Optional Brave `country` (ISO 2-letter, e.g. `cn`). */
	country: z.string().default("").volatile(),
	/** Optional Brave `search_lang` (e.g. `zh-hans`). */
	searchLang: z.string().default("").volatile(),
	/** Optional Brave `freshness` (`pd` / `pw` / `pm` / `py`). */
	freshness: z.string().default("").volatile(),
	/** Optional HTTP(S) proxy URL for Brave; blank inherits DSH's global proxy policy. */
	proxy: z.string().default("").volatile(),
	/** Literal Serper API key; prefer {@link serperApiKeyEnv}. */
	serperApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for Serper search. */
	serperApiKeyEnv: z.string().role("credential-ref").default("SERPER_API_KEY").volatile(),
	/** Serper endpoint base. `/search` is appended. */
	serperBaseURL: z.string().default("https://google.serper.dev").volatile(),
	/** Literal SerpApi API key; prefer {@link serpapiApiKeyEnv}. */
	serpapiApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for SerpApi search. */
	serpapiApiKeyEnv: z.string().role("credential-ref").default("SERPAPI_API_KEY").volatile(),
	/** SerpApi endpoint base. `/search.json` is appended. */
	serpapiBaseURL: z.string().default("https://serpapi.com").volatile(),
	/** Literal Exa API key; prefer {@link exaApiKeyEnv}. */
	exaApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for Exa search. */
	exaApiKeyEnv: z.string().role("credential-ref").default("EXA_API_KEY").volatile(),
	/** Exa endpoint base. `/search` is appended. */
	exaBaseURL: z.string().default("https://api.exa.ai").volatile(),
	/** Optional SearXNG instance base URL (self-hosted). `/search` is appended. */
	searxngBaseURL: z.string().default("https://searx.be").volatile(),
	/** Literal Scavio API key; prefer {@link scavioApiKeyEnv}. */
	scavioApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for Scavio search. */
	scavioApiKeyEnv: z.string().role("credential-ref").default("SCAVIO_API_KEY").volatile(),
	/** Scavio endpoint base. `/api/v2/google` is appended. */
	scavioBaseURL: z.string().default("https://api.scavio.dev").volatile(),
	/** Literal Firecrawl API key; prefer {@link firecrawlApiKeyEnv}. */
	firecrawlApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for Firecrawl search. */
	firecrawlApiKeyEnv: z.string().role("credential-ref").default("FIRECRAWL_API_KEY").volatile(),
	/** Firecrawl endpoint base. `/v2/search` is appended. */
	firecrawlBaseURL: z.string().default("https://api.firecrawl.dev").volatile(),
	/** Literal DeepSeek API key; prefer {@link deepseekApiKeyEnv}. */
	deepseekApiKey: z.string().role("secret").default("").volatile(),
	/** Credential reference for DeepSeek search. */
	deepseekApiKeyEnv: z.string().role("credential-ref").default(DEEPSEEK_DEFAULT_API_KEY_ENV).volatile(),
	/** DeepSeek Anthropic-compatible Messages base URL. `/messages` is appended. */
	deepseekBaseURL: z.string().default("").volatile(),
	/** Anthropic-format model name for the Messages request. */
	model: z.string().default("deepseek-flash").volatile(),
	/** `anthropic-version` header value. */
	apiVersion: z.string().default("2023-06-01").volatile(),
	/** Upper bound on generated tokens for the Messages request. */
	maxTokens: z.number().step(1).min(1).default(4096).volatile(),
	/** Maximum `web_search` server-tool uses per request. */
	maxUses: z.number().step(1).min(1).default(5).volatile()
});

/**
 * One seam-facing provider whose `id` stays `dsh-web-search`. The active
 * backend is read from the live settings section on every `available` /
 * `search` call, so a card save takes effect on the next search.
 */
class PluginSearchProvider {
	id = SEARCH_PROVIDER_ID;

	constructor(resolveOptions, usage) {
		this.resolveOptions = resolveOptions;
		this.deepseek = new DeepSeekSearchProvider(() => this.resolveOptions().deepseek);
		this.rest = new Map();
		for (const providerId of BUILTIN_REST_IDS) {
			this.rest.set(providerId, new RestSearchProvider(providerId, () => this.resolveOptions().rest[providerId], {
				onUsage: providerId === "tavily" ? (credits, apiKey) => usage?.recordTavilyCredits(credits, apiKey) : void 0,
				onRateLimit: providerId === "brave" ? (headers) => usage?.recordBraveHeaders(headers) : void 0
			}));
		}
	}

	available() {
		return this.backend().available();
	}

	async search(request, signal) {
		return this.backend().search(request, signal);
	}

	backend() {
		const options = this.resolveOptions();
		const provider = options.provider;
		const restInstance = this.rest.get(provider);
		if (restInstance !== void 0) return restInstance;
		if (provider === "deepseek-official") return this.deepseek;
		// Fallback: provider points at something unknown → official default.
		return this.deepseek;
	}
}

/** Project one resolved section into options for each backend. */
function resolveOptions(ctx, config) {
	config = resolveSupplierConfig(config);
	const isBuiltIn = config.provider === "tavily" || config.provider === "brave" || config.provider === "deepseek-official" || BUILTIN_REST_IDS.includes(config.provider);
	const provider = isBuiltIn ? config.provider : "deepseek-official";
	const tavily = provider === "tavily" ? resolveTavilyOptions(ctx, config) : void 0;
	// Per-provider literal key / optional endpoint override, used when the
	// metadata row's default is not enough (self-hosted SearXNG, proxied
	// providers, custom key refs).
	const keySourceByProvider = {
		brave: { literal: config.braveApiKey, envName: config.braveApiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV, baseURL: config.braveBaseURL ?? "", proxy: config.braveProxy ?? "" },
		tavily: { literal: config.tavilyApiKey, envName: config.tavilyApiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV, baseURL: tavily?.baseURL ?? "" },
		serper: { literal: config.serperApiKey, envName: config.serperApiKeyEnv ?? "SERPER_API_KEY", baseURL: config.serperBaseURL ?? "" },
		serpapi: { literal: config.serpapiApiKey, envName: config.serpapiApiKeyEnv ?? "SERPAPI_API_KEY", baseURL: config.serpapiBaseURL ?? "" },
		exa: { literal: config.exaApiKey, envName: config.exaApiKeyEnv ?? "EXA_API_KEY", baseURL: config.exaBaseURL ?? "" },
		searxng: { baseURL: config.searxngBaseURL ?? "" },
		scavio: { literal: config.scavioApiKey, envName: config.scavioApiKeyEnv ?? "SCAVIO_API_KEY", baseURL: config.scavioBaseURL ?? "" },
		firecrawl: { literal: config.firecrawlApiKey, envName: config.firecrawlApiKeyEnv ?? "FIRECRAWL_API_KEY", baseURL: config.firecrawlBaseURL ?? "" }
	};
	const settings = {
		country: provider === "scavio" ? config.scavioCountry : config.braveCountry,
		searchLang: provider === "scavio" ? config.scavioSearchLang : config.braveSearchLang,
		freshness: config.braveFreshness,
		searchDepth: config.tavilySearchDepth,
		topic: config.tavilyTopic,
		includeAnswer: config.tavilyIncludeAnswer
	};
	const rest = {};
	for (const providerId of provider === "deepseek-official" ? [] : [provider]) {
		const row = findProvider(providerId);
		if (row === void 0) continue;
		const source = keySourceByProvider[providerId] ?? {};
		const resolved = resolveRestProvider(ctx, row, {
			config,
			settings,
			keyed: providerId === "tavily" ? config.tavilyMode === "keyed" : false,
			keySource: source
		});
		// Endpoint override: an explicit config baseURL wins over the row default.
		if (source.baseURL != null && source.baseURL.length > 0) resolved.baseURL = source.baseURL;
		if (providerId === "brave" && (source.proxy ?? "").length > 0) resolved.proxy = source.proxy;
		rest[providerId] = resolved;
	}
	return {
		provider,
		deepseek: provider === "deepseek-official" ? resolveDeepseekOptions(ctx, config) : void 0,
		tavily,
		brave: provider === "brave" ? resolveBraveOptions(ctx, config) : void 0,
		rest
	};
}

/** JSON body helper for the usage refresh POST. */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 1e6) {
				req.destroy();
				reject(new Error("Payload too large"));
			}
		});
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch {
				reject(new Error("Invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}

function sendJson(res, statusCode, data) {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(body)
	});
	res.end(body);
}

/**
 * Read the live configuration section.
 *
 * Every Config field is `volatile()`, so `field.get()` always yields the value
 * the settings form last wrote — replacing the `installSection` / `setSource`
 * pair this plugin used on Harness `0.1.x`. Snapshotted once per operation by
 * each backend's `resolveOptions`, so one search never mixes two sections.
 * @param config - the plugin's volatile Config accessors.
 * @returns one detached plain section.
 */
function readSection(config) {
	return {
		...Object.fromEntries(Object.keys(SUPPLIER_CONFIG_ALIASES).map((field) => [field, config[field].get()])),
		provider: config.provider.get(),
		mode: config.mode.get(),
		apiKey: config.apiKey.get(),
		apiKeyEnv: config.apiKeyEnv.get(),
		baseURL: config.baseURL.get(),
		maxResults: config.maxResults.get(),
		searchDepth: config.searchDepth.get(),
		includeAnswer: config.includeAnswer.get(),
		topic: config.topic.get(),
		braveApiKey: config.braveApiKey.get(),
		braveApiKeyEnv: config.braveApiKeyEnv.get(),
		braveBaseURL: config.braveBaseURL.get(),
		country: config.country.get(),
		searchLang: config.searchLang.get(),
		freshness: config.freshness.get(),
		proxy: config.proxy.get(),
		serperApiKey: config.serperApiKey.get(),
		serperApiKeyEnv: config.serperApiKeyEnv.get(),
		serperBaseURL: config.serperBaseURL.get(),
		serpapiApiKey: config.serpapiApiKey.get(),
		serpapiApiKeyEnv: config.serpapiApiKeyEnv.get(),
		serpapiBaseURL: config.serpapiBaseURL.get(),
		exaApiKey: config.exaApiKey.get(),
		exaApiKeyEnv: config.exaApiKeyEnv.get(),
		exaBaseURL: config.exaBaseURL.get(),
		searxngBaseURL: config.searxngBaseURL.get(),
		scavioApiKey: config.scavioApiKey.get(),
		scavioApiKeyEnv: config.scavioApiKeyEnv.get(),
		scavioBaseURL: config.scavioBaseURL.get(),
		firecrawlApiKey: config.firecrawlApiKey.get(),
		firecrawlApiKeyEnv: config.firecrawlApiKeyEnv.get(),
		firecrawlBaseURL: config.firecrawlBaseURL.get(),
		deepseekApiKey: config.deepseekApiKey.get(),
		deepseekApiKeyEnv: config.deepseekApiKeyEnv.get(),
		deepseekBaseURL: config.deepseekBaseURL.get(),
		model: config.model.get(),
		apiVersion: config.apiVersion.get(),
		maxTokens: config.maxTokens.get(),
		maxUses: config.maxUses.get()
	};
}

/**
 * Register the dispatched search provider with `ctx.web`.
 *
 * Harness `0.2.x` saves plugin settings into the active Profile's plugin
 * configuration and exposes them through `settings.describe()`; a plugin with
 * no custom page gets an auto-generated one for free. This plugin keeps that
 * default (it never calls `settings.configure({ auto: false })`) and edits the
 * `dsh-web-search-plugin` namespace through the browser card in
 * `lib/client.js`.
 * @param ctx - plugin context.
 * @param config - volatile Config accessors supplied by the Loader.
 */
function apply(ctx, config) {
	const live = () => resolveOptions(ctx, readSection(config));
	const usage = new UsageTracker({
		getTavilyOptions: () => live().tavily
	});
	ctx.effect(() => {
		let cancelled = false;
		void usage.hydrate().then(() => {
			if (cancelled) return;
			if (live().provider === "tavily" && live().tavily.mode === "keyed") return usage.refreshTavily();
		}).catch(() => {});
		return () => {
			cancelled = true;
			usage.dispose();
		};
	}, "dsh-web-search-plugin: usage hydrate");
	ctx.effect(() => {
		const tick = () => {
			if (live().provider === "tavily" && live().tavily.mode === "keyed") void usage.refreshTavily().catch(() => {});
		};
		const timer = setInterval(tick, TAVILY_USAGE_POLL_MS);
		return () => clearInterval(timer);
	}, "dsh-web-search-plugin: tavily usage poll");
	ctx.web.registerSearchProvider(new PluginSearchProvider(live, usage));
	ctx.inject(["webServer"], (webCtx) => {
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: "/dsh-web-search/usage",
			async handler(req, res) {
				if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
					res.writeHead(405, { Allow: "GET, HEAD, POST" });
					res.end();
					return;
				}
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				const force = req.method === "POST" || url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
				const options = live();
				if (options.provider === "tavily" && options.tavily.mode === "keyed") {
					try {
						if (req.method === "POST") await readJsonBody(req).catch(() => ({}));
						await usage.refreshTavily(undefined, force);
					} catch {
						/* serialize still returns the last cache */
					}
				}
				if (req.method === "HEAD") {
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end();
					return;
				}
				sendJson(res, 200, usage.serialize(options.provider, options.tavily?.mode));
			}
		}), "dsh-web-search-plugin: usage route");
	});
}

export {
	BRAVE_DEFAULT_API_KEY_ENV,
	BRAVE_DEFAULT_BASE_URL,
	BUILTIN_REST_IDS,
	BraveSearchProvider,
	Config,
	DEEPSEEK_DEFAULT_API_KEY_ENV,
	DEEPSEEK_DEFAULT_BASE_URL,
	DeepSeekSearchProvider,
	REST_PROVIDERS,
	RestSearchProvider,
	SEARCH_PROVIDER_ID,
	TAVILY_DEFAULT_API_KEY_ENV,
	TAVILY_DEFAULT_BASE_URL,
	TAVILY_USAGE_POLL_MS,
	TavilySearchProvider,
	UsageTracker,
	WEB_SEARCH_SETTINGS_NAMESPACE,
	apply,
	findProvider,
	inject,
	name,
	resolveRestProvider
};
