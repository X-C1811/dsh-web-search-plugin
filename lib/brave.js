/**
 * Brave Search API backend (`GET {baseURL}?q=`).
 *
 * Intentionally does **not** append a custom session event. The standalone
 * `@dsh-ltctfer/dsh-web-search-brave` plugin wrote `web/brave-search-request`
 * on every call; that type is outside DSH's `KNOWN_SESSION_EVENT_TYPES`, and
 * `Session.append` cannot set `ignorable: true`, so a cold load refused the
 * whole conversation. Search traffic already lands on the seam's own
 * `web_search` tool events — extra telemetry is not worth a broken log.
 *
 * @module dsh-web-search-plugin/brave
 */
import { ProxyAgent } from "undici";
import { WebError } from "@deepseek-ai/dsh-web";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, isPositiveInteger, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Default Brave Search API web-results endpoint. */
export const BRAVE_DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1/web/search";
/** Default credential reference resolved for every Brave search. */
export const BRAVE_DEFAULT_API_KEY_ENV = "BRAVE_API_KEY";

/**
 * Map a Brave Search API response to a normalized search result. Walks
 * `web.results[]`, joins `description` / first `extra_snippets` as the snippet,
 * and dedupes by `url`.
 * @param body - the parsed Brave Search API response body.
 * @returns the normalized result with deduped sources.
 */
function mapBraveResponse(body) {
	const results = body?.web?.results;
	if (!Array.isArray(results)) {
		throw new WebError("Brave returned no web.results array; the response body is not a Brave Search API web response", "WEB_PROVIDER_ERROR");
	}
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const item of results) {
		if (item == null || typeof item.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		const snippet = typeof item.description === "string" && item.description.length > 0
			? item.description
			: Array.isArray(item.extra_snippets) && typeof item.extra_snippets[0] === "string" && item.extra_snippets[0].length > 0
				? item.extra_snippets[0]
				: void 0;
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...snippet !== void 0 ? { snippet } : {},
			...typeof item.page_age === "string" && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}
		});
	}
	return {
		sources,
		truncated: false
	};
}

/** The Brave Search API-backed backend; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider {
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
		this.cachedProxy = void 0;
		this.cachedDispatcher = void 0;
	}

	available() {
		const options = this.resolveOptions();
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0)
			&& URL.canParse(options.baseURL)
			&& isPositiveInteger(options.maxResults);
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await resolveApiKey(options, signal, `Brave search has no API key for "${options.apiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV}"; store it through the credentials service, export it in the launching environment, or set a literal "braveApiKey" in the dsh-web-search-plugin config`);
		throwIfSearchAborted(signal);
		const count = Math.min(options.maxResults, isPositiveInteger(request.maxResults) ? request.maxResults : options.maxResults, MAX_RESULTS_CAP);
		const params = new URLSearchParams();
		params.set("q", request.query);
		params.set("count", String(count));
		if (options.country != null && options.country.length > 0) params.set("country", options.country);
		if (options.searchLang != null && options.searchLang.length > 0) params.set("search_lang", options.searchLang);
		if (options.freshness != null && options.freshness.length > 0) params.set("freshness", options.freshness);
		const endpoint = `${options.baseURL}?${params.toString()}`;
		throwIfSearchAborted(signal);
		const dispatcher = this.dispatcher(options);
		let response;
		try {
			response = await fetch(endpoint, {
				method: "GET",
				redirect: "error",
				headers: {
					"x-subscription-token": apiKey,
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				...signal !== void 0 ? { signal } : {},
				...dispatcher !== void 0 ? { dispatcher } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Brave search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Brave Search API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				if (typeof parsed?.error === "string" && parsed.error.length > 0) message = parsed.error;
				else if (typeof parsed?.error?.message === "string" && parsed.error.message.length > 0) message = parsed.error.message;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapBraveResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}

	/**
	 * Cached undici ProxyAgent for the current proxy URL. Node's fetch does not
	 * read `HTTPS_PROXY` itself; a configured proxy (or the launch-environment
	 * fallback) is how DNS for api.search.brave.com can go through a tunnel.
	 */
	dispatcher(options) {
		const proxy = options.proxy;
		if (proxy === void 0 || proxy.length === 0) return void 0;
		if (this.cachedProxy === proxy) return this.cachedDispatcher;
		if (this.cachedDispatcher !== void 0) {
			this.cachedDispatcher.close?.().catch(() => {});
		}
		this.cachedProxy = proxy;
		this.cachedDispatcher = new ProxyAgent(proxy);
		return this.cachedDispatcher;
	}
}

/** Project the plugin section into Brave backend options. */
export function resolveBraveOptions(ctx, config) {
	const environment = launchEnvironmentOf(ctx);
	return {
		...resolveSecret(ctx, {
			literal: config.braveApiKey,
			envName: config.braveApiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV
		}),
		baseURL: config.braveBaseURL ?? BRAVE_DEFAULT_BASE_URL,
		maxResults: config.maxResults ?? 8,
		country: config.country,
		searchLang: config.searchLang,
		freshness: config.freshness,
		proxy: config.proxy ?? environment.get("HTTPS_PROXY")?.value ?? environment.get("HTTP_PROXY")?.value
	};
}
