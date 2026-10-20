import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function setupClient(options = {}) {
	let bundle;
	const draft = new Map();
	const sandbox = {
		window: { __ModuleLoader__: { load: (value) => { bundle = value; } } },
		sessionStorage: {
			getItem: (key) => draft.get(key) ?? null,
			setItem: (key, value) => draft.set(key, value),
			removeItem: (key) => draft.delete(key)
		},
		fetch: async () => ({ json: async () => ({}) }),
		setInterval: () => 1,
		clearInterval: () => {},
		setTimeout: () => 1,
		clearTimeout: () => {}
	};
	vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), sandbox);
	const react = {
		createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length ? children : props?.children } }),
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
	};
	const store = {
		createSnapshotStore(initial) {
			let current = initial;
			return {
				set: (next) => { current = next; },
				getSnapshot: () => current,
				subscribe: () => () => {}
			};
		}
	};
	const { apply } = bundle.factory((name) => {
		if (name === "react") return react;
		if (name === "@deepseek-ai/dsh-client-store") return store;
		throw new Error(`unexpected require: ${name}`);
	});
	const registrations = new Set();
	const values = { provider: options.provider ?? "deepseek-official", deepseekApiKeyEnv: "DEEPSEEK_API_KEY", serperApiKeyEnv: "SERPER_API_KEY", maxResults: 8, ...options.values };
	const mutations = [];
	const scope = {
		getSnapshot: () => ({
			status: "ready",
			writable: true,
			value: values,
			base: options.base ?? {},
			user: options.user ?? {},
			revision: options.revision ?? 1
		}),
		subscribe: () => () => {},
		mutate: async (ops, revision) => {
			mutations.push({ ops, revision });
			if (options.mutate) return options.mutate(ops, revision);
			for (const op of ops) {
				if (op.op === "set") values[op.path[0]] = op.value;
				else delete values[op.path[0]];
			}
			return true;
		}
	};
	const writes = [];
	const external = (ns, initial) => {
		const spec = options.scopes?.[ns] ?? {};
		const current = { ...initial, ...spec.value };
		const user = { ...spec.user };
		let revision = spec.revision ?? 7;
		const listeners = new Set();
		return {
			value: current, user,
			getSnapshot: () => ({ status: spec.status ?? "ready", writable: spec.writable ?? true, value: current, user, base: spec.base ?? initial, revision }),
			subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
			async mutate(ops, expected) {
				writes.push({ ns, ops, revision: expected });
				if (spec.mutate && await spec.mutate(ops, expected) !== true) return false;
				assert.equal(expected, revision);
				for (const op of ops) {
					if (op.op === "set") { current[op.path[0]] = op.value; user[op.path[0]] = op.value; }
					else { delete user[op.path[0]]; current[op.path[0]] = (spec.base ?? initial)[op.path[0]]; }
				}
				revision++;
				listeners.forEach(listener => listener());
				return true;
			}
		};
	};
	const web = external("web", { searchProvider: "dsh-web-search", fetchProvider: "http" });
	const api = external("web-deepseek-api", { apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1/tools", count: 10 });
	let serve;
	const context = {
		effect: (start) => start(),
		locale: { bind: () => (key) => key, register: () => () => {} },
		configForms: {
			get: ns => ns === "web" ? web : ns === "web-deepseek-api" ? api : scope,
			whileServed: (_namespaces, register) => { serve = register; return () => {}; }
		},
		remote: {
			$on: () => () => {},
			credentials: {
				describe: async () => ({ ok: true, value: { DEEPSEEK_API_KEY: { configured: true, writable: true } } }),
				set: options.credentialSet ?? (async () => { throw new Error("write rejected"); })
			}
		},
		slots: {
			inject: (_name, register) => {
				register();
				return { dispose: async () => {} };
			},
			register: (_options, component) => {
				registrations.add(component);
				return () => registrations.delete(component);
			}
		}
	};
	apply(context);
	return { registrations, serve, mutations, values, web, api, writes, draft };
}

function flatten(node) {
	if (node == null || node === false) return [];
	if (Array.isArray(node)) return node.flatMap(flatten);
	if (typeof node !== "object") return [node];
	if (typeof node.type === "function") return flatten(node.type(node.props));
	return [node, ...flatten(node.props?.children)];
}

function card(options = {}) {
	const env = setupClient(options);
	const stop = env.serve();
	const section = [...env.registrations][0];
	const nodes = () => flatten(section({}));
	const edit = (id, value) => nodes().find(node => node.props?.id === id).props.onChange({ target: { value } });
	const save = async () => {
		nodes().find(node => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
		await new Promise(setImmediate);
	};
	return { ...env, nodes, edit, save, stop };
}

test("Search API selection uses official namespace and leaves HTTP fetch and Messages configuration intact", async () => {
	const c = card({ values: { deepseekBaseURL: "https://messages.test/anthropic/v1", deepseekModel: "legacy" } });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-api-base", "https://search.test/v1/tools");
	c.edit("ws-api-count", "6");
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.equal(c.nodes().filter(node => node.props?.id === "ws-api-key").length, 1);
	await c.save();
	assert.equal(c.web.value.searchProvider, "deepseek-search-api");
	assert.equal(c.web.value.fetchProvider, "http");
	assert.equal(c.api.value.baseURL, "https://search.test/v1/tools");
	assert.equal(c.api.value.count, 6);
	assert.equal(c.values.deepseekBaseURL, "https://messages.test/anthropic/v1");
	assert.equal(c.values.deepseekModel, "legacy");
	assert.deepEqual(c.writes.map(write => write.ns), ["web-deepseek-api", "web"]);
	assert.equal(c.nodes().find(node => node.props?.id === "ws-provider").props.value, "deepseek-search-api");
	c.stop();
});

test("Fetch API can be combined with Serper; returning to HTTP preserves Search API and its shared configuration", async () => {
	const c = card({ provider: "serper" });
	c.edit("ws-fetch-provider", "deepseek-fetch-api");
	c.edit("ws-api-base", "https://fetch.test/api/v1/tools");
	await c.save();
	assert.equal(c.values.provider, "serper");
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.equal(c.web.value.fetchProvider, "deepseek-fetch-api");
	c.edit("ws-provider", "deepseek-search-api");
	assert.equal(c.nodes().filter(node => node.props?.id === "ws-api-key").length, 1);
	assert.ok(c.nodes().includes("apiShared"));
	await c.save();
	c.edit("ws-fetch-provider", "http");
	await c.save();
	assert.equal(c.web.value.searchProvider, "deepseek-search-api");
	assert.equal(c.web.value.fetchProvider, "http");
	assert.equal(c.api.value.baseURL, "https://fetch.test/api/v1/tools");
	c.edit("ws-provider", "serper");
	await c.save();
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.equal(c.values.provider, "serper");
	c.stop();
});

test("API key uses the staged reference, clears only the official literal and never persists a secret draft", async () => {
	const credentials = [];
	const c = card({ provider: "serper", values: { deepseekApiKey: "old-messages-key" },
		scopes: { "web-deepseek-api": { value: { apiKey: "old-api-literal" } } },
		credentialSet: async (ref, value) => { credentials.push({ ref, value }); return { ok: true }; }
	});
	c.edit("ws-fetch-provider", "deepseek-fetch-api");
	c.edit("ws-api-keyref", "NEW_API_KEY");
	c.edit("ws-api-key", "secret-api-value");
	assert.equal(JSON.stringify([...c.draft.values()]).includes("secret-api-value"), false);
	await c.save();
	assert.deepEqual(credentials, [{ ref: "NEW_API_KEY", value: "secret-api-value" }]);
	assert.equal(c.api.value.apiKey, "");
	assert.equal(c.api.value.apiKeyEnv, "NEW_API_KEY");
	assert.equal(c.values.deepseekApiKey, "old-messages-key");
	c.stop();
});

test("refused API configuration never switches providers and retains the draft for retry", async () => {
	let allow = false;
	const c = card({ scopes: { "web-deepseek-api": { mutate: async () => allow } } });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-api-base", "https://retry.test/v1/tools");
	await c.save();
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.ok(c.nodes().includes("partialFailed"));
	assert.equal(c.nodes().find(node => node.props?.id === "ws-api-base").props.value, "https://retry.test/v1/tools");
	allow = true;
	await c.save();
	assert.equal(c.web.value.searchProvider, "deepseek-search-api");
	assert.equal(c.api.value.baseURL, "https://retry.test/v1/tools");
	c.stop();
});

test("refused provider selection after accepted API settings can be retried without overwriting that namespace", async () => {
	let allow = false;
	const c = card({ scopes: { web: { mutate: async () => allow } } });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-fetch-provider", "deepseek-fetch-api");
	c.edit("ws-api-base", "https://partial.test/v1/tools");
	await c.save();
	assert.equal(c.api.value.baseURL, "https://partial.test/v1/tools");
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.ok(c.nodes().includes("partialFailed"));
	allow = true;
	await c.save();
	assert.equal(c.writes.filter(write => write.ns === "web-deepseek-api").length, 1);
	assert.equal(c.web.value.searchProvider, "deepseek-search-api");
	assert.equal(c.web.value.fetchProvider, "deepseek-fetch-api");
	c.stop();
});

test("a concurrent web edit during credential saving is fenced and retry preserves the other provider", async () => {
	let finish;
	const c = card({ credentialSet: () => new Promise(resolve => { finish = () => resolve({ ok: true }); }) });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-api-key", "staged-key");
	const saving = c.save();
	assert.equal(c.nodes().find(node => node.props?.id === "ws-fetch-provider").props.disabled, true);
	await c.web.mutate([{ op: "set", path: ["fetchProvider"], value: "concurrent-fetch" }], 7);
	finish();
	await saving;
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.equal(c.web.value.fetchProvider, "concurrent-fetch");
	assert.ok(c.nodes().includes("partialFailed"));
	const retry = c.save();
	finish();
	await retry;
	assert.equal(c.web.value.searchProvider, "deepseek-search-api");
	assert.equal(c.web.value.fetchProvider, "concurrent-fetch");
	c.stop();
});

test("missing API namespace disables both new choices while existing search remains editable", async () => {
	const c = card({ scopes: { "web-deepseek-api": { status: "unavailable", writable: false } } });
	assert.equal(c.nodes().find(node => node.type === "option" && node.props.value === "deepseek-search-api").props.disabled, true);
	assert.equal(c.nodes().find(node => node.type === "option" && node.props.value === "deepseek-fetch-api").props.disabled, true);
	c.edit("ws-model", "existing-search-model");
	await c.save();
	assert.equal(c.values.deepseekModel, "existing-search-model");
	assert.equal(c.writes.length, 0);
	c.stop();
});

test("invalid API count or reference prevents credentials and provider writes", async () => {
	let credentialWrites = 0;
	const c = card({ credentialSet: async () => { credentialWrites++; return { ok: true }; } });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-api-count", "51");
	c.edit("ws-api-key", "new-secret");
	await c.save();
	assert.equal(credentialWrites, 0);
	assert.equal(c.writes.length, 0);
	c.edit("ws-api-count", "10");
	c.edit("ws-api-keyref", "INVALID-REF");
	await c.save();
	assert.equal(credentialWrites, 0);
	assert.equal(c.writes.length, 0);
	c.stop();
});

test("different staged keys for one shared DeepSeek reference are rejected before any write", async () => {
	let writes = 0;
	const c = card({ credentialSet: async () => { writes++; return { ok: true }; } });
	c.edit("ws-deepseek-key", "messages-key");
	c.edit("ws-fetch-provider", "deepseek-fetch-api");
	c.edit("ws-api-key", "different-api-key");
	await c.save();
	assert.equal(writes, 0);
	assert.equal(c.writes.length, 0);
	assert.ok(c.nodes().includes("credentialConflict"));
	c.stop();
});

test("rejected API key write leaves provider selection and settings unchanged", async () => {
	const c = card({ credentialSet: async () => ({ ok: false }) });
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-api-key", "failed-key");
	await c.save();
	assert.equal(c.writes.length, 0);
	assert.equal(c.web.value.searchProvider, "dsh-web-search");
	assert.equal(c.nodes().find(node => node.props?.id === "ws-api-key").props.value, "failed-key");
	assert.ok(c.nodes().includes("partialFailed"));
	c.stop();
});

test("discard keeps current providers and API settings; a custom fetch provider is preserved", async () => {
	const c = card({ scopes: { web: { value: { fetchProvider: "custom-fetch" } } } });
	assert.equal(c.nodes().find(node => node.props?.id === "ws-fetch-provider").props.value, "custom-fetch");
	c.edit("ws-provider", "deepseek-search-api");
	c.edit("ws-fetch-provider", "http");
	c.edit("ws-api-base", "https://discard.test/v1/tools");
	c.nodes().find(node => node.type === "button" && node.props.children.includes("discard")).props.onClick({ preventDefault() {} });
	assert.equal(c.nodes().find(node => node.props?.id === "ws-provider").props.value, "deepseek-official");
	assert.equal(c.nodes().find(node => node.props?.id === "ws-fetch-provider").props.value, "custom-fetch");
	assert.equal(c.writes.length, 0);
	c.stop();
});

test("Tavily saves prefixed references and masks an inherited legacy literal key", async () => {
	const writes = [];
	const { registrations, serve, mutations, values } = setupClient({
		provider: "tavily",
		values: { mode: "keyed", apiKeyEnv: "OLD_TAVILY_KEY", apiKey: "inherited-key" },
		credentialSet: async (ref, value) => { writes.push({ ref, value }); return { ok: true }; }
	});
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	assert.equal(nodes.find((node) => node.props?.id === "ws-tavily-keyref").props.value, "OLD_TAVILY_KEY");
	nodes.find((node) => node.props?.id === "ws-tavily-keyref").props.onChange({ target: { value: "NEW_TAVILY_KEY" } });
	nodes.find((node) => node.props?.id === "ws-tavily-key").props.onChange({ target: { value: "new-key" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	assert.deepEqual(writes, [{ ref: "NEW_TAVILY_KEY", value: "new-key" }]);
	assert.equal(values.tavilyApiKeyEnv, "NEW_TAVILY_KEY");
	assert.equal(values.tavilyApiKey, "");
	assert.equal(values.apiKey, "inherited-key");
	assert.equal(mutations[0].ops.some((op) => op.path[0] === "apiKey"), false);
	stop();
});

test("Scavio exposes independent region settings without changing Brave", async () => {
	const { registrations, serve, values } = setupClient({ provider: "scavio", values: { country: "us", searchLang: "en" } });
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	assert.equal(nodes.find((node) => node.props?.id === "ws-scavio-country").props.value, "us");
	nodes.find((node) => node.props?.id === "ws-scavio-country").props.onChange({ target: { value: "cn" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	assert.equal(values.scavioCountry, "cn");
	assert.equal(values.country, "us");
	assert.equal(values.braveCountry, undefined);
	stop();
});

test("resetting a legacy shared country restores Brave and preserves Scavio", async () => {
	const { registrations, serve, values } = setupClient({
		provider: "brave", values: { country: "us" }, user: { country: "us" }, base: { country: "" }
	});
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	const field = nodes.find((node) => node.props?.className === "dshws_field" && flatten(node).some((child) => child.props?.id === "ws-country"));
	flatten(field).find((node) => node.props?.className === "dshws_reset").props.onClick();
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	assert.equal(values.country, undefined);
	assert.equal(values.braveCountry, undefined);
	assert.equal(values.scavioCountry, "us");
	stop();
});

test("saving visible DeepSeek settings preserves the hidden API version", async () => {
	const { registrations, serve, mutations, values } = setupClient({
		values: { apiVersion: "custom-protocol-version", model: "old-model" }
	});
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	assert.equal(nodes.some((node) => node.props?.id === "ws-apiversion"), false);
	nodes.find((node) => node.props?.id === "ws-model").props.onChange({ target: { value: "new-model" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	assert.equal(values.deepseekModel, "new-model");
	assert.equal(values.model, "old-model");
	assert.equal(values.apiVersion, "custom-protocol-version");
	assert.equal(mutations.length, 1);
	assert.equal(mutations[0].ops.some((op) => (op.path[0] === "apiVersion" || op.path[0] === "deepseekApiVersion")), false);
	stop();
});

test("settings entry follows Host namespace and failed key update keeps the draft", async () => {
	const { registrations, serve } = setupClient();
	assert.equal(registrations.size, 0);
	const stop = serve();
	assert.equal(registrations.size, 1);
	await new Promise(setImmediate);
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	const secret = nodes.find((node) => node.props?.id === "ws-deepseek-key");
	assert.ok(secret);
	secret.props.onChange({ target: { value: "replacement-key" } });
	nodes = flatten(section({}));
	const save = nodes.find((node) => node.type === "button" && node.props.children.includes("save"));
	assert.ok(save);
	save.props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	nodes = flatten(section({}));
	assert.ok(nodes.includes("partialFailed"));
	assert.ok(nodes.includes("unsaved"));
	stop();
	assert.equal(registrations.size, 0);
});

for (const { provider, keyInput, refInput, expectedRef } of [
	{ provider: "deepseek-official", keyInput: "ws-deepseek-key", refInput: "ws-deepseek-keyref", expectedRef: "NEW_DEEPSEEK_KEY" },
	{ provider: "serper", keyInput: "ws-serper-key", refInput: "ws-serper-keyref", expectedRef: "NEW_SERPER_KEY" }
]) {
	test(`${provider} saves a key under the staged credential name`, async () => {
		const writes = [];
		const { registrations, serve, mutations } = setupClient({
			provider,
			credentialSet: async (ref, value) => { writes.push({ ref, value }); return { ok: true }; }
		});
		const stop = serve();
		const section = [...registrations][0];
		let nodes = flatten(section({}));
		nodes.find((node) => node.props?.id === keyInput).props.onChange({ target: { value: "replacement-key" } });
		nodes = flatten(section({}));
		nodes.find((node) => node.props?.id === refInput).props.onChange({ target: { value: expectedRef } });
		nodes = flatten(section({}));
		const save = nodes.find((node) => node.type === "button" && node.props.children.includes("save"));
		save.props.onClick({ preventDefault() {} });
		await new Promise(setImmediate);
		assert.deepEqual(writes, [{ ref: expectedRef, value: "replacement-key" }]);
		assert.equal(mutations.length, 1);
		assert.equal(mutations[0].revision, 1);
		assert.deepEqual(JSON.parse(JSON.stringify(mutations[0].ops.map((op) => [op.op, op.path[0], op.value]))), [
			["set", provider === "serper" ? "serperApiKeyEnv" : "deepseekApiKeyEnv", expectedRef],
			["set", provider === "serper" ? "serperApiKey" : "deepseekApiKey", ""]
		]);
		stop();
	});
}

test("rejected configuration mutation keeps the draft and reports failure", async () => {
	const { registrations, serve, mutations } = setupClient({ mutate: async () => false });
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	nodes.find((node) => node.props?.id === "ws-model").props.onChange({ target: { value: "replacement-model" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	nodes = flatten(section({}));
	assert.equal(mutations.length, 1);
	assert.ok(nodes.includes("partialFailed"));
	assert.ok(nodes.includes("unsaved"));
	assert.equal(nodes.find((node) => node.props?.id === "ws-model").props.value, "replacement-model");
	stop();
});

test("saving locks editing until the mutation settles", async () => {
	let finish;
	const pending = new Promise((resolve) => { finish = resolve; });
	const { registrations, serve, values } = setupClient({ mutate: async (ops) => {
		await pending;
		for (const op of ops) if (op.op === "set") values[op.path[0]] = op.value;
		return true;
	} });
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	nodes.find((node) => node.props?.id === "ws-model").props.onChange({ target: { value: "replacement-model" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	nodes = flatten(section({}));
	const model = nodes.find((node) => node.props?.id === "ws-model");
	assert.equal(model.props.disabled, true);
	assert.equal(nodes.find((node) => node.props?.id === "ws-deepseek-key").props.disabled, true);
	model.props.onChange({ target: { value: "late-edit" } });
	finish();
	await new Promise(setImmediate);
	nodes = flatten(section({}));
	assert.equal(nodes.find((node) => node.props?.id === "ws-model").props.value, "replacement-model");
	stop();
});

test("new credential overrides an inherited literal API key", async () => {
	const { registrations, serve, mutations, values } = setupClient({
		values: { deepseekApiKey: "old-literal" },
		base: { deepseekApiKey: "old-literal" },
		credentialSet: async () => ({ ok: true })
	});
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	nodes.find((node) => node.props?.id === "ws-deepseek-key").props.onChange({ target: { value: "new-key" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	assert.deepEqual(JSON.parse(JSON.stringify(mutations[0].ops.map((op) => [op.op, op.path[0], op.value]))), [["set", "deepseekApiKey", ""]]);
	assert.equal(values.deepseekApiKey, "");
	stop();
});

test("invalid credential reference blocks key and configuration writes", async () => {
	const writes = [];
	const { registrations, serve } = setupClient({ credentialSet: async (ref, value) => {
		writes.push({ ref, value });
		return { ok: true };
	} });
	const stop = serve();
	const section = [...registrations][0];
	let nodes = flatten(section({}));
	nodes.find((node) => node.props?.id === "ws-deepseek-key").props.onChange({ target: { value: "replacement-key" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.props?.id === "ws-deepseek-keyref").props.onChange({ target: { value: "BAD-KEY" } });
	nodes = flatten(section({}));
	nodes.find((node) => node.type === "button" && node.props.children.includes("save")).props.onClick({ preventDefault() {} });
	await new Promise(setImmediate);
	nodes = flatten(section({}));
	assert.ok(nodes.includes("invalidCredentialRef"));
	assert.ok(nodes.includes("invalidToast"));
	assert.deepEqual(writes, []);
	stop();
});
