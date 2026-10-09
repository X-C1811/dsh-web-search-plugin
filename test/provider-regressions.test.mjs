import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function loadModule(file, fetchImpl, environment = {}, now = () => Date.now(), extraMocks = {}) {
	class WebError extends Error {
		constructor(message, code, options) { super(message, options); this.code = code; }
	}
	const context = vm.createContext({
		URL,
		URLSearchParams,
		fetch: fetchImpl,
		Date: class extends Date { static now() { return now(); } },
		process: { env: {} },
		setTimeout: () => 1
	});
	const shared = {
		MAX_RESULTS_CAP: 20,
		USER_AGENT: "test",
		abortable: (operation, signal) => signal === undefined ? operation : new Promise((resolve, reject) => {
			if (signal.aborted) return reject(new WebError("Search aborted", "WEB_ABORTED"));
			const onAbort = () => reject(new WebError("Search aborted", "WEB_ABORTED"));
			signal.addEventListener("abort", onAbort, { once: true });
			operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
		}),
		isAbortError: () => false,
		resolveApiKey: async (options) => options.apiKey,
		resolveSecret: () => ({}),
		searchAborted: () => new WebError("Search aborted", "WEB_ABORTED"),
		throwIfSearchAborted: (signal) => { if (signal?.aborted) throw new WebError("Search aborted", "WEB_ABORTED"); }
	};
	const mocks = {
		"@deepseek-ai/dsh-web": { WebError },
		"@deepseek-ai/dsh-launch-environment": { launchEnvironmentOf: () => ({ get: (key) => environment[key] === undefined ? undefined : { value: environment[key] } }) },
		"undici": { ProxyAgent: class ProxyAgent {} },
		"node:os": { homedir: () => "/tmp" },
		"node:crypto": { createHash },
		"node:path": { dirname: () => "/tmp", join: (...parts) => parts.join("/") },
		"node:fs/promises": { mkdir: async () => {}, readFile: async () => "{}", writeFile: async () => {} },
		"./usage.js": { parseTavilySearchCredits: () => null },
		"./shared.js": shared,
		...extraMocks
	};
	const module = new vm.SourceTextModule(readFileSync(new URL(file, root), "utf8"), { context });
	await module.link(async (specifier) => {
		const exports = mocks[specifier];
		assert.ok(exports, `unexpected import ${specifier}`);
		return new vm.SyntheticModule(Object.keys(exports), function () {
			for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
		}, { context });
	});
	await module.evaluate();
	return module.namespace;
}

test("an inactive engine's invalid credential reference cannot break the selected engine", async () => {
	const field = { default() { return this; }, volatile() { return this; }, role() { return this; }, step() { return this; }, min() { return this; }, max() { return this; } };
	const schema = { object: () => ({}), string: () => field, number: () => field, boolean: () => field };
	const unused = () => { throw new Error("inactive engine was resolved"); };
	const { apply } = await loadModule("lib/index.js", () => {}, {}, () => Date.now(), {
		"@deepseek-ai/schemastery": { default: schema },
		"./tavily.js": { TAVILY_DEFAULT_API_KEY_ENV: "TAVILY_API_KEY", TAVILY_DEFAULT_BASE_URL: "https://tavily.test", TavilySearchProvider: class {}, resolveTavilyOptions: unused },
		"./brave.js": { BRAVE_DEFAULT_API_KEY_ENV: "BRAVE_API_KEY", BRAVE_DEFAULT_BASE_URL: "https://brave.test", BraveSearchProvider: class {}, resolveBraveOptions: unused },
		"./deepseek.js": { DEEPSEEK_DEFAULT_API_KEY_ENV: "DEEPSEEK_API_KEY", DEEPSEEK_DEFAULT_BASE_URL: "https://deepseek.test", DeepSeekSearchProvider: class { available() { return true; } }, resolveDeepseekOptions: () => ({}) },
		"./usage.js": { TAVILY_USAGE_POLL_MS: 600_000, UsageTracker: class {} },
		"./rest.js": { RestSearchProvider: class {}, resolveRestProvider: unused },
		"./providers.js": { BUILTIN_REST_IDS: ["tavily", "serper"], REST_PROVIDERS: [], findProvider: unused }
	});
	const values = { provider: "deepseek-official", serperApiKeyEnv: "BAD-KEY" };
	const config = new Proxy({}, { get: (_target, fieldName) => ({ get: () => values[fieldName] }) });
	let selected;
	apply({ effect: () => {}, inject: () => {}, web: { registerSearchProvider: (provider) => { selected = provider; } } }, config);
	assert.equal(selected.available(), true);
});

