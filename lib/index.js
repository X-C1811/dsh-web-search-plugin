/**
 * Tavily-backed search provider for the DeepSeek Harness web capability seam
 * (`ctx.web`). Registers a `WebSearchProvider` under the stable id `tavily`
 * that calls the Tavily REST API (`POST {baseURL}/search`).
 *
 * Two authentication modes are supported, switchable through this plugin's
 * settings section (`web-search-tavily`):
 * - `keyless`: free rate-limited access, no account or key. A single
 *   `X-Tavily-Access-Mode: keyless` header activates it.
 * - `keyed`: a Tavily API key resolved through the credentials service
 *   (`TAVILY_API_KEY` by default), the launching environment, or a literal
 *   `apiKey` in the config; sent as a Bearer token.
 *
 * Responses follow the standard Tavily schema and are normalized into the
 * seam's `WebSearchResult` (`answer` -> `content`, `results[]` -> `sources[]`).
 *
 * The plugin mirrors the structure of `@deepseek-ai/dsh-web-search-deepseek`:
 * a function/namespace Cordis plugin (`inject: ['web']`) that registers its
 * own settings section and never registers a model-facing tool.
 *
 * @module web-search-tavily
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

/** Stable id this provider registers under. */
const TAVILY_PROVIDER_ID = "tavily";
/** Default Tavily REST API base; `/search` is appended. */
const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Default credential reference resolved for every keyed search. */
const DEFAULT_API_KEY_ENV = "TAVILY_API_KEY";
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness-web-search-tavily/0.1.0";
/** Tavily's hard cap on `max_results`. */
const TAVILY_MAX_RESULTS_CAP = 20;

/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-tavily";
/** The web seam this provider registers into. */
const inject = ["web"];

/** Plugin config (all optional — `apply` fills defaults). */
const Config = z.object({
	/** Authentication mode: `keyless` (default, free rate-limited) or `keyed`. */
	mode: z.string().default("keyless"),
	/** Literal Tavily API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
	apiKey: z.string().role("secret").default(""),
	/** Credential reference resolved for each keyed search; defaults to `TAVILY_API_KEY`. */
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	/** Tavily REST API base. Defaults to `https://api.tavily.com`. */
	baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL),
	/** Upper bound on returned sources; Tavily accepts 1..20. */
	maxResults: z.number().step(1).min(1).max(TAVILY_MAX_RESULTS_CAP).default(8),
	/** Search depth: `basic` (default) or `advanced`. */
	searchDepth: z.string().default("basic"),
	/** Request Tavily's generated answer text; surfaced as the result `content`. */
	includeAnswer: z.boolean().default(true),
	/** Search topic: `general` (default) or `news`. */
	topic: z.string().default("general"),
	/** Settings namespace carrying this provider's mode, endpoint, and key reference. */
});
/** Settings namespace carrying this provider's mode, endpoint, and key reference. */
const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = settingsNamespace("web-search-tavily");
/** Environment variable naming this provider's endpoint override. */
const TAVILY_BASE_URL_ENV = "TAVILY_BASE_URL";

/**
 * Normalize a standard Tavily search response into the seam's
 * `WebSearchResult`. Sources are deduped by `url` (Tavily can surface the same
 * page twice); the provider-generated `answer` becomes `content` only when the
 * `includeAnswer` option asked for it. The seam owns the final `maxResults`
 * truncation, so `truncated` is always `false` here.
 *
 * @param json - the parsed Tavily response body.
 * @param includeAnswer - whether the request requested `include_answer`.
 * @returns the normalized search result.
 * @throws {@link WebError} when the body is not a usable object.
 */
function mapTavilyResponse(json, includeAnswer) {
	if (json === null || typeof json !== "object") throw new WebError("Tavily returned a non-object response body", "WEB_PROVIDER_ERROR");
	const results = Array.isArray(json.results) ? json.results : [];
	if (results.length === 0) throw new WebError("Tavily returned no results", "WEB_PROVIDER_ERROR");
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const item of results) {
		if (item === null || typeof item !== "object") continue;
		if (typeof item.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...typeof item.content === "string" && item.content.length > 0 ? { snippet: item.content } : {},
			...typeof item.published_date === "string" && item.published_date.length > 0 ? { publishedAt: item.published_date } : {}
		});
	}
	return {
		...includeAnswer === true && typeof json.answer === "string" && json.answer.length > 0 ? { content: json.answer } : {},
		sources,
		truncated: false
	};
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
class TavilySearchProvider {
	/**
	 * @param resolveOptions - the options for the NEXT operation, snapshotted
	 * once at each operation's entry so one search never mixes two sections.
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}

	id = TAVILY_PROVIDER_ID;

	/** Cheap local usability check; must not make network calls. */
	available() {
		const options = this.resolveOptions();
		if (!URL.canParse(options.baseURL)) return false;
		if (options.mode !== "keyed") return true;
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0);
	}

	/** Run one search through the Tavily REST API. */
	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		let apiKey;
		if (options.mode === "keyed") {
			apiKey = await this.apiKey(options, signal);
			throwIfSearchAborted(signal);
		}
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/search`;
		const body = {
			query: request.query,
			max_results: Math.min(request.maxResults ?? options.maxResults, TAVILY_MAX_RESULTS_CAP),
			search_depth: options.searchDepth,
			topic: options.topic,
			include_answer: options.includeAnswer === true,
			include_images: false
		};
		const headers = {
			"content-type": "application/json",
			"accept": "application/json",
			"user-agent": USER_AGENT,
			...options.mode === "keyless" ? { "x-tavily-access-mode": "keyless" } : { "authorization": `Bearer ${apiKey}` }
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers,
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Tavily search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Tavily API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = parsed?.detail?.error ?? parsed?.error ?? parsed?.message;
				if (typeof detail === "string" && detail.length > 0) message = detail;
			} catch {
				/* non-JSON error body — keep the status-line message */
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapTavilyResponse(await response.json(), options.includeAnswer === true);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}

	/**
	 * Resolve one operation's credential without retaining it on the provider.
	 * @param options - the caller's snapshot; the certificate and the endpoint it is sent to come from one section.
	 * @param signal - abort signal for the surrounding search.
	 * @returns the resolved key.
	 */
	async apiKey(options, signal) {
		throwIfSearchAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Tavily search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new WebError(`Tavily search has no API key for "${options.apiKeyEnv ?? DEFAULT_API_KEY_ENV}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-tavily config`, "WEB_PROVIDER_CREDENTIAL_MISSING");
	}
}

/** Race a same-process asynchronous preflight against caller cancellation. */
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
	return new WebError("Tavily search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		mode: config.mode ?? "keyless",
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(TAVILY_BASE_URL_ENV)?.value ?? TAVILY_DEFAULT_BASE_URL,
		maxResults: config.maxResults ?? 8,
		searchDepth: config.searchDepth ?? "basic",
		includeAnswer: config.includeAnswer ?? true,
		topic: config.topic ?? "general"
	};
}

/** Register the Tavily search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
}

export { Config, TAVILY_DEFAULT_BASE_URL, TAVILY_PROVIDER_ID, TavilySearchProvider, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, apply, inject, name };