/**
 * Web-search provider plugin for the DeepSeek Harness web capability seam
 * (`ctx.web`). Registers a single `WebSearchProvider` under the stable id
 * `dsh-web-search` and dispatches each search to DeepSeek (official), Tavily,
 * or Brave according to the `provider` setting — so switching backends does
 * not require a `web.searchProvider` patch change.
 *
 * Tavily supports `keyless` (free, rate-limited) and `keyed` modes. Brave
 * always needs a subscription token (`BRAVE_API_KEY` by default). DeepSeek
 * uses the Anthropic-compatible Messages API native `web_search_20250305`
 * tool and reuses `DEEPSEEK_API_KEY` (the in-box `web-search-deepseek` host
 * plugin is disabled by the bundle patch).
 *
 * No backend writes custom session events; tool results already go through
 * the seam's own events.
 *
 * @module dsh-web-search-plugin
 */
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
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

/** Plugin config (all optional — `apply` fills defaults). */
const Config = z.object({
	/** Active backend: `deepseek-official` (default), `tavily`, `brave`, `serper`, `serpapi`, `exa`, or `searxng`. */
	provider: z.string().default("deepseek-official"),
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
	proxy: z.string().default(""),
	/** Literal Serper API key; prefer {@link serperApiKeyEnv}. */
	serperApiKey: z.string().role("secret").default(""),
	/** Credential reference for Serper search. */
	serperApiKeyEnv: z.string().role("credential-ref").default("SERPER_API_KEY"),
	/** Serper endpoint base. `/search` is appended. */
	serperBaseURL: z.string().default("https://google.serper.dev"),
	/** Literal SerpApi API key; prefer {@link serpapiApiKeyEnv}. */
	serpapiApiKey: z.string().role("secret").default(""),
	/** Credential reference for SerpApi search. */
	serpapiApiKeyEnv: z.string().role("credential-ref").default("SERPAPI_API_KEY"),
	/** SerpApi endpoint base. `/search.json` is appended. */
	serpapiBaseURL: z.string().default("https://serpapi.com"),
	/** Literal Exa API key; prefer {@link exaApiKeyEnv}. */
	exaApiKey: z.string().role("secret").default(""),
	/** Credential reference for Exa search. */
	exaApiKeyEnv: z.string().role("credential-ref").default("EXA_API_KEY"),
	/** Exa endpoint base. `/search` is appended. */
	exaBaseURL: z.string().default("https://api.exa.ai"),
	/** Optional SearXNG instance base URL (self-hosted). `/search` is appended. */
	searxngBaseURL: z.string().default("https://searx.be"),
	/** Literal Scavio API key; prefer {@link scavioApiKeyEnv}. */
	scavioApiKey: z.string().role("secret").default(""),
	/** Credential reference for Scavio search. */
	scavioApiKeyEnv: z.string().role("credential-ref").default("SCAVIO_API_KEY"),
	/** Scavio endpoint base. `/api/v2/google` is appended. */
	scavioBaseURL: z.string().default("https://api.scavio.dev"),
	/** Literal Firecrawl API key; prefer {@link firecrawlApiKeyEnv}. */
	firecrawlApiKey: z.string().role("secret").default(""),
	/** Credential reference for Firecrawl search. */
	firecrawlApiKeyEnv: z.string().role("credential-ref").default("FIRECRAWL_API_KEY"),
	/** Firecrawl endpoint base. `/v2/search` is appended. */
	firecrawlBaseURL: z.string().default("https://api.firecrawl.dev"),
	/** Literal DeepSeek API key; prefer {@link deepseekApiKeyEnv}. */
	deepseekApiKey: z.string().role("secret").default(""),
	/** Credential reference for DeepSeek search. */
	deepseekApiKeyEnv: z.string().role("credential-ref").default(DEEPSEEK_DEFAULT_API_KEY_ENV),
	/** DeepSeek Anthropic-compatible Messages base URL. `/messages` is appended. */
	deepseekBaseURL: z.string().default(DEEPSEEK_DEFAULT_BASE_URL),
	/** Anthropic-format model name for the Messages request. */
	model: z.string().default("deepseek-v4-flash"),
	/** `anthropic-version` header value. */
	apiVersion: z.string().default("2023-06-01"),
	/** Upper bound on generated tokens for the Messages request. */
	maxTokens: z.number().step(1).min(1).default(4096),
	/** Maximum `web_search` server-tool uses per request. */
	maxUses: z.number().step(1).min(1).default(5)
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

	constructor(resolveOptions, usage) {
		this.resolveOptions = resolveOptions;
		this.deepseek = new DeepSeekSearchProvider(() => this.resolveOptions().deepseek);
		this.tavily = new TavilySearchProvider(() => ({
			...this.resolveOptions().tavily,
			onUsage: (credits) => usage?.recordTavilyCredits(credits)
		}));
		this.brave = new BraveSearchProvider(() => ({
			...this.resolveOptions().brave,
			onRateLimit: (headers) => usage?.recordBraveHeaders(headers)
		}));
		this.rest = new Map();
		for (const providerId of BUILTIN_REST_IDS) {
			this.rest.set(providerId, new RestSearchProvider(providerId, () => this.resolveOptions().rest[providerId], {
				onUsage: providerId === "tavily" ? (credits) => usage?.recordTavilyCredits(credits) : void 0,
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
	const isBuiltIn = config.provider === "tavily" || config.provider === "brave" || config.provider === "deepseek-official" || BUILTIN_REST_IDS.includes(config.provider);
	const provider = isBuiltIn ? config.provider : "deepseek-official";
	// Per-provider literal key / optional endpoint override, used when the
	// metadata row's default is not enough (self-hosted SearXNG, proxied
	// providers, custom key refs).
	const keySourceByProvider = {
		brave: { literal: config.braveApiKey, envName: config.braveApiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV, baseURL: config.braveBaseURL ?? "", proxy: config.proxy || launchEnvironmentOf(ctx).get("HTTPS_PROXY")?.value || launchEnvironmentOf(ctx).get("HTTP_PROXY")?.value || "" },
		tavily: { literal: config.apiKey, envName: config.apiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV, baseURL: config.baseURL ?? "" },
		serper: { literal: config.serperApiKey, envName: config.serperApiKeyEnv ?? "SERPER_API_KEY", baseURL: config.serperBaseURL ?? "" },
		serpapi: { literal: config.serpapiApiKey, envName: config.serpapiApiKeyEnv ?? "SERPAPI_API_KEY", baseURL: config.serpapiBaseURL ?? "" },
		exa: { literal: config.exaApiKey, envName: config.exaApiKeyEnv ?? "EXA_API_KEY", baseURL: config.exaBaseURL ?? "" },
		searxng: { baseURL: config.searxngBaseURL ?? "" },
		scavio: { literal: config.scavioApiKey, envName: config.scavioApiKeyEnv ?? "SCAVIO_API_KEY", baseURL: config.scavioBaseURL ?? "" },
		firecrawl: { literal: config.firecrawlApiKey, envName: config.firecrawlApiKeyEnv ?? "FIRECRAWL_API_KEY", baseURL: config.firecrawlBaseURL ?? "" }
	};
	const settings = {
		country: config.country,
		searchLang: config.searchLang,
		freshness: config.freshness,
		searchDepth: config.searchDepth,
		topic: config.topic,
		includeAnswer: config.includeAnswer
	};
	const rest = {};
	for (const providerId of BUILTIN_REST_IDS) {
		const row = findProvider(providerId);
		if (row === void 0) continue;
		const source = keySourceByProvider[providerId] ?? {};
		const resolved = resolveRestProvider(ctx, row, {
			config,
			settings,
			keyed: providerId === "tavily" ? config.mode === "keyed" : false,
			keySource: source
		});
		// Endpoint override: an explicit config baseURL wins over the row default.
		if (source.baseURL != null && source.baseURL.length > 0) resolved.baseURL = source.baseURL;
		if (providerId === "brave" && (source.proxy ?? "").length > 0) resolved.proxy = source.proxy;
		rest[providerId] = resolved;
	}
	return {
		provider,
		deepseek: resolveDeepseekOptions(ctx, config),
		tavily: resolveTavilyOptions(ctx, config),
		brave: resolveBraveOptions(ctx, config),
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

/** Register the dispatched search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, WEB_SEARCH_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	const live = () => resolveOptions(ctx, current());
	const usage = new UsageTracker({
		getTavilyOptions: () => live().tavily
	});
	ctx.effect(() => {
		let cancelled = false;
		void usage.hydrate().then(() => {
			if (cancelled) return;
			if (live().provider === "tavily" && live().tavily.mode === "keyed") return usage.refreshTavily(undefined, true);
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
				const tavilyState = usage.snapshot().tavily;
				const missingIdentity = tavilyState.plan == null && tavilyState.limit == null;
				if ((force || missingIdentity) && options.provider === "tavily" && options.tavily.mode === "keyed") {
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
				sendJson(res, 200, usage.serialize(options.provider, options.tavily.mode));
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
	WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE,
	apply,
	findProvider,
	inject,
	name,
	resolveRestProvider
};
