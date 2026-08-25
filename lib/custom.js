/**
 * Generic REST search backend for user-defined web-search providers (option 1:
 * pure REST search APIs only — not model-native search tools, which stay with
 * the built-in `deepseek-official` backend).
 *
 * A custom provider is one instance of this backend configured by the user
 * with a display name, a credential reference, an endpoint URL, an auth
 * template, and a response-shape template. The request is always
 * `POST {baseURL}/search` with a JSON body carrying `query` / `max_results` —
 * the dominant convention (Tavily / Tavily-like gateways). Auth varies by
 * template: `bearer` (`Authorization: Bearer <key>`), `header` (put the key in
 * a user-named header such as `X-Subscription-Token`), or `none`. Response
 * parsing varies by template: `tavily`, `brave`, or `exa` result shapes, all
 * normalized into the seam's `WebSearchResult`.
 *
 * @module dsh-web-search-plugin/custom
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Acceptable auth templates. */
const AUTH_TEMPLATES = new Set(["bearer", "header", "none"]);

/** Read a non-empty string field, guarding against non-string junk. */
function str(value) {
	return typeof value === "string" ? value : "";
}

/** Push one source, deduped by url, only when it has a usable url. */
function pushSource(sources, seen, item, title, snippet, publishedAt) {
	const url = str(item.url ?? item.link ?? item.id);
	if (url === "" || seen.has(url)) return;
	seen.add(url);
	sources.push({
		url,
		...str(title).length > 0 ? { title } : {},
		...str(snippet).length > 0 ? { snippet } : {},
		...str(publishedAt).length > 0 ? { publishedAt } : {}
	});
}

/**
 * Normalize a custom provider response into a `WebSearchResult` using a
 * lenient (宽容) parser: the results array is located in the first non-empty
 * of `organic` → `web.results` → `results`, and per-item fields accept the
 * common aliases (`url`/`link`, `content`/`snippet`/`description`/`text`,
 * `published_date`/`date`/`page_age`/`publishedDate`). The `response` hint
 * only influences which answer-style block becomes `content`.
 * @param json - the parsed response body.
 * @param response - the response-shape hint (`tavily`/`brave`/`exa`/`serper`).
 */
export function mapCustomResponse(json, response) {
	if (json === null || typeof json !== "object") throw new WebError("The custom provider returned a non-object response body", "WEB_PROVIDER_ERROR");
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	const hint = str(response) || "tavily";
	let results = null;
	// Position of the results array, ordered by the common providers:
	// Serper/SerpApi → `organic` (Serper) / `organic_results` (SerpApi);
	// Brave → `web.results`; Tavily/Exa/SearXNG → `results`.
	if (hint === "serper" || hint === "serpapi") {
		results = Array.isArray(json.organic_results) ? json.organic_results : Array.isArray(json.organic) ? json.organic : null;
	} else {
		results = Array.isArray(json.organic) ? json.organic : null;
	}
	if (results === null || results.length === 0) {
		results = Array.isArray(json?.web?.results) ? json.web.results : null;
	}
	if (results === null || results.length === 0) {
		results = Array.isArray(json.results) ? json.results : [];
	}
	for (const item of results) {
		if (item === null || typeof item !== "object") continue;
		const snippet = str(item.content).length > 0
			? item.content
			: str(item.snippet).length > 0
				? item.snippet
				: str(item.description).length > 0
					? item.description
					: str(item.text).length > 0
						? item.text
						: Array.isArray(item.highlights) && str(item.highlights[0]).length > 0
							? item.highlights[0]
							: Array.isArray(item.extra_snippets) && str(item.extra_snippets[0]).length > 0
								? item.extra_snippets[0]
								: "";
		pushSource(sources, seen, item, item.title, snippet, item.published_date ?? item.date ?? item.page_age ?? item.publishedDate);
	}
	const answer = str(json.answer).length > 0
		? json.answer
		: str(json.answerBox?.answer).length > 0
			? json.answerBox.answer
			: str(json.knowledgeGraph?.description).length > 0
				? json.knowledgeGraph.description
				: str(json.knowledge_graph?.description).length > 0
					? json.knowledge_graph.description
					: "";
	return {
		...answer.length > 0 ? { content: answer } : {},
		sources,
		truncated: false
	};
}

/**
 * One user-defined search backend instance. `id` is the stable internal key
 * (never changes on rename/delete-recreate); `name` is only for display.
 */
export class CustomSearchProvider {
	constructor(id, resolveOptions) {
		this.id = id;
		this.resolveOptions = resolveOptions;
	}

	available() {
		const options = this.resolveOptions();
		if (options.baseURL == null || !URL.canParse(options.baseURL)) return false;
		// `none` needs no key; otherwise a key must be present or resolvable.
		if (options.auth === "none") return true;
		return (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0;
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		if (options.baseURL == null || !URL.canParse(options.baseURL)) {
			throw new WebError(`Custom provider "${options.name ?? this.id}" has no usable endpoint`, "WEB_PROVIDER_ERROR");
		}
		const auth = AUTH_TEMPLATES.has(options.auth) ? options.auth : "bearer";
		const response = str(options.response) || "tavily";
		let apiKey;
		if (auth !== "none") {
			apiKey = await resolveApiKey(options, signal, `Custom provider "${options.name ?? this.id}" has no API key for "${options.apiKeyEnv}"; store it through the credentials service, export it in the launching environment, or fill it on the custom-provider card`);
			throwIfSearchAborted(signal);
		}
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/search`;
		const body = {
			[options.queryParam || "query"]: request.query,
			max_results: Math.min(request.maxResults ?? options.maxResults, MAX_RESULTS_CAP)
		};
		const headers = {
			"content-type": "application/json",
			"accept": "application/json",
			"user-agent": USER_AGENT
		};
		if (auth === "bearer") headers["authorization"] = `Bearer ${apiKey}`;
		else if (auth === "header") headers[str(options.authHeader) || "x-api-key"] = apiKey;
		let httpResponse;
		try {
			httpResponse = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers,
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Custom provider search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!httpResponse.ok) {
			let message = `Custom provider API error (HTTP ${httpResponse.status})`;
			try {
				const parsed = await httpResponse.json();
				const detail = parsed?.detail?.error ?? parsed?.error ?? parsed?.message;
				if (typeof detail === "string" && detail.length > 0) message = detail;
			} catch {
				/* non-JSON error body — keep the status-line message */
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapCustomResponse(await httpResponse.json(), response);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Custom provider returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}

/**
 * Project one custom-provider list entry into backend options.
 * @param ctx - plugin context (for credential/env resolution).
 * @param entry - the user-defined entry from `customProviders[]`.
 * @param maxResults - inherited upper bound on sources when the entry sets none.
 */
export function resolveCustomOptions(ctx, entry, maxResults = 8) {
	const auth = str(entry?.auth) || "bearer";
	const authHeader = str(entry?.authHeader);
	const needsKey = auth !== "none";
	const response = str(entry?.response) || "tavily";
	// Serper's endpoint expects the query under `q`; a configured queryParam wins.
	const queryParam = str(entry?.queryParam) || (response === "serper" ? "q" : "query");
	const base = {
		name: entry?.name,
		baseURL: entry?.baseURL,
		auth,
		authHeader,
		response,
		queryParam,
		maxResults: entry?.maxResults ?? maxResults
	};
	if (!needsKey) return base;
	return {
		...base,
		...resolveSecret(ctx, {
			literal: str(entry?.apiKey),
			envName: str(entry?.apiKeyEnv) || "CUSTOM_PROVIDER_API_KEY"
		})
	};
}
