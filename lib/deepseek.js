/**
 * DeepSeek search backend: the Anthropic-compatible Messages API with the
 * native `web_search_20250305` server tool. Each search costs a model turn
 * and returns structured `web_search_tool_result` blocks; absence of those
 * blocks is an error rather than a prose-scraping fallback.
 *
 * This backend is a compatibility path, not the default: the card's DeepSeek
 * server-side search pins the in-box `deepseek-official` provider, and follow
 * mode routes DeepSeek requests there too. It still serves profiles pinned to
 * `dsh-web-search` with `provider: "deepseek-official"` from releases before
 * `0.8.0`; the next card save moves them onto the in-box pin.
 *
 * Authentication follows the official provider: a search started from a
 * DeepSeek-account session authenticates with the account token
 * (`x-dsh-auth-token`) when the account service allows this endpoint; every
 * other search reuses `DEEPSEEK_API_KEY`. When a session initiator exists,
 * the secret-free request is recorded as a
 * `web/deepseek-search-llm-request` session event before dispatch.
 *
 * Harness `0.2.3-alpha` routes both credential kinds through `ctx.deepseekAuth`.
 * When that service is mounted and this backend still points at the stock
 * deployment with the stock credential reference, the request is authorized by
 * it — so the search shares the conversation's billing choice. Custom
 * endpoints or custom references keep the local resolution below, because a
 * `deepseekAuth` connection only serves destinations under its own origin.
 *
 * @module dsh-web-search-plugin/deepseek
 */
import { resolveSupplierConfig } from "./config.js";
import { WebError } from "@deepseek-ai/dsh-web";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { apiKeyReady, MAX_RESULTS_CAP, USER_AGENT, abortable, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Default endpoint: DeepSeek's Anthropic-compatible API (`/messages` appended). */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic/v1";
/** Default credential reference for this backend. */
export const DEEPSEEK_DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Environment variable naming this backend's endpoint override. */
const DEEPSEEK_SEARCH_BASE_URL_ENV = "DEEPSEEK_SEARCH_BASE_URL";
/**
 * Provider route id `dsh-llm-deepseek-account` registers; the session's
 * `request/context` records it per Session. Only such a session may spend
 * account quota on auxiliary search.
 */
const ACCOUNT_PROVIDER = "deepseek-account";
const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_USES = 5;

/**
 * Build a `url → cited_text` map from `text` blocks' `citations[]` (the snippet
 * source for a `web_search_result` item that carries no excerpt of its own;
 * the excerpt then lives in a separate `text` block's citation).
 */
function citationSnippets(blocks) {
	const map = /* @__PURE__ */ new Map();
	for (const block of blocks) {
		if (block.type !== "text") continue;
		for (const cite of block.citations ?? []) if (cite.url != null && cite.url.length > 0 && cite.cited_text != null && cite.cited_text.length > 0 && !map.has(cite.url)) map.set(cite.url, cite.cited_text);
	}
	return map;
}

/**
 * Map an Anthropic Messages response to a normalized search result. A result
 * item's own `snippet` wins; the citation excerpt for its `url` is the fallback.
 */
function mapAnthropicResponse(response, maxResults) {
	const blocks = response.content ?? [];
	const resultBlocks = blocks.filter((block) => block.type === "web_search_tool_result");
	if (resultBlocks.length === 0) throw new WebError("DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search", "WEB_PROVIDER_ERROR");
	const snippets = citationSnippets(blocks);
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const block of resultBlocks) for (const item of block.content ?? []) {
		if (item.type !== "web_search_result" || typeof item.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		const own = typeof item.snippet === "string" && item.snippet.length > 0 ? item.snippet : void 0;
		const snippet = own ?? snippets.get(item.url);
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...snippet !== void 0 ? { snippet } : {},
			...typeof item.page_age === "string" && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}
		});
	}
	return sources.length > maxResults
		? { sources: sources.slice(0, maxResults), truncated: true }
		: { sources, truncated: false };
}

