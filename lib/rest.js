/**
 * Generic REST web-search backend driven by the static metadata table in
 * `lib/providers.js`. One instance handles any built-in REST provider and any
 * user-defined `customProviders[]` entry, so adding a provider is data (a table
 * row), not a new backend class.
 *
 * Request shape comes from the provider row: `method` (GET/POST), `path`
 * (POST suffix), `queryIn` (query-string vs JSON body), `queryParam` /
 * `countParam` (field names), `params[]` (fixed/conditional extra params), and
 * `auth` (bearer/header/none/query). Response shape is normalized by the
 * lenient parser in this module to the seam's `WebSearchResult`.
 *
 * Side effects (Tavily credits, Brave rate-limit headers, proxy dispatch) are
 * optional hooks the caller injects; the generic body never hard-codes them.
 *
 * @module dsh-web-search-plugin/rest
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { ProxyAgent } from "undici";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Acceptable auth templates (superset includes `query` for SerpApi). */
const AUTH_TYPES = new Set(["bearer", "header", "none", "query"]);

/** Read a non-empty string field. */
function str(value) {
	return typeof value === "string" ? value : "";
}

/** Resolve a `params[]` entry to `{ key, value }` or `null` (skip). */
/** Keep the param's native type: booleans stay booleans (JSON true/false). */
function paramValue(value) {
	if (typeof value === "boolean") return value;
	return value === void 0 ? "" : String(value);
}

