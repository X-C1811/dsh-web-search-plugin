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
		createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
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
	let serve;
	const context = {
		effect: (start) => start(),
		locale: { bind: () => (key) => key, register: () => () => {} },
		configForms: {
			get: () => scope,
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
	return { registrations, serve, mutations, values };
}

function flatten(node) {
	if (node == null || node === false) return [];
	if (Array.isArray(node)) return node.flatMap(flatten);
	if (typeof node !== "object") return [node];
	if (typeof node.type === "function") return flatten(node.type(node.props));
	return [node, ...flatten(node.props?.children)];
}

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
	assert.ok(nodes.includes("saveFailed"));
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
	assert.ok(nodes.includes("saveFailed"));
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