/** The DeepSeek-backed search backend; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class DeepSeekSearchProvider {
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}

	available() {
		const options = this.resolveOptions();
		const hasKey = (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0;
		const canUseAccount = options.resolveAccountToken !== void 0;
		// A mounted `ctx.deepseekAuth` owns both kinds; availability there is
		// decided per request, so presence alone keeps this backend selectable.
		const canAuthorize = options.authorize !== void 0;
		return (hasKey || canUseAccount || canAuthorize)
			&& URL.canParse(options.baseURL)
			&& Number.isInteger(options.maxTokens) && options.maxTokens > 0
			&& Number.isInteger(options.maxUses) && options.maxUses > 0;
	}

	/** Use the pending model route, rather than the previous session request. */
	async ready(llmProvider) {
		const options = this.resolveOptions();
		if (llmProvider === ACCOUNT_PROVIDER && options.resolveAccountToken !== void 0) {
			try {
				const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/messages`;
				const token = await options.resolveAccountToken(endpoint, llmProvider);
				if ((token?.length ?? 0) > 0) return true;
			} catch {
				return false;
			}
		}
		return await apiKeyReady(options);
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/messages`;
		let authHeaders;
		// Harness `0.2.3-alpha` exposes `ctx.deepseekAuth`: one service orders the
		// account sign-in and the API key for the route this search serves, so the
		// request bills exactly like the conversation. Absent on `0.2.2-rc.5`, and
		// unused for a custom endpoint or reference, where the local resolution
		// below still decides.
		if (options.authorize !== void 0) {
			let authorized;
			try {
				authorized = await abortable(Promise.resolve().then(() => options.authorize(endpoint, request.llmProvider, signal)), signal);
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
				throw new WebError(`DeepSeek credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
			}
			throwIfSearchAborted(signal);
			if (authorized !== void 0) authHeaders = authorized;
		}
		if (authHeaders === void 0) {
			// An account-authorized search spends account quota and must not need a
			// stored API key; every other search resolves `DEEPSEEK_API_KEY`. The
			// request names the route that serves this search (`llmProvider`), so the
			// decision matches the readiness check instead of guessing the session's
			// latest route.
			let accountToken;
			try {
				accountToken = await abortable(Promise.resolve().then(() => options.resolveAccountToken?.(endpoint, request.llmProvider)), signal);
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
				throw new WebError(`DeepSeek account token resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
			}
			throwIfSearchAborted(signal);
			if (typeof accountToken === "string" && accountToken.length > 0) {
				authHeaders = { "x-dsh-auth-token": accountToken };
			} else {
				const apiKey = await resolveApiKey(options, signal, `DeepSeek search has no API key for "${options.apiKeyEnv ?? DEEPSEEK_DEFAULT_API_KEY_ENV}"; store it through the credentials service, export it in the launching environment, or set a literal "deepseekApiKey" in the dsh-web-search-plugin config`);
				authHeaders = { "x-api-key": apiKey, "authorization": `Bearer ${apiKey}` };
			}
		}
		throwIfSearchAborted(signal);
		const body = {
			model: options.model,
			max_tokens: options.maxTokens,
			messages: [{
				role: "user",
				content: [{ type: "text", text: `Perform a web search for the query: ${request.query}` }]
			}],
			tools: [{ type: "web_search_20250305", name: "web_search", max_uses: options.maxUses }],
			thinking: { type: "disabled" }
		};
		// Record the exact secret-free request before it leaves; a throw here
		// prevents dispatch rather than logging an unrecorded model input.
		options.recordRequest?.({ endpoint, apiVersion: options.apiVersion, body });
		throwIfSearchAborted(signal);
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					...authHeaders,
					"anthropic-version": options.apiVersion,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`DeepSeek search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `DeepSeek API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
				if (typeof detail === "string" && detail.length > 0) message = detail;
			} catch {
				/* non-JSON error body — keep the status-line message */
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			const maxResults = Math.min(request.maxResults ?? MAX_RESULTS_CAP, options.maxResults ?? 8, MAX_RESULTS_CAP);
			return mapAnthropicResponse(await response.json(), maxResults);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`DeepSeek returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}

/**
 * Project the plugin section into DeepSeek backend options.
 *
 * `available()` accepts a search that can authenticate *either* way: a stored
 * API key, an account-authorized session, or both.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - one detached section snapshot.
 * @returns options for one search.
 */
export function resolveDeepseekOptions(ctx, config) {
	config = resolveSupplierConfig(config);
	const apiKeyEnv = config.deepseekApiKeyEnv ?? DEEPSEEK_DEFAULT_API_KEY_ENV;
	const baseURL = config.deepseekBaseURL || launchEnvironmentOf(ctx).get(DEEPSEEK_SEARCH_BASE_URL_ENV)?.value || DEEPSEEK_DEFAULT_BASE_URL;
	// `ctx.deepseekAuth` binds each credential kind to the deployment origin its
	// connection names and reads the key under that connection's reference. A
	// custom endpoint, a custom reference, or a literal key therefore cannot be
	// served by it without restating the whole connection, and keeps the local
	// resolution below instead.
	const literalKey = (config.deepseekApiKey ?? "").length > 0;
	const serviced = !literalKey
		&& baseURL === DEEPSEEK_DEFAULT_BASE_URL
		&& apiKeyEnv === DEEPSEEK_DEFAULT_API_KEY_ENV;
	const authorize = serviced
		? async (endpoint, llmProvider, signal) => {
			const auth = ctx.get("deepseekAuth");
			// `0.2.2-rc.5` mounts no such service; the caller falls back.
			if (auth === void 0) return void 0;
			const authorization = await auth.authorize({
				consumer: "dsh-web-search-plugin",
				accepts: ["account", "api-key"],
				billing: "auto",
				route: llmProvider,
				destination: { url: endpoint },
				// The Messages API accepts the key in either header; naming both keeps
				// the wire shape this backend sent before the service existed.
				apiKeyHeaders: ["authorization", "x-api-key"]
			}, signal);
			return authorization === void 0 ? void 0 : { ...authorization.headers };
		}
		: void 0;
	return {
		...resolveSecret(ctx, {
			literal: config.deepseekApiKey,
			envName: apiKeyEnv
		}),
		...authorize === void 0 ? {} : { authorize },
		// Only a DeepSeek-account route may spend account quota; every other
		// route falls back to the API key resolved above. The search passes the
		// route that serves it; older hosts name no route, so the session's latest
		// one stands in.
		resolveAccountToken: async (endpoint, llmProvider = ctx.get("agents")?.currentInitiator()?.session.requestContext()?.provider) => {
			if (llmProvider !== ACCOUNT_PROVIDER) return void 0;
			return await ctx.get("deepseekAccount")?.resolveToken(endpoint);
		},
		recordRequest: (request) => {
			ctx.get("agents")?.currentInitiator()?.session.append("web/deepseek-search-llm-request", request);
		},
		baseURL,
		model: config.deepseekModel ?? DEFAULT_MODEL,
		apiVersion: config.deepseekApiVersion ?? DEFAULT_API_VERSION,
		maxTokens: config.deepseekMaxTokens ?? DEFAULT_MAX_TOKENS,
		maxUses: config.deepseekMaxUses ?? DEFAULT_MAX_USES,
		maxResults: config.maxResults ?? 8
	};
}
