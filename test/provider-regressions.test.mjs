import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { REST_PROVIDERS } from "../lib/providers.js";
import { SUPPLIER_CONFIG_ALIASES, resolveSupplierConfig } from "../lib/config.js";

const root = new URL("../", import.meta.url);

test("prefixed fields preserve legacy values and respect explicit empty/false overrides", () => {
	const old = { apiKey: "old-key", baseURL: "https://old.test", includeAnswer: true, country: "us", maxTokens: 100 };
	const legacy = resolveSupplierConfig(old);
	assert.equal(legacy.tavilyApiKey, "old-key");
	assert.equal(legacy.tavilyBaseURL, "https://old.test");
	assert.equal(legacy.deepseekMaxTokens, 100);
	assert.equal(legacy.braveCountry, "us");
	assert.equal(legacy.scavioCountry, "us");
	const current = resolveSupplierConfig({ ...old, tavilyApiKey: "", tavilyIncludeAnswer: false, braveCountry: "gb", scavioCountry: "cn" });
	assert.equal(current.tavilyApiKey, "");
	assert.equal(current.tavilyIncludeAnswer, false);
	assert.equal(current.braveCountry, "gb");
	assert.equal(current.scavioCountry, "cn");
});

async function loadModule(file, fetchImpl, environment = {}, now = () => Date.now(), extraMocks = {}, processEnvironment = {}) {
	class WebError extends Error {
		constructor(message, code, options) { super(message, options); this.code = code; }
	}
	const context = vm.createContext({
		URL,
		URLSearchParams,
		fetch: fetchImpl,
		Date: class extends Date { static now() { return now(); } },
		process: { env: processEnvironment },
		setTimeout: () => 1
	});
	const shared = {
		apiKeyReady: async (options) => (options.apiKey?.length ?? 0) > 0 || await options.apiKeyReady?.() === true,
		MAX_RESULTS_CAP: 20,
		USER_AGENT: "test",
		abortable: (operation, signal) => signal === undefined ? operation : new Promise((resolve, reject) => {
			if (signal.aborted) return reject(new WebError("Search aborted", "WEB_ABORTED"));
			const onAbort = () => reject(new WebError("Search aborted", "WEB_ABORTED"));
			signal.addEventListener("abort", onAbort, { once: true });
			operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
		}),
		isAbortError: () => false,
		isPositiveInteger: (value) => Number.isInteger(value) && value > 0,
		resolveApiKey: async (options) => options.apiKey,
		resolveSecret: () => ({}),
		searchAborted: () => new WebError("Search aborted", "WEB_ABORTED"),
		throwIfSearchAborted: (signal) => { if (signal?.aborted) throw new WebError("Search aborted", "WEB_ABORTED"); }
	};
	const mocks = {
		"@deepseek-ai/dsh-credentials": { credentialRef: (name) => name },
		"./config.js": { SUPPLIER_CONFIG_ALIASES, resolveSupplierConfig },
		"@deepseek-ai/dsh-web": { WebError },
		"@deepseek-ai/dsh-launch-environment": { launchEnvironmentOf: () => ({ get: (key) => environment[key] === undefined ? undefined : { value: environment[key] } }) },
		"undici": { ProxyAgent: class ProxyAgent {} },
		"node:os": { homedir: () => "/tmp" },
		"node:crypto": { createHash },
		"node:path": { dirname: () => "/tmp", join: (...parts) => parts.join("/") },
		"node:fs/promises": { mkdir: async () => {}, readFile: async () => "{}", writeFile: async () => {} },
		"./usage.js": { parseTavilySearchCredits: () => null },
		"./shared.js": shared,
		...extraMocks,
		"./shared.js": { ...shared, ...extraMocks["./shared.js"] }
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
		"./deepseek.js": { DEEPSEEK_DEFAULT_API_KEY_ENV: "DEEPSEEK_API_KEY", DEEPSEEK_DEFAULT_BASE_URL: "https://deepseek.test", DeepSeekSearchProvider: class { available() { return true; } ready(route) { return route === "deepseek-account"; } }, resolveDeepseekOptions: () => ({}) },
		"./usage.js": { TAVILY_USAGE_POLL_MS: 600_000, UsageTracker: class {} },
		"./rest.js": { RestSearchProvider: class {}, resolveRestProvider: unused },
		"./providers.js": { BUILTIN_REST_IDS: ["tavily", "serper"], REST_PROVIDERS: [], findProvider: unused }
	});
	const values = { provider: "deepseek-official", serperApiKeyEnv: "BAD-KEY" };
	const config = new Proxy({}, { get: (_target, fieldName) => ({ get: () => values[fieldName] }) });
	let selected;
	apply({ effect: () => {}, inject: () => {}, web: { registerSearchProvider: (provider) => { selected = provider; } } }, config);
	assert.equal(selected.available(), true);
	assert.equal(await selected.ready("deepseek-account"), true);
	assert.equal(await selected.ready("other"), false);
});

