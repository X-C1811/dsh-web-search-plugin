/**
 * Browser half of `dsh-web-search-plugin`: a plugin card under the
 * "settings → Plugins → Plugin configuration" surface that edits the
 * `dsh-web-search-plugin` settings namespace and its `TAVILY_API_KEY` credential.
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

		/** Settings namespace of the Tavily search provider. */
		const NS = "dsh-web-search-plugin";
		/** Credential reference the provider resolves when the section names none. */
		const DEFAULT_API_KEY_REF = "TAVILY_API_KEY";
		/** Form field the credential control stages under. */
		const API_KEY_FIELD = "apiKey";

		/** Locale bundles for the card. */
		const en = {
			nav: "Web search (Tavily)",
			description: "The Tavily search provider. Keyless by default; switch to keyed and add a Tavily API key for higher limits.",
			mode: "Auth mode",
			modeKeyless: "Keyless (free, rate-limited)",
			modeKeyed: "API key",
			apiKey: "API key",
			apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "No key is configured; keyed search is unavailable until one is.",
			apiKeyEnv: "Credential reference",
			apiKeyEnvHint: "Name of the credential/env var resolved for keyed search.",
			baseURL: "Endpoint",
			baseURLHint: "Leave blank to use the provider default.",
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
			nav: "网页搜索（Tavily）",
			description: "Tavily 搜索提供方。默认 keyless 免费使用；切换到 API key 并填入 Tavily key 可提高限额。",
			mode: "认证模式",
			modeKeyless: "Keyless（免费、限流）",
			modeKeyed: "API key",
			apiKey: "API Key",
			apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "未配置密钥；keyed 模式下搜索不可用。",
			apiKeyEnv: "凭据引用名",
			apiKeyEnvHint: "keyed 模式解析的凭据/环境变量名。",
			baseURL: "接口地址",
			baseURLHint: "留空则使用提供方默认地址。",
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
		/** A choice field spec (mode/searchDepth/topic): staged as its raw string. */
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
		 * Staged form over the `dsh-web-search-plugin` settings namespace. Modeled on
		 * the official cards' `CardForm` contract: a draft map, save writes every
		 * staged edit once, and the API key is written through the credentials
		 * domain addressed by the reference the section names.
		 */
		var TavilyCardForm = class {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.specs = new Map([numberField("maxResults"), textField("apiKeyEnv"), textField("baseURL"), choiceField("mode"), choiceField("searchDepth"), choiceField("topic"), booleanField("includeAnswer")].map((spec) => [spec.field, spec]));
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
				// Write-only credential controls have no section spec; they
				// report only their staged draft (mirroring the official
				// cards' secret-field branch in CardForm.field).
				if (field === API_KEY_FIELD) return {
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
					if (field === API_KEY_FIELD) {
						const value = staged.text.trim();
						if (value !== "") plan.push({ field, run: () => this.writeKey(value) });
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
			/** The credential reference the section names, or the provider default. */
			refOf() {
				const declared = this.sectionValue("apiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
			}
			/** Ask the credentials domain about the reference the section currently names. */
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
			/** Re-read after the Host reports a change to the reference this card watches. */
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			/** Write the staged key, then re-read whether the Host now holds one. */
			async writeKey(value) {
				try {
					await this.api.credentials.set({ ref: this.refOf(), value });
				} catch (_credentialWriteFailure) {}
				await this.readCredential();
				return this.credential.configured;
			}
		};

		/** Bridges the `dsh-web-search-plugin` scope and the credentials domain onto the card. */
		var TavilyCardController = class {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.form = new TavilyCardForm(scope, api);
				this.store = this.form.bind(() => this.projection());
				scope.subscribe(() => {
					this.form.readCredential();
				});
			}
			projection() {
				return {
					...this.form.shell(),
					mode: this.form.field("mode"),
					apiKey: this.form.field(API_KEY_FIELD),
					apiKeyEnv: this.form.field("apiKeyEnv"),
					baseURL: this.form.field("baseURL"),
					maxResults: this.form.field("maxResults"),
					searchDepth: this.form.field("searchDepth"),
					includeAnswer: this.form.field("includeAnswer"),
					topic: this.form.field("topic"),
					apiKeyConfigured: this.form.credential.configured,
					apiKeyWritable: this.form.credential.writable
				};
			}
			inject() {
				return {
					hooks: { tavilySearchCard: this.store },
					...this.form.actions()
				};
			}
		};

		/** Row style: one labelled field with label, hint, and staged input. */
		const fieldRow = (label, hint, children) => react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px", padding: "12px 0", borderTop: "1px solid var(--dsw-alias-border-l2)" } },
			react.createElement("label", { style: { color: "var(--dsw-alias-label-primary)", fontSize: "13px", fontWeight: 500, lineHeight: "1.5" } }, label),
			children,
			hint ? react.createElement("p", { style: { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: "12px", lineHeight: "1.5" } }, hint) : null);
		/** Text/number input. */
		const textInput = (props) => react.createElement("input", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, type: "text", ...props.numeric ? { inputMode: "numeric" } : {}, ...props });
		/** Password input for the write-only credential. */
		const secretInput = (props) => react.createElement("input", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, type: "password", autoComplete: "off", ...props });
		/** Choice select. */
		const selectInput = (props) => react.createElement("select", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5" }, ...props });
		/** Checkbox for booleans. */
		const checkboxInput = (props) => react.createElement("input", { type: "checkbox", style: { width: "16px", height: "16px", accentColor: "var(--dsw-alias-brand-primary)" }, ...props });

		/** Render one plugin card: header disclosure plus the staged form. */
		function TavilyCard(props) {
			const { t } = props;
			const state = props.useTavilySearchCard((snapshot) => snapshot);
			const [open, setOpen] = react.useState(false);
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.invalid || state.saving;
			return react.createElement("li", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: "12px", listStyle: "none" } },
				react.createElement("button", { type: "button", "aria-expanded": open, onClick: () => setOpen(!open), style: { appearance: "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", background: "0 0", border: "0", borderRadius: "12px", alignItems: "center", gap: "12px", padding: "14px 16px", display: "flex" } },
					react.createElement("span", { style: { flexDirection: "column", flex: 1, gap: "4px", minWidth: 0, display: "flex" } },
						react.createElement("span", { style: { color: "var(--dsw-alias-label-primary)", fontSize: "15px", fontWeight: 600, lineHeight: "1.4" } }, t("nav")),
						react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "1.5" } }, t("description"))),
					state.dirty ? react.createElement("span", { style: { whiteSpace: "nowrap", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", borderRadius: "999px", flex: "none", padding: "1px 8px", fontSize: "11px", fontWeight: 500, lineHeight: "17px" } }, t("unsaved")) : null,
					react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" } }, open ? "▾" : "▸")),
				open ? react.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", paddingBottom: "8px" } },
					!state.writable ? react.createElement("p", { style: { color: "var(--dsw-alias-label-tertiary)", margin: "12px 0 0", fontSize: "12px", lineHeight: "1.5" } }, t("readOnly")) : null,
					fieldRow(t("mode"), null, selectInput({ id: "plugin-config-web-search-mode", value: state.mode.text, disabled, onChange: (e) => props.edit("mode", e.target.value), children: [
						react.createElement("option", { value: "keyless", key: "keyless" }, t("modeKeyless")),
						react.createElement("option", { value: "keyed", key: "keyed" }, t("modeKeyed"))
					] })),
					state.mode.text === "keyed" ? fieldRow(t("apiKey"), t("apiKeyHint"), secretInput({ id: "plugin-config-web-search-key", value: state.apiKey.text, disabled: !state.apiKeyWritable, placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onChange: (e) => props.edit("apiKey", e.target.value) })) : null,
					state.mode.text === "keyed" ? fieldRow(t("apiKeyEnv"), t("apiKeyEnvHint"), textInput({ id: "plugin-config-web-search-keyref", value: state.apiKeyEnv.text, disabled, onChange: (e) => props.edit("apiKeyEnv", e.target.value), onReset: () => props.resetField("apiKeyEnv") })) : null,
					fieldRow(t("baseURL"), t("baseURLHint"), textInput({ id: "plugin-config-web-search-base", value: state.baseURL.text, disabled, onChange: (e) => props.edit("baseURL", e.target.value), onReset: () => props.resetField("baseURL") })),
					fieldRow(t("searchDepth"), null, selectInput({ id: "plugin-config-web-search-depth", value: state.searchDepth.text, disabled, onChange: (e) => props.edit("searchDepth", e.target.value), children: [
						react.createElement("option", { value: "basic", key: "basic" }, t("searchDepthBasic")),
						react.createElement("option", { value: "advanced", key: "advanced" }, t("searchDepthAdvanced"))
					] })),
					fieldRow(t("topic"), null, selectInput({ id: "plugin-config-web-search-topic", value: state.topic.text, disabled, onChange: (e) => props.edit("topic", e.target.value), children: [
						react.createElement("option", { value: "general", key: "general" }, t("topicGeneral")),
						react.createElement("option", { value: "news", key: "news" }, t("topicNews"))
					] })),
					fieldRow(t("includeAnswer"), t("includeAnswerHint"), checkboxInput({ id: "plugin-config-web-search-answer", checked: state.includeAnswer.text === "true", disabled, onChange: (e) => props.edit("includeAnswer", e.target.checked ? "true" : "") })),
					fieldRow(t("maxResults"), t("maxResultsHint"), textInput({ id: "plugin-config-web-search-max", numeric: true, value: state.maxResults.text, disabled, onChange: (e) => props.edit("maxResults", e.target.value), onReset: () => props.resetField("maxResults") })),
					react.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", justifyContent: "flex-end", alignItems: "center", gap: "8px", padding: "12px 0 4px", display: "flex" } },
						state.failed ? react.createElement("p", { role: "status", style: { minWidth: 0, color: "var(--dsw-alias-label-error)", flex: 1, margin: 0, fontSize: "12px", lineHeight: "1.5" } }, t("saveFailed")) : null,
						react.createElement("button", { type: "button", disabled: !state.dirty || state.saving, onClick: props.discard, style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "5px 14px", fontSize: "13px", lineHeight: "1.5", color: "var(--dsw-alias-label-secondary)", background: "0 0" } }, t("discard")),
						react.createElement("button", { type: "button", disabled: blocked, onClick: props.save, style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid transparent", borderRadius: "8px", padding: "5px 14px", fontSize: "13px", lineHeight: "1.5", color: "var(--dsw-alias-label-on-brand)", background: "var(--dsw-alias-bg-brand-solid)" } }, t(state.saving ? "saving" : "save")))) : null);
		}

		/** Mount the Tavily card into the plugin configuration surface. */
		function apply(ctx) {
			const { api } = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-web-search-plugin: card dictionaries");
			const controller = new TavilyCardController(ctx.settingsScope.bind({ namespace: NS }), api);
			ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => {
				controller.form.refreshCredential(ref);
			}), "dsh-web-search-plugin: credential invalidations");
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: "dsh-web-search-plugin",
					locale: NS,
					inject: () => controller.inject()
				}, TavilyCard);
			});
		}

		/** Cordis service names this browser plugin's apply reads (fiber inject). */
		const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
//# sourceMappingURL=client.js.map