/**
 * Tavily REST search backend (`POST {baseURL}/search`).
 * @module dsh-web-search-plugin/tavily
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";
import { parseTavilySearchCredits } from "./usage.js";

/** Default Tavily REST API base; `/search` is appended. */
export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Default credential reference resolved for every keyed search. */
export const TAVILY_DEFAULT_API_KEY_ENV = "TAVILY_API_KEY";
/** Environment variable naming this backend's endpoint override. */
const TAVILY_BASE_URL_ENV = "TAVILY_BASE_URL";

/**
 * Normalize a standard Tavily search response into the seam's
 * `WebSearchResult`. Sources are deduped by `url`; the provider-generated
 * `answer` becomes `content` only when `includeAnswer` asked for it.
 * @param json - the parsed Tavily response body.
 * @param includeAnswer - whether the request requested `include_answer`.
 * @returns the normalized search result.
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

/** The Tavily-backed search backend; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider {
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}

	available() {
		const options = this.resolveOptions();
		if (!URL.canParse(options.baseURL)) return false;
		if (options.mode !== "keyed") return true;
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0);
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		let apiKey;
		if (options.mode === "keyed") {
			apiKey = await resolveApiKey(options, signal, `Tavily search has no API key for "${options.apiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the dsh-web-search-plugin config`);
			throwIfSearchAborted(signal);
		}
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/search`;
		const keyed = options.mode === "keyed";
		const body = {
			query: request.query,
			max_results: Math.min(request.maxResults ?? options.maxResults, MAX_RESULTS_CAP),
			search_depth: options.searchDepth,
			topic: options.topic,
			include_answer: options.includeAnswer === true,
			include_images: false,
			...keyed ? { include_usage: true } : {}
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
			const json = await response.json();
			if (keyed) {
				const credits = parseTavilySearchCredits(json);
				if (credits !== null) options.onUsage?.(credits);
			}
			return mapTavilyResponse(json, options.includeAnswer === true);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}

/** Project the plugin section into Tavily backend options. */
export function resolveTavilyOptions(ctx, config) {
	return {
		mode: config.mode ?? "keyless",
		...resolveSecret(ctx, {
			literal: config.apiKey,
			envName: config.apiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV
		}),
		baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(TAVILY_BASE_URL_ENV)?.value ?? TAVILY_DEFAULT_BASE_URL,
		maxResults: config.maxResults ?? 8,
		searchDepth: config.searchDepth ?? "basic",
		includeAnswer: config.includeAnswer ?? true,
		topic: config.topic ?? "general"
	};
}