test("Firecrawl sends array sources and caps an overlong response", async () => {
	let requestBody;
	const { RestSearchProvider } = await loadModule("lib/rest.js", async (_url, init) => {
		requestBody = JSON.parse(init.body);
		return {
			ok: true,
			headers: new Headers(),
			json: async () => ({ data: { web: [
				{ url: "https://a.test" },
				{ url: "https://b.test" },
				{ url: "https://c.test" }
			] } })
		};
	});
	const { REST_PROVIDERS } = await loadModule("lib/providers.js", () => {});
	const row = REST_PROVIDERS.find(({ id }) => id === "firecrawl");
	const provider = new RestSearchProvider("firecrawl", () => ({
		...row,
		apiKey: "test-key",
		maxResults: 2
	}));
	const result = await provider.search({ query: "test" });
	assert.deepEqual(Array.from(requestBody.sources), ["web"]);
	assert.equal(requestBody.limit, 2);
	assert.equal(result.sources.length, 2);
	assert.equal(result.truncated, true);
});

test("empty countParam does not add a count field", async () => {
	let requestBody;
	const { RestSearchProvider } = await loadModule("lib/rest.js", async (_url, init) => {
		requestBody = JSON.parse(init.body);
		return { ok: true, headers: new Headers(), json: async () => ({ organic: [] }) };
	});
	const { REST_PROVIDERS } = await loadModule("lib/providers.js", () => {});
	const row = REST_PROVIDERS.find(({ id }) => id === "scavio");
	const provider = new RestSearchProvider("scavio", () => ({ ...row, apiKey: "test-key", maxResults: 2 }));
	await provider.search({ query: "test" });
	assert.equal(Object.hasOwn(requestBody, "max_results"), false);
});

test("Exa sends documented request fields and honors the configured result cap", async () => {
	let requestBody;
	const { RestSearchProvider } = await loadModule("lib/rest.js", async (_url, init) => {
		requestBody = JSON.parse(init.body);
		return { ok: true, headers: new Headers(), json: async () => ({ results: [
			{ url: "https://a.test", highlights: ["First"] },
			{ url: "https://b.test", highlights: ["Second"] },
			{ url: "https://c.test", highlights: ["Third"] }
		] }) };
	});
	const { REST_PROVIDERS } = await loadModule("lib/providers.js", () => {});
	const row = REST_PROVIDERS.find(({ id }) => id === "exa");
	const provider = new RestSearchProvider("exa", () => ({ ...row, apiKey: "test-key", maxResults: 2 }));
	const result = await provider.search({ query: "test", maxResults: 8 });
	assert.equal(requestBody.numResults, 2);
	assert.deepEqual(requestBody.contents, { highlights: true });
	assert.equal(Object.hasOwn(requestBody, "num_results"), false);
	assert.equal(result.sources.length, 2);
	assert.equal(result.truncated, true);
});

test("SearXNG omits an unsupported count parameter and caps locally", async () => {
	let endpoint;
	const { RestSearchProvider } = await loadModule("lib/rest.js", async (url) => {
		endpoint = new URL(url);
		return { ok: true, headers: new Headers(), json: async () => ({ results: [
			{ url: "https://a.test" }, { url: "https://b.test" }
		] }) };
	});
	const { REST_PROVIDERS } = await loadModule("lib/providers.js", () => {});
	const row = REST_PROVIDERS.find(({ id }) => id === "searxng");
	const provider = new RestSearchProvider("searxng", () => ({ ...row, maxResults: 1 }));
	const result = await provider.search({ query: "test", maxResults: 8 });
	assert.equal(endpoint.searchParams.get("format"), "json");
	assert.equal(endpoint.searchParams.has("count"), false);
	assert.equal(result.sources.length, 1);
	assert.equal(result.truncated, true);
});

test("DeepSeek honors configured maxResults", async () => {
	const { DeepSeekSearchProvider } = await loadModule("lib/deepseek.js", async () => ({
		ok: true,
		json: async () => ({ content: [{
			type: "web_search_tool_result",
			content: [
				{ type: "web_search_result", url: "https://a.test" },
				{ type: "web_search_result", url: "https://b.test" }
			]
		}] })
	}));
	const provider = new DeepSeekSearchProvider(() => ({
		apiKey: "test-key",
		baseURL: "https://example.test/anthropic/v1",
		model: "test-model",
		apiVersion: "2023-06-01",
		maxTokens: 100,
		maxUses: 1,
		maxResults: 1
	}));
	const result = await provider.search({ query: "test", maxResults: 8 });
	assert.equal(result.sources.length, 1);
	assert.equal(result.truncated, true);
});

test("blank endpoint configuration uses launch environment before the built-in URL", async () => {
	const environment = { TAVILY_BASE_URL: "https://tavily.test", DEEPSEEK_SEARCH_BASE_URL: "https://deepseek.test" };
	const { resolveTavilyOptions } = await loadModule("lib/tavily.js", () => {}, environment);
	const { resolveDeepseekOptions } = await loadModule("lib/deepseek.js", () => {}, environment);
	const ctx = { get: () => undefined };
	assert.equal(resolveTavilyOptions(ctx, { baseURL: "" }).baseURL, environment.TAVILY_BASE_URL);
	assert.equal(resolveDeepseekOptions(ctx, { deepseekBaseURL: "" }).baseURL, environment.DEEPSEEK_SEARCH_BASE_URL);
	assert.equal(resolveTavilyOptions(ctx, { baseURL: "https://custom.test" }).baseURL, "https://custom.test");
});