test("supplier option resolvers prefer prefixed fields over legacy configuration", async () => {
	const secretMock = { resolveSecret: (_ctx, source) => ({ apiKey: source.literal, apiKeyEnv: source.envName }) };
	const extra = { "./shared.js": secretMock };
	const ctx = { get: () => undefined };
	const { resolveTavilyOptions } = await loadModule("lib/tavily.js", () => {}, { TAVILY_BASE_URL: "https://env.test" }, undefined, extra);
	const tavily = resolveTavilyOptions(ctx, { apiKey: "old", tavilyApiKey: "", baseURL: "https://old.test", tavilyBaseURL: "", mode: "keyless", tavilyMode: "keyed", tavilyIncludeAnswer: false, includeAnswer: true });
	assert.equal(tavily.apiKey, "");
	assert.equal(tavily.baseURL, "https://env.test");
	assert.equal(tavily.mode, "keyed");
	assert.equal(tavily.includeAnswer, false);
	const { resolveDeepseekOptions } = await loadModule("lib/deepseek.js", () => {}, {}, undefined, extra);
	const deepseek = resolveDeepseekOptions(ctx, { model: "old", deepseekModel: "new", apiVersion: "old-version", deepseekApiVersion: "new-version", maxTokens: 100, deepseekMaxTokens: 200, maxUses: 1, deepseekMaxUses: 2 });
	assert.equal(deepseek.model, "new");
	assert.equal(deepseek.apiVersion, "new-version");
	assert.equal(deepseek.maxTokens, 200);
	assert.equal(deepseek.maxUses, 2);
	const { resolveBraveOptions } = await loadModule("lib/brave.js", () => {}, {}, undefined, extra);
	const brave = resolveBraveOptions(ctx, { country: "us", braveCountry: "cn", searchLang: "en", braveSearchLang: "zh-hans", proxy: "http://old.test", braveProxy: "" });
	assert.equal(brave.country, "cn");
	assert.equal(brave.searchLang, "zh-hans");
	assert.equal(brave.proxy, "");
});

