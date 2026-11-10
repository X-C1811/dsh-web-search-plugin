/** Run against a private, disposable fixture containing an installed plugin and Host dependencies.
 * Usage: node test/host-compatibility.mjs <fixture-directory>
 * HTTP and credential services are fakes; Cordis, WebRuntime and the packed plugin are real.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.ok(process.argv[2], "provide a disposable fixture directory");
const directory = resolve(process.argv[2]);
const packageFile = resolve(directory, "package.json");
assert.equal(JSON.parse(readFileSync(packageFile, "utf8")).private, true, "fixture must be private");
const require = createRequire(packageFile);
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
process.env.DSH_HOME = resolve(directory, "isolated-dsh-home");
const { Context } = await load("@deepseek-ai/cordis");
const { WebRuntime } = await load("@deepseek-ai/dsh-web");
const plugin = await load("dsh-web-search-plugin");
const ctx = new Context();
const keyRef = "DSH_COMPAT_TEST_UNUSED_KEY";
const priorKey = process.env[keyRef];
delete process.env[keyRef];
const credentials = new Map();
let descriptions = 0;
let resolutions = 0;
let previousRoute = "deepseek-account";
let accountToken;
const requests = [];
const passed = [];
const originalFetch = globalThis.fetch;
const installed = (name) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
const result = { node: process.version, versions: Object.fromEntries([
	"@deepseek-ai/dsh-web", "@deepseek-ai/cordis", "@deepseek-ai/schemastery"
].map((name) => [name, installed(name)])), passed };
const originalHeader = (headers, name) => new Headers(headers).get(name);
ctx.provide("credentials", {
	describe: async (ref) => { descriptions++; return { configured: credentials.has(ref) }; },
	resolve: async (ref) => { resolutions++; return credentials.has(ref) ? { value: credentials.get(ref) } : undefined; }
});
ctx.provide("agents", { currentInitiator: () => ({ session: {
	requestContext: () => ({ provider: previousRoute }), append: () => {}
} }) });
ctx.provide("deepseekAccount", { resolveToken: async (endpoint) => {
	assert.equal(endpoint, "https://compat.invalid/messages");
	return accountToken;
} });
const routes = new Map();
ctx.provide("webServer", { register: (route) => {
	routes.set(route.path, route);
	return () => routes.delete(route.path);
} });
globalThis.fetch = async (input, init) => {
	const url = String(input);
	assert.ok(url.startsWith("https://compat.invalid/"), "unexpected external request");
	requests.push({ url, init });
	const sources = [1, 2, 3].map((n) => ({ url: `https://source.test/${n}`, title: `source${n}`, content: `snippet${n}` }));
	const body = url.endsWith("/messages")
		? { content: [{ type: "web_search_tool_result", content: sources.map((x) => ({ ...x, type: "web_search_result" })) }] }
		: url.includes("/search?") || originalHeader(init?.headers, "x-tavily-access-mode") === "keyless"
			? { results: sources }
			: { organic: sources.map((x) => ({ link: x.url, title: x.title, snippet: x.content })) };
	return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
let webFiber, pluginFiber;
try {
	webFiber = await ctx.plugin(WebRuntime, { searchProvider: "dsh-web-search", fetchProvider: "http" });
	pluginFiber = await ctx.plugin(plugin, { provider: "serper", serperApiKey: "fixture-key", serperBaseURL: "https://compat.invalid", maxResults: 2 });
	assert.equal(pluginFiber.state, 2);
	passed.push("packed plugin import, schema validation, activation and provider registration");
	assert.ok(routes.has("/dsh-web-search/usage"));
	passed.push("usage route registration with the Host web server seam");
	const response = await ctx.web.search({ query: "compatibility", maxResults: 2 });
	assert.equal(response.sources.length, 2);
	assert.equal(response.sources[0].snippet, "snippet1");
	passed.push("search request/response and result cap through real WebRuntime");
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(ctx.web.search({ query: "aborted" }, aborted.signal), (e) => e.code === "WEB_ABORTED");
	passed.push("caller cancellation preserves WEB_ABORTED");
	async function update(config) { pluginFiber.update(config); await pluginFiber.await(); }
	await update({ provider: "serper", serperApiKeyEnv: keyRef, serperBaseURL: "https://compat.invalid" });
	if (typeof ctx.web.searchReady === "function") {
		assert.equal(await ctx.web.searchReady("other"), false);
		assert.equal(resolutions, 0, "readiness must not resolve API key plaintext");
		credentials.set(keyRef, "fixture-stored-key");
		assert.equal(await ctx.web.searchReady("other"), true);
		assert.equal(resolutions, 0);
		await ctx.web.search({ query: "credential changed" });
		assert.equal(originalHeader(requests.at(-1).init.headers, "x-api-key"), "fixture-stored-key");
		credentials.delete(keyRef);
		assert.equal(await ctx.web.searchReady("other"), false);
		passed.push("live credential additions/removals gate readiness without resolving secrets");
	}
	await assert.rejects(ctx.web.search({ query: "missing key" }), (e) => e.code === "WEB_PROVIDER_CREDENTIAL_MISSING");
	for (const config of [
		{ provider: "tavily", tavilyMode: "keyless", tavilyApiKeyEnv: keyRef, tavilyBaseURL: "https://compat.invalid" },
		{ provider: "searxng", searxngBaseURL: "https://compat.invalid" }
	]) {
		await update(config);
		const before = descriptions;
		if (typeof ctx.web.searchReady === "function") assert.equal(await ctx.web.searchReady("other"), true);
		assert.equal(descriptions, before);
		assert.equal((await ctx.web.search({ query: "keyless", maxResults: 1 })).sources.length, 1);
	}
	passed.push("configuration switching, Tavily keyless and SearXNG without credentials");
	await update({ provider: "deepseek-official", deepseekBaseURL: "https://compat.invalid", deepseekApiKeyEnv: keyRef });
	if (typeof ctx.web.searchReady === "function") {
		accountToken = "fixture-account-token";
		assert.equal(await ctx.web.searchReady("other"), false);
		previousRoute = "other";
		assert.equal(await ctx.web.searchReady("deepseek-account"), true);
		previousRoute = "deepseek-account";
		assert.equal((await ctx.web.search({ query: "account search" })).sources.length, 3);
		assert.equal(originalHeader(requests.at(-1).init.headers, "x-dsh-auth-token"), "fixture-account-token");
		accountToken = undefined;
		assert.equal(await ctx.web.searchReady("deepseek-account"), false);
		passed.push("DeepSeek account readiness uses the pending route and real dispatch uses its account header");
	}
} finally {
	if (pluginFiber) await pluginFiber.dispose();
	if (webFiber) await webFiber.dispose();
	globalThis.fetch = originalFetch;
	if (priorKey === undefined) delete process.env[keyRef]; else process.env[keyRef] = priorKey;
}
assert.equal(routes.size, 0);
passed.push("plugin, route and WebRuntime disposal");
console.log(JSON.stringify(result, null, 2));