test("DeepSeek account token preflight maps failures and responds to cancellation", async () => {
	let dispatched = false;
	const { DeepSeekSearchProvider } = await loadModule("lib/deepseek.js", async () => { dispatched = true; });
	const base = { baseURL: "https://example.test", apiKey: "test-key" };
	const failed = new DeepSeekSearchProvider(() => ({ ...base, resolveAccountToken: async () => { throw new Error("token unavailable"); } }));
	await assert.rejects(failed.search({ query: "test" }), (error) => error.code === "WEB_PROVIDER_ERROR");
	const controller = new AbortController();
	const pending = new DeepSeekSearchProvider(() => ({ ...base, resolveAccountToken: () => new Promise(() => {}) }));
	const search = pending.search({ query: "test" }, controller.signal);
	controller.abort();
	await assert.rejects(search, (error) => error.code === "WEB_ABORTED");
	assert.equal(dispatched, false);
});

test("manual Tavily refresh is limited to one upstream request per ten seconds", async () => {
	let requests = 0;
	let now = 100_000;
	const { UsageTracker } = await loadModule("lib/usage.js", async () => {
		requests++;
		return { ok: true, json: async () => ({ account: { current_plan: "free", plan_limit: 100, plan_usage: 2 } }) };
	}, {}, () => now);
	const usage = new UsageTracker({ getTavilyOptions: () => ({ mode: "keyed", baseURL: "https://tavily.test", apiKey: "test-key" }) });
	await usage.refreshTavily(undefined, true);
	await usage.refreshTavily(undefined, true);
	assert.equal(requests, 1);
	now += 9_999;
	await usage.refreshTavily(undefined, true);
	assert.equal(requests, 1);
	now += 1;
	await usage.refreshTavily(undefined, true);
	assert.equal(requests, 2);
});

test("Tavily account changes replace prior usage and bypass the prior manual interval", async () => {
	let now = 100_000;
	let key = "first-key";
	const requests = [];
	const { UsageTracker } = await loadModule("lib/usage.js", async (_url, init) => {
		requests.push(init.headers.authorization);
		const used = init.headers.authorization === "Bearer first-key" ? 40 : 3;
		return { ok: true, json: async () => ({ account: { current_plan: "free", plan_limit: 100, plan_usage: used } }) };
	}, {}, () => now);
	const usage = new UsageTracker({ getTavilyOptions: () => ({ mode: "keyed", baseURL: "https://tavily.test", apiKey: key }) });
	await usage.refreshTavily(undefined, true);
	assert.equal(usage.snapshot().tavily.used, 40);
	key = "second-key";
	await usage.refreshTavily();
	assert.deepEqual(requests, ["Bearer first-key", "Bearer second-key"]);
	assert.equal(usage.snapshot().tavily.used, 3);
	await usage.recordTavilyCredits(2, "second-key");
	assert.equal(usage.snapshot().tavily.used, 5);
	await usage.recordTavilyCredits(8, "first-key");
	assert.equal(usage.snapshot().tavily.used, 5);
});

test("Tavily ignores persisted usage and an old account's late response", async () => {
	let key = "first-key";
	let releaseOld;
	let oldStarted;
	const started = new Promise((resolve) => { oldStarted = resolve; });
	const { UsageTracker } = await loadModule("lib/usage.js", async (_url, init) => {
		if (init.headers.authorization === "Bearer first-key") {
			oldStarted();
			return { ok: true, json: () => new Promise((resolve) => { releaseOld = resolve; }) };
		}
		return { ok: true, json: async () => ({ account: { current_plan: "free", plan_limit: 100, plan_usage: 3 } }) };
	}, {}, () => 100_000, {
		"node:fs/promises": { mkdir: async () => {}, readFile: async () => JSON.stringify({ tavily: { used: 80, localUsed: 80 }, brave: {} }), writeFile: async () => {} }
	});
	const usage = new UsageTracker({ getTavilyOptions: () => ({ mode: "keyed", baseURL: "https://tavily.test", apiKey: key }) });
	await usage.hydrate();
	assert.equal(usage.snapshot().tavily.used, 0);
	const oldRefresh = usage.refreshTavily();
	await started;
	key = "second-key";
	await usage.refreshTavily();
	assert.equal(usage.snapshot().tavily.used, 3);
	releaseOld({ account: { current_plan: "free", plan_limit: 100, plan_usage: 80 } });
	await oldRefresh;
	assert.equal(usage.snapshot().tavily.used, 3);
});
