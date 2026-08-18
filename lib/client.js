/**
 * Browser half of `dsh-web-search-plugin`: a plugin card under the
 * "settings → Plugins → Plugin configuration" surface that edits the
 * `dsh-web-search-plugin` settings namespace. The card switches the
 * Tavily / Brave backend and writes each engine's credential through the
 * credentials domain (`TAVILY_API_KEY` / `BRAVE_API_KEY` by default).
 *
 * This bundle is a self-contained hand-written module in the exact wire format
 * the client module system expects: one `window.__ModuleLoader__.load` call
 * whose factory registers a Cordis plugin through `exports.apply`. It mirrors
 * the official `dsh-client-ui-settings-plugins` cards (staged edits, save
 * writes once, credential written through the credentials domain) without
 * depending on that package's internal `CardForm`.
 *
 * @module dsh-web-search-plugin/client
 */
window.__ModuleLoader__.load({
	id: "dsh-web-search-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");

		/** Settings namespace of this plugin. */
		const NS = "dsh-web-search-plugin";
		/** Credential reference Tavily keyed mode resolves when the section names none. */
		const DEFAULT_TAVILY_KEY_REF = "TAVILY_API_KEY";
		/** Credential reference Brave resolves when the section names none. */
		const DEFAULT_BRAVE_KEY_REF = "BRAVE_API_KEY";
		/** Form field the Tavily write-only credential control stages under. */
		const TAVILY_API_KEY_FIELD = "apiKey";
		/** Form field the Brave write-only credential control stages under. */
		const BRAVE_API_KEY_FIELD = "braveApiKey";
		const SECRET_FIELDS = new Set([TAVILY_API_KEY_FIELD, BRAVE_API_KEY_FIELD]);

		/** Locale bundles for the card. */
		const en = {
			nav: "Web search",
			description: "Tavily (keyless by default) or Brave Search. Switching engines here is enough — web.searchProvider stays dsh-web-search.",
			provider: "Search engine",
			providerTavily: "Tavily",
			providerBrave: "Brave Search",
			mode: "Auth mode",
			modeKeyless: "Keyless (free, rate-limited)",
			modeKeyed: "API key",
			apiKey: "API key",
			apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "No key is configured; keyed / Brave search is unavailable until one is.",
			apiKeyEnv: "Credential reference",
			apiKeyEnvHint: "Name of the credential/env var resolved for keyed Tavily search.",
			braveApiKeyEnv: "Credential reference",
			braveApiKeyEnvHint: "Name of the credential/env var resolved for Brave search.",
			baseURL: "Endpoint",
			baseURLHint: "Leave blank to use the provider default.",
			braveBaseURL: "Endpoint",
			braveBaseURLHint: "Leave blank to use the Brave Search API default.",
			maxResults: "Max results",
			maxResultsHint: "Sources returned per search (1-20).",
			searchDepth: "Search depth",
			searchDepthBasic: "Basic (faster)",
			searchDepthAdvanced: "Advanced (slower, deeper)",
			includeAnswer: "Include answer",
			includeAnswerHint: "Request Tavily's generated answer text shown above the sources.",
			topic: "Topic",
			topicGeneral: "General",
			topicNews: "News",
			country: "Country",
			countryHint: "ISO 2-letter code (e.g. cn). Leave blank for Brave's default.",
			searchLang: "Search language",
			searchLangHint: "e.g. zh-hans or en. Leave blank for Brave's default.",
			freshness: "Freshness",
			freshnessAny: "Any time",
			freshnessDay: "Past day",
			freshnessWeek: "Past week",
			freshnessMonth: "Past month",
			freshnessYear: "Past year",
			proxy: "Proxy",
			proxyHint: "HTTP(S) proxy URL. Leave blank to use HTTPS_PROXY / HTTP_PROXY.",
			expand: "Show settings",
			collapse: "Hide settings",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			readOnly: "This deployment stores settings read-only.",
			invalidNumber: "Enter a number, or leave blank to use the default."
		};
		/** Simplified Chinese copy. */
		const zh = {
			nav: "网页搜索",
			description: "Tavily（默认 keyless）或 Brave Search。在此切换引擎即可，不必改 web.searchProvider。",
			provider: "搜索引擎",
			providerTavily: "Tavily",
			providerBrave: "Brave Search",
			mode: "认证模式",
			modeKeyless: "Keyless（免费、限流）",
			modeKeyed: "API key",
			apiKey: "API Key",
			apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "未配置密钥；keyed / Brave 模式下搜索不可用。",
			apiKeyEnv: "凭据引用名",
			apiKeyEnvHint: "keyed 模式解析的凭据/环境变量名。",
			braveApiKeyEnv: "凭据引用名",
			braveApiKeyEnvHint: "Brave 搜索解析的凭据/环境变量名。",
			baseURL: "接口地址",
			baseURLHint: "留空则使用提供方默认地址。",
			braveBaseURL: "接口地址",
			braveBaseURLHint: "留空则使用 Brave Search API 默认地址。",
			maxResults: "结果数量",
			maxResultsHint: "每次搜索返回的源数量（1-20）。",
			searchDepth: "搜索深度",
			searchDepthBasic: "Basic（较快）",
			searchDepthAdvanced: "Advanced（较慢、更深）",
			includeAnswer: "包含摘要回答",
			includeAnswerHint: "请求 Tavily 生成摘要回答，显示在结果上方。",
			topic: "主题",
			topicGeneral: "通用",
			topicNews: "新闻",
			country: "国家/地区",
			countryHint: "ISO 两位码（如 cn）。留空使用 Brave 默认。",
			searchLang: "搜索语言",
			searchLangHint: "如 zh-hans、en。留空使用 Brave 默认。",
			freshness: "时效",
			freshnessAny: "不限",
			freshnessDay: "过去一天",
			freshnessWeek: "过去一周",
			freshnessMonth: "过去一月",
			freshnessYear: "过去一年",
			proxy: "代理",
			proxyHint: "HTTP(S) 代理 URL。留空则使用 HTTPS_PROXY / HTTP_PROXY。",
			expand: "展开设置",
			collapse: "收起设置",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unsaved: "未保存",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			readOnly: "本部署的设置为只读。",
			invalidNumber: "请填数字；留空表示使用默认值。"
		};

		/** A whole-number field spec: empty draft clears, any other invalid draft blocks save. */
		function numberField(field) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
				}
			};
		}
		/** A free-text field spec: empty draft clears. */
		function textField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
				}
			};
		}
		/** A choice field spec: staged as its raw string. */
		function choiceField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => text.trim() === "" ? { kind: "clear" } : { kind: "set", value: text.trim() }
			};
		}
		/** A boolean field spec: a checkbox draft sets or clears. */
		function booleanField(field) {
			return {
				field,
				format: (value) => value === true ? "true" : "",
				parse: (text) => text === "true" ? { kind: "set", value: true } : { kind: "clear" }
			};
		}

		/**
		 * Staged form over the `dsh-web-search-plugin` settings namespace.
		 * Write-only credential fields (`apiKey`, `braveApiKey`) have no section
		 * spec and are written through the credentials domain.
		 */
		var SearchCardForm = class {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.specs = new Map([
					choiceField("provider"),
					choiceField("mode"),
					numberField("maxResults"),
					textField("apiKeyEnv"),
					textField("baseURL"),
					choiceField("searchDepth"),
					choiceField("topic"),
					booleanField("includeAnswer"),
					textField("braveApiKeyEnv"),
					textField("braveBaseURL"),
					textField("country"),
					textField("searchLang"),
					choiceField("freshness"),
					textField("proxy")
				].map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.saving = false;
				this.failed = false;
				this.credential = { ref: "", configured: false, writable: true };
				this.listeners = new Set();
				scope.subscribe(() => {
					this.publish();
				});
				this.readCredential();
			}
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			field(field) {
				const staged = this.staged.get(field);
				if (SECRET_FIELDS.has(field)) return {
					text: staged?.text ?? "",
					overridden: false,
					invalid: false
				};
				const spec = this.specs.get(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					if (SECRET_FIELDS.has(field)) {
						const value = staged.text.trim();
						if (value !== "") plan.push({ field, run: () => this.writeKey(field, value) });
						continue;
					}
					const spec = this.specs.get(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({ field, run: void 0 });
					else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
					else plan.push({ field, run: () => this.store(field, write.value) });
				}
				return plan;
			}
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, { text, clear: false });
					},
					resetField: (field) => {
						this.stage(field, { text: this.baseText(field), clear: true });
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				return this.userLayer()?.[field] === value;
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
				if (field === "provider" || field === "apiKeyEnv" || field === "braveApiKeyEnv") this.readCredential();
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseText(field) {
				return this.specs.get(field).format(this.snapshotOf().base?.[field]);
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
			/** Draft-aware engine: staged `provider` wins over the saved section. */
			providerOf() {
				const staged = this.staged.get("provider");
				if (staged !== void 0 && !staged.clear && staged.text.trim() !== "") return staged.text.trim();
				const declared = this.sectionValue("provider");
				return declared === "brave" ? "brave" : "tavily";
			}
			tavilyRef() {
				const declared = this.sectionValue("apiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_TAVILY_KEY_REF;
			}
			braveRef() {
				const declared = this.sectionValue("braveApiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_BRAVE_KEY_REF;
			}
			/** The credential reference the currently visible engine uses. */
			refOf() {
				return this.providerOf() === "brave" ? this.braveRef() : this.tavilyRef();
			}
			async readCredential() {
				const ref = this.refOf();
				if (ref !== this.credential.ref) {
					this.credential = { ref, configured: false, writable: true };
					this.publish();
				}
				let response;
				try {
					response = await this.api.credentials.describe({ refs: [ref] });
				} catch (_credentialReadFailure) {
					return;
				}
				if (!response.result.ok || ref !== this.refOf()) return;
				const view = response.result.value.credentials[ref];
				const next = {
					ref,
					configured: view?.configured ?? false,
					writable: view?.writable ?? true
				};
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.publish();
			}
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			async writeKey(field, value) {
				const ref = field === BRAVE_API_KEY_FIELD ? this.braveRef() : this.tavilyRef();
				try {
					await this.api.credentials.set({ ref, value });
				} catch (_credentialWriteFailure) {}
				await this.readCredential();
				return this.credential.ref === ref ? this.credential.configured : true;
			}
		};

		/** Bridges the plugin scope and the credentials domain onto the card. */
		var SearchCardController = class {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.form = new SearchCardForm(scope, api);
				this.store = this.form.bind(() => this.projection());
				scope.subscribe(() => {
					this.form.readCredential();
				});
			}
			projection() {
				return {
					...this.form.shell(),
					provider: this.form.field("provider"),
					mode: this.form.field("mode"),
					apiKey: this.form.field(TAVILY_API_KEY_FIELD),
					apiKeyEnv: this.form.field("apiKeyEnv"),
					baseURL: this.form.field("baseURL"),
					maxResults: this.form.field("maxResults"),
					searchDepth: this.form.field("searchDepth"),
					includeAnswer: this.form.field("includeAnswer"),
					topic: this.form.field("topic"),
					braveApiKey: this.form.field(BRAVE_API_KEY_FIELD),
					braveApiKeyEnv: this.form.field("braveApiKeyEnv"),
					braveBaseURL: this.form.field("braveBaseURL"),
					country: this.form.field("country"),
					searchLang: this.form.field("searchLang"),
					freshness: this.form.field("freshness"),
					proxy: this.form.field("proxy"),
					apiKeyConfigured: this.form.credential.configured,
					apiKeyWritable: this.form.credential.writable
				};
			}
			inject() {
				return {
					hooks: { pluginSearchCard: this.store },
					...this.form.actions()
				};
			}
		};

		/** Row style: one labelled field with label, hint, and staged input. */
		const fieldRow = (label, hint, children) => react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px", padding: "12px 0", borderTop: "1px solid var(--dsw-alias-border-l2)" } },
			react.createElement("label", { style: { color: "var(--dsw-alias-label-primary)", fontSize: "13px", fontWeight: 500, lineHeight: "1.5" } }, label),
			children,
			hint ? react.createElement("p", { style: { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: "12px", lineHeight: "1.5" } }, hint) : null);
		const textInput = (props) => react.createElement("input", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, type: "text", ...props.numeric ? { inputMode: "numeric" } : {}, ...props });
		const secretInput = (props) => react.createElement("input", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, type: "password", autoComplete: "off", ...props });
		const selectInput = (props) => react.createElement("select", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, ...props });
		const checkboxInput = (props) => react.createElement("input", { type: "checkbox", style: { width: "16px", height: "16px", accentColor: "var(--dsw-alias-brand-primary)" }, ...props });

		/** Render one plugin card: engine switch plus the engine-specific form. */
		function SearchCard(props) {
			const { t } = props;
			const state = props.usePluginSearchCard((snapshot) => snapshot);
			const [open, setOpen] = react.useState(false);
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.invalid || state.saving;
			const brave = state.provider.text === "brave";
			const keyed = state.mode.text === "keyed";
			return react.createElement("li", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: "12px", listStyle: "none" } },
				react.createElement("button", { type: "button", "aria-expanded": open, onClick: () => setOpen(!open), style: { appearance: "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", background: "0 0", border: "0", borderRadius: "12px", alignItems: "center", gap: "12px", padding: "14px 16px", display: "flex" } },
					react.createElement("span", { style: { flexDirection: "column", flex: 1, gap: "4px", minWidth: 0, display: "flex" } },
						react.createElement("span", { style: { color: "var(--dsw-alias-label-primary)", fontSize: "15px", fontWeight: 600, lineHeight: "1.4" } }, t("nav")),
						react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "1.5" } }, t("description"))),
					state.dirty ? react.createElement("span", { style: { whiteSpace: "nowrap", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", borderRadius: "999px", flex: "none", padding: "1px 8px", fontSize: "11px", fontWeight: 500, lineHeight: "17px" } }, t("unsaved")) : null,
					react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" } }, open ? "▾" : "▸")),
				open ? react.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", paddingBottom: "8px" } },
					!state.writable ? react.createElement("p", { style: { color: "var(--dsw-alias-label-tertiary)", margin: "12px 0 0", fontSize: "12px", lineHeight: "1.5" } }, t("readOnly")) : null,
					fieldRow(t("provider"), null, selectInput({ id: "plugin-config-web-search-provider", value: brave ? "brave" : "tavily", disabled, onChange: (e) => props.edit("provider", e.target.value), children: [
						react.createElement("option", { value: "tavily", key: "tavily" }, t("providerTavily")),
						react.createElement("option", { value: "brave", key: "brave" }, t("providerBrave"))
					] })),
					brave ? null : fieldRow(t("mode"), null, selectInput({ id: "plugin-config-web-search-mode", value: state.mode.text, disabled, onChange: (e) => props.edit("mode", e.target.value), children: [
						react.createElement("option", { value: "keyless", key: "keyless" }, t("modeKeyless")),
						react.createElement("option", { value: "keyed", key: "keyed" }, t("modeKeyed"))
					] })),
					(!brave && keyed) || brave ? fieldRow(t("apiKey"), t("apiKeyHint"), secretInput({ id: "plugin-config-web-search-key", value: brave ? state.braveApiKey.text : state.apiKey.text, disabled: !state.apiKeyWritable, placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onChange: (e) => props.edit(brave ? BRAVE_API_KEY_FIELD : TAVILY_API_KEY_FIELD, e.target.value) })) : null,
					(!brave && keyed) || brave ? fieldRow(brave ? t("braveApiKeyEnv") : t("apiKeyEnv"), brave ? t("braveApiKeyEnvHint") : t("apiKeyEnvHint"), textInput({ id: "plugin-config-web-search-keyref", value: brave ? state.braveApiKeyEnv.text : state.apiKeyEnv.text, disabled, onChange: (e) => props.edit(brave ? "braveApiKeyEnv" : "apiKeyEnv", e.target.value), onReset: () => props.resetField(brave ? "braveApiKeyEnv" : "apiKeyEnv") })) : null,
					brave ? fieldRow(t("braveBaseURL"), t("braveBaseURLHint"), textInput({ id: "plugin-config-web-search-brave-base", value: state.braveBaseURL.text, disabled, onChange: (e) => props.edit("braveBaseURL", e.target.value), onReset: () => props.resetField("braveBaseURL") })) : fieldRow(t("baseURL"), t("baseURLHint"), textInput({ id: "plugin-config-web-search-base", value: state.baseURL.text, disabled, onChange: (e) => props.edit("baseURL", e.target.value), onReset: () => props.resetField("baseURL") })),
					brave ? null : fieldRow(t("searchDepth"), null, selectInput({ id: "plugin-config-web-search-depth", value: state.searchDepth.text, disabled, onChange: (e) => props.edit("searchDepth", e.target.value), children: [
						react.createElement("option", { value: "basic", key: "basic" }, t("searchDepthBasic")),
						react.createElement("option", { value: "advanced", key: "advanced" }, t("searchDepthAdvanced"))
					] })),
					brave ? null : fieldRow(t("topic"), null, selectInput({ id: "plugin-config-web-search-topic", value: state.topic.text, disabled, onChange: (e) => props.edit("topic", e.target.value), children: [
						react.createElement("option", { value: "general", key: "general" }, t("topicGeneral")),
						react.createElement("option", { value: "news", key: "news" }, t("topicNews"))
					] })),
					brave ? null : fieldRow(t("includeAnswer"), t("includeAnswerHint"), checkboxInput({ id: "plugin-config-web-search-answer", checked: state.includeAnswer.text === "true", disabled, onChange: (e) => props.edit("includeAnswer", e.target.checked ? "true" : "") })),
					brave ? fieldRow(t("country"), t("countryHint"), textInput({ id: "plugin-config-web-search-country", value: state.country.text, disabled, onChange: (e) => props.edit("country", e.target.value), onReset: () => props.resetField("country") })) : null,
					brave ? fieldRow(t("searchLang"), t("searchLangHint"), textInput({ id: "plugin-config-web-search-lang", value: state.searchLang.text, disabled, onChange: (e) => props.edit("searchLang", e.target.value), onReset: () => props.resetField("searchLang") })) : null,
					brave ? fieldRow(t("freshness"), null, selectInput({ id: "plugin-config-web-search-freshness", value: state.freshness.text, disabled, onChange: (e) => props.edit("freshness", e.target.value), children: [
						react.createElement("option", { value: "", key: "any" }, t("freshnessAny")),
						react.createElement("option", { value: "pd", key: "pd" }, t("freshnessDay")),
						react.createElement("option", { value: "pw", key: "pw" }, t("freshnessWeek")),
						react.createElement("option", { value: "pm", key: "pm" }, t("freshnessMonth")),
						react.createElement("option", { value: "py", key: "py" }, t("freshnessYear"))
					] })) : null,
					brave ? fieldRow(t("proxy"), t("proxyHint"), textInput({ id: "plugin-config-web-search-proxy", value: state.proxy.text, disabled, onChange: (e) => props.edit("proxy", e.target.value), onReset: () => props.resetField("proxy") })) : null,
					fieldRow(t("maxResults"), t("maxResultsHint"), textInput({ id: "plugin-config-web-search-max", numeric: true, value: state.maxResults.text, disabled, onChange: (e) => props.edit("maxResults", e.target.value), onReset: () => props.resetField("maxResults") })),
					react.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", justifyContent: "flex-end", alignItems: "center", gap: "8px", padding: "12px 0 4px", display: "flex" } },
						state.failed ? react.createElement("p", { role: "status", style: { minWidth: 0, color: "var(--dsw-alias-label-error)", flex: 1, margin: 0, fontSize: "12px", lineHeight: "1.5" } }, t("saveFailed")) : null,
						react.createElement("button", { type: "button", disabled: !state.dirty || state.saving, onClick: props.discard, style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "5px 14px", fontSize: "13px", lineHeight: "1.5", color: "var(--dsw-alias-label-secondary)", background: "0 0" } }, t("discard")),
						react.createElement("button", { type: "button", disabled: blocked, onClick: props.save, style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid transparent", borderRadius: "8px", padding: "5px 14px", fontSize: "13px", lineHeight: "1.5", color: "var(--dsw-alias-label-on-brand)", background: "var(--dsw-alias-bg-brand-solid)" } }, t(state.saving ? "saving" : "save")))) : null);
		}

		/** Mount the card into the plugin configuration surface. */
		function apply(ctx) {
			const { api } = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-web-search-plugin: card dictionaries");
			const controller = new SearchCardController(ctx.settingsScope.bind({ namespace: NS }), api);
			ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => {
				controller.form.refreshCredential(ref);
			}), "dsh-web-search-plugin: credential invalidations");
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: "dsh-web-search-plugin",
					locale: NS,
					inject: () => controller.inject()
				}, SearchCard);
			});
		}

		const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
