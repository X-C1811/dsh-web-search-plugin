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
import { MAX_RESULTS_CAP } from "./shared.js";
import { TAVILY_DEFAULT_API_KEY_ENV, TAVILY_DEFAULT_BASE_URL, TavilySearchProvider, resolveTavilyOptions } from "./tavily.js";
import { BRAVE_DEFAULT_API_KEY_ENV, BRAVE_DEFAULT_BASE_URL, BraveSearchProvider, resolveBraveOptions } from "./brave.js";
import { DEEPSEEK_DEFAULT_API_KEY_ENV, DEEPSEEK_DEFAULT_BASE_URL, DeepSeekSearchProvider, resolveDeepseekOptions } from "./deepseek.js";
import { CustomSearchProvider, resolveCustomOptions } from "./custom.js";
import { TAVILY_USAGE_POLL_MS, UsageTracker } from "./usage.js";

/** Stable id this plugin registers under on `ctx.web`. */
const SEARCH_PROVIDER_ID = "dsh-web-search";

/** Cordis plugin name used by loader diagnostics. */
const name = "dsh-web-search-plugin";
/** The web seam this provider registers into. */
const inject = ["web"];

/** Schema for one user-defined custom provider entry. */
const CustomProvider = z.object({
	/** Stable internal key; generated once and never changed on rename. */
	id: z.string(),
	/** Display name shown in the search-engine dropdown. */
	name: z.string(),
	/** Credential reference resolved for this provider's API key. */
	apiKeyEnv: z.string().role("credential-ref").default(""),
	/** Endpoint base; `/search` is appended. */
	baseURL: z.string(),
	/** Auth template: `bearer` (default), `header`, or `none`. */
	auth: z.string().default("bearer"),
	/** Custom auth header name, used when `auth: header`. */
	authHeader: z.string().default(""),
	/** Response-shape template: `tavily` (default), `brave`, `exa`, or `serper`. */
	response: z.string().default("tavily"),
	/** Request-field name carrying the query (default `query`; Serper uses `q`). */
	queryParam: z.string().default(""),
	/** Literal API key (stored via the credentials domain, not the section). */
	apiKey: z.string().role("secret").default(""),
	/** Upper bound on returned sources (inherits the global default when unset). */
	maxResults: z.number().step(1).min(1).max(MAX_RESULTS_CAP).required(false)
});

/** Plugin config (all optional — `apply` fills defaults). */
const Config = z.object({
	/** Active backend: `deepseek-official` (default), `tavily`, `brave`, or a custom entry id. */
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
	maxUses: z.number().step(1).min(1).default(5),
	/** User-defined custom search providers, each an instance of the generic A1 backend. */
	customProviders: z.array(CustomProvider).default([])
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
		this.custom = new Map();
	}

	available() {
		return this.backend().available();
	}

	async search(request, signal) {
		return this.backend().search(request, signal);
	}

	/** Rebuild the custom-provider instances whenever the live list changes. */
	syncCustom(options) {
		const ids = new Set((options.customList ?? []).map((entry) => entry.id));
		for (const id of [...this.custom.keys()]) if (!ids.has(id)) this.custom.delete(id);
		for (const entry of options.customList ?? []) {
			if (this.custom.has(entry.id)) continue;
			const entryId = entry.id;
			this.custom.set(entryId, new CustomSearchProvider(entryId, () => this.resolveOptions().custom[entryId]));
		}
		return this.custom;
	}

	backend() {
		const options = this.resolveOptions();
		this.syncCustom(options);
		const provider = options.provider;
		if (provider === "brave") return this.brave;
		if (provider === "deepseek-official") return this.deepseek;
		const instance = this.custom.get(provider);
		if (instance !== void 0) return instance;
		return this.tavily;
	}
}

/** Project one resolved section into options for each backend. */
function resolveOptions(ctx, config) {
	const customList = Array.isArray(config.customProviders) ? config.customProviders : [];
	const ids = new Set(customList.map((entry) => entry.id));
	const isCustom = ids.has(config.provider);
	const isBuiltIn = config.provider === "tavily" || config.provider === "brave" || config.provider === "deepseek-official";
	const provider = isBuiltIn || isCustom ? config.provider : "deepseek-official";
	return {
		provider,
		deepseek: resolveDeepseekOptions(ctx, config),
		tavily: resolveTavilyOptions(ctx, config),
		brave: resolveBraveOptions(ctx, config),
		custom: Object.fromEntries(customList.map((entry) => [entry.id, resolveCustomOptions(ctx, entry, config.maxResults ?? 8)])),
		customList
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
	BraveSearchProvider,
	Config,
	CustomProvider,
	CustomSearchProvider,
	DEEPSEEK_DEFAULT_API_KEY_ENV,
	DEEPSEEK_DEFAULT_BASE_URL,
	DeepSeekSearchProvider,
	SEARCH_PROVIDER_ID,
	TAVILY_DEFAULT_API_KEY_ENV,
	TAVILY_DEFAULT_BASE_URL,
	TAVILY_USAGE_POLL_MS,
	TavilySearchProvider,
	UsageTracker,
	WEB_SEARCH_SETTINGS_NAMESPACE,
	WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE,
	apply,
	inject,
	name,
	resolveCustomOptions
};
