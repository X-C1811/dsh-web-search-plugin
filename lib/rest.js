/**
 * Generic REST web-search backend driven by the static metadata table in
 * `lib/providers.js`. One instance handles any built-in REST provider and any
 * user-defined `customProviders[]` entry, so adding a provider is data (a table
 * row), not a new backend class.
 *
 * Request shape comes from the provider row: `method` (GET/POST), `path`
 * (POST suffix), `queryIn` (query-string vs JSON body), `queryParam` /
 * `countParam` (field names), `params[]` (fixed/conditional extra params), and
 * `auth` (bearer/header/none/query). Response shape uses the lenient parser
 * from `lib/custom.js`, normalized to the seam's `WebSearchResult`.
 *
 * Side effects (Tavily credits, Brave rate-limit headers, proxy dispatch) are
 * optional hooks the caller injects; the generic body never hard-codes them.
 *
 * @module dsh-web-search-plugin/rest
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { ProxyAgent } from "undici";
import { mapCustomResponse } from "./custom.js";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Acceptable auth templates (superset includes `query` for SerpApi). */
const AUTH_TYPES = new Set(["bearer", "header", "none", "query"]);

/** Read a non-empty string field. */
function str(value) {
	return typeof value === "string" ? value : "";
}

/** Resolve a `params[]` entry to `{ key, value }` or `null` (skip). */
function resolveParam(param, ctx) {
	if (param === null || typeof param !== "object") return null;
	const when = str(param.when) || "always";
	const key = str(param.key);
	if (key === "") return null;
	if (when === "always") {
		return { key, value: param.value === void 0 ? "" : String(param.value) };
	}
	if (when === "nonEmpty") {
		const raw = ctx[param.setting];
		const value = typeof raw === "boolean" ? String(raw) : str(raw);
		if (value === "") return null;
		return { key, value };
	}
	if (when === "keyed") {
		return ctx.keyed === true ? { key, value: String(param.value) } : null;
	}
	if (when === "keyless") {
		return ctx.keyed !== true ? { key, value: String(param.value) } : null;
	}
	return null;
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