test("Host dispatch uses isolated prefixed Brave and Scavio settings", async () => {
	const schemaField = { default() { return this; }, volatile() { return this; }, role() { return this; }, step() { return this; }, min() { return this; }, max() { return this; } };
	const schema = { object: () => ({}), string: () => schemaField, number: () => schemaField, boolean: () => schemaField };
	const providers = await loadModule("lib/providers.js", () => {});
	const { resolveRestProvider } = await loadModule("lib/rest.js", () => {});
	const { apply } = await loadModule("lib/index.js", () => {}, {}, undefined, {
		"@deepseek-ai/schemastery": { default: schema },
		"./tavily.js": { TAVILY_DEFAULT_API_KEY_ENV: "TAVILY_API_KEY", TAVILY_DEFAULT_BASE_URL: "https://api.tavily.com", TavilySearchProvider: class {}, resolveTavilyOptions: () => ({}) },
		"./brave.js": { BRAVE_DEFAULT_API_KEY_ENV: "BRAVE_API_KEY", BRAVE_DEFAULT_BASE_URL: "https://brave.test", BraveSearchProvider: class {}, resolveBraveOptions: () => ({}) },
		"./deepseek.js": { DEEPSEEK_DEFAULT_API_KEY_ENV: "DEEPSEEK_API_KEY", DEEPSEEK_DEFAULT_BASE_URL: "https://deepseek.test", DeepSeekSearchProvider: class {}, resolveDeepseekOptions: () => ({}) },
		"./usage.js": { TAVILY_USAGE_POLL_MS: 600_000, UsageTracker: class {} },
		"./rest.js": { resolveRestProvider, RestSearchProvider: class { constructor(_id, resolve) { this.resolve = resolve; } search() { return this.resolve(); } } },
		"./providers.js": { BUILTIN_REST_IDS: ["brave", "scavio"], REST_PROVIDERS: providers.REST_PROVIDERS, findProvider: providers.findProvider }
	});
	const values = { provider: "brave", country: "us", searchLang: "en", braveCountry: "gb", braveSearchLang: "en-gb", scavioCountry: "cn", scavioSearchLang: "zh-CN" };
	const config = new Proxy({}, { get: (_target, field) => ({ get: () => values[field] }) });
	let selected;
	apply({ effect: () => {}, inject: () => {}, web: { registerSearchProvider: (provider) => { selected = provider; } } }, config);
	const brave = await selected.search({ query: "test" });
	assert.equal(brave.settings.country, "gb");
	assert.equal(brave.settings.searchLang, "en-gb");
	values.provider = "scavio";
	const scavio = await selected.search({ query: "test" });
	assert.equal(scavio.settings.country, "cn");
	assert.equal(scavio.settings.searchLang, "zh-CN");
	delete values.scavioCountry;
	assert.equal((await selected.search({ query: "test" })).settings.country, "us");
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

async function readinessModules(environment = {}, processEnvironment = {}) {
	const noNetwork = () => { throw new Error("readiness must not contact an endpoint"); };
	const shared = await loadModule("lib/shared.js", noNetwork, environment, undefined, {}, processEnvironment);
	const extra = { "./shared.js": shared };
	const rest = await loadModule("lib/rest.js", noNetwork, environment, undefined, extra);
	const deepseek = await loadModule("lib/deepseek.js", noNetwork, environment, undefined, extra);
	return { ...shared, ...rest, ...deepseek };
}

test("readiness inspects credential presence without resolving stored secrets or caching it", async () => {
	const { resolveSecret, apiKeyReady } = await readinessModules();
	let configured = false;
	let descriptions = 0;
	const credentials = {
		describe: async (ref) => { assert.equal(ref, "TEST_KEY"); descriptions++; return { configured }; },
		resolve: () => { throw new Error("readiness read a secret"); }
	};
	const ctx = { get: (name) => name === "credentials" ? credentials : undefined };
	const options = resolveSecret(ctx, { envName: "TEST_KEY" });
	assert.equal(await apiKeyReady(options), false);
	configured = true;
	assert.equal(await apiKeyReady(options), true);
	configured = false;
	assert.equal(await apiKeyReady(options), false);
	assert.equal(descriptions, 3);
	assert.equal(await apiKeyReady(resolveSecret(ctx, { envName: "TEST_KEY", literal: "literal" })), true);
	assert.equal(descriptions, 3, "a literal key takes priority over an unreadable credential store");
});

test("readiness follows launch/process fallbacks and treats unreadable stores as unavailable", async () => {
	const env = { LAUNCH_KEY: "launch-value", EMPTY_KEY: "" };
	const processEnv = { PROCESS_KEY: "process-value" };
	const { resolveSecret, apiKeyReady } = await readinessModules(env, processEnv);
	for (const credentials of [undefined, { describe: async () => ({ configured: false }) }]) {
		const ctx = { get: () => credentials };
		for (const [ref, expected] of [["LAUNCH_KEY", true], ["PROCESS_KEY", true], ["EMPTY_KEY", false], ["ABSENT_KEY", false]]) {
			assert.equal(await apiKeyReady(resolveSecret(ctx, { envName: ref })), expected, ref);
		}
	}
	const broken = { get: () => ({ describe: async () => { throw new Error("unreadable store"); } }) };
	assert.equal(await apiKeyReady(resolveSecret(broken, { envName: "LAUNCH_KEY" })), false);
	assert.equal(await apiKeyReady({ resolveApiKey: async () => "direct-provider-key" }), true);
	assert.equal(await apiKeyReady({ resolveApiKey: async () => { throw new Error("unreadable"); } }), false);
});

test("all REST engines gate keyed modes and preserve Tavily keyless and SearXNG", async () => {
	const { RestSearchProvider, resolveRestProvider } = await readinessModules();
	let configured = false;
	let descriptions = 0;
	const ctx = { get: () => ({ describe: async () => { descriptions++; return { configured }; } }) };
	for (const row of REST_PROVIDERS) {
		const keyedModes = row.id === "tavily" ? [false, true] : [false];
		for (const keyed of keyedModes) {
			const provider = new RestSearchProvider(row.id, () => resolveRestProvider(ctx, row, { config: {}, settings: {}, keyed }));
			configured = false;
			const anonymous = row.id === "searxng" || (row.id === "tavily" && !keyed);
			const before = descriptions;
			assert.equal(await provider.ready(), anonymous, `${row.id}, keyed=${keyed}`);
			if (anonymous) assert.equal(descriptions, before, "keyless engines must not inspect unrelated credentials");
			configured = true;
			assert.equal(await provider.ready(), true, row.id);
		}
	}
});

test("DeepSeek readiness uses the pending account route and the exact search endpoint", async () => {
	const { DeepSeekSearchProvider, resolveDeepseekOptions } = await readinessModules();
	let token;
	let keyConfigured = false;
	let accountReads = 0;
	let accountError = false;
	let keyError = false;
	let previousRoute = "deepseek-account";
	const ctx = { get: (name) => ({
		agents: { currentInitiator: () => ({ session: { requestContext: () => ({ provider: previousRoute }) } }) },
		deepseekAccount: { resolveToken: async (endpoint) => {
			accountReads++;
			assert.equal(endpoint, "https://trusted.test/anthropic/v1/messages");
			if (accountError) throw new Error("unreadable grant");
			return token;
		} },
		credentials: { describe: async () => { if (keyError) throw new Error("unreadable key"); return { configured: keyConfigured }; } }
	})[name] };
	let config = { deepseekBaseURL: "https://trusted.test/anthropic/v1/", deepseekApiKeyEnv: "TEST_KEY" };
	const provider = new DeepSeekSearchProvider(() => resolveDeepseekOptions(ctx, config));
	token = "account-token";
	assert.equal(await provider.ready("other"), false);
	assert.equal(await provider.ready(undefined), false);
	assert.equal(accountReads, 0, "a previous account request must not authorize another route");
	previousRoute = "other";
	assert.equal(await provider.ready("deepseek-account"), true, "the pending route can use its account without a previous account request");
	token = undefined;
	assert.equal(await provider.ready("deepseek-account"), false);
	keyConfigured = true;
	assert.equal(await provider.ready("deepseek-account"), true, "an absent account grant falls back to a key");
	assert.equal(await provider.ready("other"), true);
	accountError = true;
	config = { ...config, deepseekApiKey: "literal-key" };
	assert.equal(await provider.ready("deepseek-account"), false, "a failed account read cannot be bypassed with a key");
	assert.equal(await provider.ready("other"), true);
	accountError = false;
	keyError = true;
	config = { ...config, deepseekApiKey: "" };
	assert.equal(await provider.ready("other"), false);
	token = "account-token";
	assert.equal(await provider.ready("deepseek-account"), true, "an account token does not require reading the API key store");
});