function resolveParam(param, ctx) {
	if (param === null || typeof param !== "object") return null;
	const when = str(param.when) || "always";
	const key = str(param.key);
	if (key === "") return null;
	if (when === "always") {
		return { key, value: paramValue(param.value) };
	}
	if (when === "nonEmpty") {
		const raw = ctx[param.setting];
		// Booleans: only `true` is "non-empty"; `false`/missing means omit the field.
		if (typeof raw === "boolean") return raw === true ? { key, value: true } : null;
		const value = str(raw);
		if (value === "") return null;
		return { key, value };
	}
	if (when === "keyed") {
		return ctx.keyed === true ? { key, value: paramValue(param.value) } : null;
	}
	if (when === "keyless") {
		return ctx.keyed !== true ? { key, value: paramValue(param.value) } : null;
	}
	return null;
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
 * Normalize a provider response into a `WebSearchResult` using a lenient
 * (宽容) parser: the results array is located in the first non-empty of
 * `organic_results` / `organic` → `web.results` → `results`, and per-item
 * fields accept the common aliases (`url`/`link`, `content`/`snippet`/
 * `description`/`text`, `published_date`/`date`/`page_age`/`publishedDate`).
 * The `response` hint only influences which answer-style block becomes
 * `content`.
 * @param json - the parsed response body.
 * @param response - the response-shape hint (`tavily`/`brave`/`exa`/`serper`).
 */
function mapCustomResponse(json, response) {
	if (json === null || typeof json !== "object") throw new WebError("The provider returned a non-object response body", "WEB_PROVIDER_ERROR");
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	const hint = str(response) || "tavily";
	let results = null;
	// Position of the results array, ordered by the common providers:
	// Serper/Scavio/SerpApi → `organic_results` / `organic`;
	// Firecrawl → `data.web` (v2) or bare `data` array (v1);
	// Brave → `web.results`; Tavily/Exa/SearXNG → `results`.
	if (hint === "firecrawl") {
		results = Array.isArray(json?.data?.web) ? json.data.web : Array.isArray(json.data) ? json.data : null;
	} else if (hint === "serper" || hint === "serpapi" || hint === "scavio") {
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
 * Generic REST backend. `resolveOptions` returns a projection with `baseURL`,
 * `method`, `path`, `queryIn`, `queryParam`, `countParam`, `auth`, `response`,
 * `params`, `keyed`, and optional `apiKey` / `resolveApiKey`.
 */
export class RestSearchProvider {
	constructor(id, resolveOptions, hooks) {
		this.id = id;
		this.resolveOptions = resolveOptions;
		this.hooks = hooks ?? {};
		this.cachedProxy = void 0;
		this.cachedDispatcher = void 0;
	}

	available() {
		const options = this.resolveOptions();
		if (options?.baseURL == null || !URL.canParse(options.baseURL)) return false;
		const auth = options.auth ?? { type: "none" };
		if (auth.type === "none") return true;
		return (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0;
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		if (options?.baseURL == null || !URL.canParse(options.baseURL)) {
			throw new WebError(`Provider "${this.id}" has no usable endpoint`, "WEB_PROVIDER_ERROR");
		}
		const auth = AUTH_TYPES.has(options.auth?.type) ? options.auth : { type: "none" };
		const method = options.method === "GET" ? "GET" : "POST";
		const queryIn = options.queryIn === "query" ? "query" : "body";
		const queryParam = str(options.queryParam) || "query";
		const countParam = str(options.countParam) || "max_results";
		const responseHint = str(options.response) || "tavily";
		const count = Math.min(request.maxResults ?? options.maxResults ?? 8, MAX_RESULTS_CAP);

		let apiKey;
		if (auth.type !== "none") {
			apiKey = await resolveApiKey(options, signal, `Provider "${this.id}" has no API key for "${options.apiKeyEnv ?? options.apiKeyRef ?? "key"}"; store it through the credentials service, export it in the launching environment, or fill it in the settings card`);
			throwIfSearchAborted(signal);
		}

		// Build query-string params (GET) or JSON body (POST).
		const baseURL = options.baseURL.replace(/\/+$/u, "");
		const path = str(options.path) || "";
		let endpoint = baseURL + (path === "" ? "" : "/" + path.replace(/^\/+/u, ""));
		const query = {
			[queryParam]: request.query
		};
		if (countParam !== "") query[countParam] = String(count);
		const keyed = options.keyed === true;
		for (const param of options.params ?? []) {
			const resolved = resolveParam(param, { keyed, ...options.settings ?? {} });
			if (resolved !== null) query[resolved.key] = resolved.value;
		}

		const headers = {
			accept: "application/json",
			"user-agent": USER_AGENT
		};
		let body = void 0;
		if (method === "GET") {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(query)) params.set(key, value);
			// SerpApi: the key rides the query string too.
			if (auth.type === "query") params.set(str(auth.param) || "api_key", apiKey);
			endpoint = `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
		} else {
			headers["content-type"] = "application/json";
			body = JSON.stringify(query);
		}

		// Auth headers.
		if (auth.type === "bearer") headers["authorization"] = `Bearer ${apiKey}`;
		else if (auth.type === "header") headers[str(auth.header) || "x-api-key"] = apiKey;
		else if (auth.type === "query") {
			/* handled above for GET; POST with query auth is unsupported by design */
		}

		// Keyless-mode headers (Tavily x-tavily-access-mode).
		const keylessHeaders = options.keylessHeaders ?? {};
		const keylessWhen = options.keylessHeaderWhen ?? "";
		if (keylessWhen === "keyless" && keyed === false) Object.assign(headers, keylessHeaders);
		else if (keylessWhen === "keyed" && keyed === true) Object.assign(headers, keylessHeaders);
		else if (keylessWhen === "" || keylessWhen === "always") Object.assign(headers, keylessHeaders);

		const dispatcher = this.dispatcher(options);
		let httpResponse;
		try {
			httpResponse = await fetch(endpoint, {
				method,
				redirect: "error",
				headers,
				...(body !== void 0 ? { body } : {}),
				...signal !== void 0 ? { signal } : {},
				...dispatcher !== void 0 ? { dispatcher } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`Provider "${this.id}" request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}

		this.hooks.onRateLimit?.(httpResponse.headers);
		if (!httpResponse.ok) {
			let message = `Provider "${this.id}" API error (HTTP ${httpResponse.status})`;
			try {
				const parsed = await httpResponse.json();
				const detail = parsed?.detail?.error ?? parsed?.error ?? parsed?.message ?? parsed?.search_metadata?.error;
				if (typeof detail === "string" && detail.length > 0) message = detail;
				else if (typeof detail === "object" && detail != null && typeof detail.message === "string") message = detail.message;
			} catch {
				/* non-JSON error body — keep the status-line message */
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}

		try {
			const json = await httpResponse.json();
			if (responseHint === "tavily" && typeof this.hooks.onUsage === "function") {
				const credits = Number(json?.usage?.credits);
				if (Number.isFinite(credits) && credits >= 0) this.hooks.onUsage(credits);
			}
			return mapCustomResponse(json, responseHint);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`Provider "${this.id}" returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}

	/** Cached undici ProxyAgent keyed by the current proxy URL. */
	dispatcher(options) {
		const proxy = options?.proxy;
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

/**
 * Project a provider table row + plugin section into backend options consumed
 * by `RestSearchProvider`. `resolveSecret(ctx, ...)` supplies `apiKey` /
 * `resolveApiKey` when the provider needs a key.
 *
 * @param {string} ctx - plugin context (for credential/env resolution).
 * @param {object} row - the provider metadata row (`lib/providers.js`).
 * @param {object} opts - `{ config, settings, keyed, keySource }`.
 * @returns backend options for one search.
 */
export function resolveRestProvider(ctx, row, opts) {
	const { config, settings } = opts;
	const auth = row.auth ?? { type: "none" };
	const keyed = opts.keyed === true;
	const base = {
		baseURL: row.baseURL,
		method: row.method ?? "POST",
		path: row.path ?? "",
		queryIn: row.queryIn ?? "body",
		queryParam: row.queryParam ?? "query",
		countParam: row.countParam ?? "max_results",
		auth,
		response: row.response ?? "tavily",
		params: row.params ?? [],
		keyed,
		keylessHeaders: row.keylessHeaders ?? {},
		keylessHeaderWhen: row.keylessHeaderWhen ?? "",
		settings,
		maxResults: config.maxResults ?? 8
	};
	if (auth.type === "none") return base;
	const keySource = opts.keySource ?? {};
	return {
		...base,
		...resolveSecret(ctx, {
			literal: keySource.literal,
			envName: keySource.envName ?? row.apiKeyRef ?? ""
		})
	};
}
