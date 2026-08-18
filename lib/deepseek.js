/**
 * DeepSeek search backend: the Anthropic-compatible Messages API with the
 * native `web_search_20250305` server tool. Each search costs a model turn
 * and returns structured `web_search_tool_result` blocks; absence of those
 * blocks is an error rather than a prose-scraping fallback.
 *
 * This plugin re-hosts the `deepseek-official` provider so the DeepSeek
 * configuration can sit beside Tavily and Brave. The bundle patch disables
 * the in-box `web-search-deepseek` host plugin (its namespace feed the legacy
 * "plugins → web search" card, and re-registering its provider would collide).
 *
 * @module dsh-web-search-plugin/deepseek
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { MAX_RESULTS_CAP, USER_AGENT, isAbortError, resolveApiKey, resolveSecret, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Default endpoint: DeepSeek's Anthropic-compatible API (`/messages` appended). */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic/v1";
/** Default credential reference for this backend. */
export const DEEPSEEK_DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Environment variable naming this backend's endpoint override. */
const DEEPSEEK_SEARCH_BASE_URL_ENV = "DEEPSEEK_SEARCH_BASE_URL";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_USES = 5;

/**
 * Build a `url → cited_text` map from `text` blocks' `citations[]` (the snippet
 * source for Anthropic `web_search_result` items, which carry url/title but no
 * inline excerpt).
 */
function citationSnippets(blocks) {
	const map = /* @__PURE__ */ new Map();
	for (const block of blocks) {
		if (block.type !== "text") continue;
		for (const cite of block.citations ?? []) if (cite.url != null && cite.url.length > 0 && cite.cited_text != null && cite.cited_text.length > 0 && !map.has(cite.url)) map.set(cite.url, cite.cited_text);
	}
	return map;
}

/** Map an Anthropic Messages response to a normalized search result. */
function mapAnthropicResponse(response) {
	const blocks = response.content ?? [];
	const resultBlocks = blocks.filter((block) => block.type === "web_search_tool_result");
	if (resultBlocks.length === 0) throw new WebError("DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search", "WEB_PROVIDER_ERROR");
	const snippets = citationSnippets(blocks);
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const block of resultBlocks) for (const item of block.content ?? []) {
		if (item.type !== "web_search_result" || typeof item.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		const snippet = snippets.get(item.url);
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...snippet !== void 0 ? { snippet } : {},
			...typeof item.page_age === "string" && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}
		});
	}
	return { sources, truncated: false };
}

/** The DeepSeek-backed search backend; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class DeepSeekSearchProvider {
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}

	available() {
		const options = this.resolveOptions();
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0)
			&& URL.canParse(options.baseURL)
			&& Number.isInteger(options.maxTokens) && options.maxTokens > 0
			&& Number.isInteger(options.maxUses) && options.maxUses > 0;
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await resolveApiKey(options, signal, `DeepSeek search has no API key for "${options.apiKeyEnv ?? DEEPSEEK_DEFAULT_API_KEY_ENV}"; store it through the credentials service, export it in the launching environment, or set a literal "deepseekApiKey" in the dsh-web-search-plugin config`);
		throwIfSearchAborted(signal);
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/messages`;
		const body = {
			model: options.model,
			max_tokens: options.maxTokens,
			messages: [{
				role: "user",
				content: [{ type: "text", text: `Perform a web search for the query: ${request.query}` }]
			}],
			tools: [{ type: "web_search_20250305", name: "web_search", max_uses: options.maxUses }]
		};
		throwIfSearchAborted(signal);
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"x-api-key": apiKey,
					"authorization": `Bearer ${apiKey}`,
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
			return mapAnthropicResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			if (error instanceof WebError) throw error;
			throw new WebError(`DeepSeek returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}

/** Project the plugin section into DeepSeek backend options. */
export function resolveDeepseekOptions(ctx, config) {
	return {
		...resolveSecret(ctx, {
			literal: config.deepseekApiKey,
			envName: config.deepseekApiKeyEnv ?? DEEPSEEK_DEFAULT_API_KEY_ENV
		}),
		baseURL: config.deepseekBaseURL ?? launchEnvironmentOf(ctx).get(DEEPSEEK_SEARCH_BASE_URL_ENV)?.value ?? DEEPSEEK_DEFAULT_BASE_URL,
		model: config.model ?? DEFAULT_MODEL,
		apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
		maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
		maxUses: config.maxUses ?? DEFAULT_MAX_USES
	};
}
