/**
 * Static metadata table for every built-in REST web-search provider.
 *
 * This module is intentionally **data, not code**: adding a new REST provider
 * means adding one row here (plus an optional official "get a key" link in the
 * settings card), with zero per-provider execution code. The generic backend in
 * `lib/rest.js` reads a row and performs `method` / `path` / `queryParam` /
 * `countParam` / `params` / `auth` / `response` / `hooks`.
 *
 * Only **pure REST providers** ("one query → one HTTP request → one result
 * array") belong here. Model-native search tool (DeepSeek's Anthropic Messages
 * `web_search_20250305`, Perplexity sonar tools, OpenAI Responses) is **not**
 * REST and stays on its dedicated backend (`lib/deepseek.js`).
 *
 * @module dsh-web-search-plugin/providers
 */

/**
 * Built-in REST providers.
 * `auth.type` ∈ { `bearer`, `header`, `none`, `query` }:
 *   - `bearer` — `Authorization: Bearer <key>`
 *   - `header` — key in a named header (`auth.header`)
 *   - `none`   — no key (SearXNG, keyless)
 *   - `query`  — key as a query-string parameter (`auth.param`, e.g. SerpApi)
 * `params[].when` ∈ { `always`, `nonEmpty`, `keyed`, `keyless` }.
 */
export const REST_PROVIDERS = [
	{
		id: "brave",
		name: "Brave Search",
		kind: "rest",
		method: "GET",
		baseURL: "https://api.search.brave.com/res/v1/web/search",
		path: "",
		queryIn: "query",
		queryParam: "q",
		countParam: "count",
		auth: { type: "header", header: "X-Subscription-Token" },
		keyRequired: true,
		apiKeyRef: "BRAVE_API_KEY",
		response: "brave",
		params: [
			{ key: "country", setting: "country", when: "nonEmpty" },
			{ key: "search_lang", setting: "searchLang", when: "nonEmpty" },
			{ key: "freshness", setting: "freshness", when: "nonEmpty" }
		],
		officialUrl: "https://api-dashboard.search.brave.com/",
		hooks: ["rate-limit", "proxy"]
	},
	{
		id: "tavily",
		name: "Tavily",
		kind: "rest",
		method: "POST",
		baseURL: "https://api.tavily.com",
		path: "/search",
		queryIn: "body",
		queryParam: "query",
		countParam: "max_results",
		auth: { type: "bearer" },
		keyRequired: false, // keyless by default; keyed only when a key is configured
		apiKeyRef: "TAVILY_API_KEY",
		response: "tavily",
		params: [
			{ key: "search_depth", setting: "searchDepth", when: "nonEmpty" },
			{ key: "topic", setting: "topic", when: "nonEmpty" },
			{ key: "include_answer", setting: "includeAnswer", when: "nonEmpty" },
			{ key: "include_images", value: "false", when: "always" },
			{ key: "include_usage", value: "true", when: "keyed" }
		],
		keylessHeaders: { "x-tavily-access-mode": "keyless" },
		keylessHeaderWhen: "keyless",
		officialUrl: "https://app.tavily.com/",
		hooks: ["usage"]
	},
	{
		id: "serper",
		name: "Serper",
		kind: "rest",
		method: "POST",
		baseURL: "https://google.serper.dev",
		path: "/search",
		queryIn: "body",
		queryParam: "q",
		countParam: "num",
		auth: { type: "header", header: "X-API-KEY" },
		keyRequired: true,
		apiKeyRef: "SERPER_API_KEY",
		response: "serper",
		params: [],
		officialUrl: "https://serper.dev/",
		hooks: []
	},
	{
		id: "serpapi",
		name: "SerpApi",
		kind: "rest",
		method: "GET",
		baseURL: "https://serpapi.com",
		path: "/search.json",
		queryIn: "query",
		queryParam: "q",
		countParam: "num",
		auth: { type: "query", param: "api_key" },
		keyRequired: true,
		apiKeyRef: "SERPAPI_API_KEY",
		response: "serper",
		params: [],
		officialUrl: "https://serpapi.com/",
		hooks: []
	},
	{
		id: "exa",
		name: "Exa",
		kind: "rest",
		method: "POST",
		baseURL: "https://api.exa.ai",
		path: "/search",
		queryIn: "body",
		queryParam: "query",
		countParam: "num_results",
		auth: { type: "bearer" },
		keyRequired: true,
		apiKeyRef: "EXA_API_KEY",
		response: "exa",
		params: [
			{ key: "contents", value: "text", when: "always" }
		],
		officialUrl: "https://dashboard.exa.ai/",
		hooks: []
	},
	{
		id: "searxng",
		name: "SearXNG",
		kind: "rest",
		method: "GET",
		baseURL: "https://searx.be",
		path: "/search",
		queryIn: "query",
		queryParam: "q",
		countParam: "count",
		auth: { type: "none" },
		keyRequired: false,
		apiKeyRef: "",
		response: "searxng",
		params: [
			{ key: "format", value: "json", when: "always" }
		],
		officialUrl: "https://docs.searxng.org/",
		hooks: []
	}
];

/** Location of one provider by id (the id doubles as the `provider` value). */
export function findProvider(id) {
	for (const entry of REST_PROVIDERS) if (entry.id === id) return entry;
	return void 0;
}

/** Set of ids that live in the metadata table. */
export function restProviderIds() {
	const ids = /* @__PURE__ */ new Set();
	for (const entry of REST_PROVIDERS) ids.add(entry.id);
	return ids;
}

/** The built-in REST provider ids (seam-facing `provider` values). */
export const BUILTIN_REST_IDS = REST_PROVIDERS.map((entry) => entry.id);

/** The model-native (non-REST) provider id, kept on its own backend. */
export const TOOL_PROVIDER_IDS = ["deepseek-official"];
