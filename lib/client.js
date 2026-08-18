/**
 * Browser half of `dsh-web-search-plugin`: a top-level "Web search" settings
 * section (settings → Web search) that edits the `dsh-web-search-plugin`
 * settings namespace. The card switches the DeepSeek / Tavily / Brave backend
 * and writes each engine's credential through the credentials domain
 * (`DEEPSEEK_API_KEY` / `TAVILY_API_KEY` / `BRAVE_API_KEY` by default).
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
		/** Credential reference DeepSeek resolves when the section names none. */
		const DEFAULT_DEEPSEEK_KEY_REF = "DEEPSEEK_API_KEY";
		/** Form field the Tavily write-only credential control stages under. */
		const TAVILY_API_KEY_FIELD = "apiKey";
		/** Form field the Brave write-only credential control stages under. */
		const BRAVE_API_KEY_FIELD = "braveApiKey";
		/** Form field the DeepSeek write-only credential control stages under. */
		const DEEPSEEK_API_KEY_FIELD = "deepseekApiKey";
		const SECRET_FIELDS = new Set([TAVILY_API_KEY_FIELD, BRAVE_API_KEY_FIELD, DEEPSEEK_API_KEY_FIELD]);
		const DRAFT_KEY = "dsh-web-search-plugin:settings-draft";

		function readDraft() {
			try {
				const raw = sessionStorage.getItem(DRAFT_KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object" || parsed.staged === null || typeof parsed.staged !== "object") return null;
				return parsed;
			} catch {
				return null;
			}
		}
		function writeDraft(form) {
			try {
				const staged = {};
				for (const [field, edit] of form.staged) {
					if (SECRET_FIELDS.has(field)) continue;
					staged[field] = { text: String(edit?.text ?? ""), clear: edit?.clear === true };
				}
				if (Object.keys(staged).length === 0 && form.failed !== true) {
					sessionStorage.removeItem(DRAFT_KEY);
					return;
				}
				sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ staged, failed: form.failed === true }));
			} catch {
				/* private mode / quota */
			}
		}

		/** Locale bundles for the card. */
		const en = {
			nav: "Web search",
			provider: "Search engine",
			providerTavily: "Tavily",
			providerBrave: "Brave Search",
			providerDeepseek: "DeepSeek (official)",
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
			searchDepth: "Search depth",
			searchDepthBasic: "Basic (faster)",
			searchDepthAdvanced: "Advanced (slower, deeper)",
			includeAnswer: "Include answer",
			includeAnswerHint: "Request Tavily's generated answer text shown above the sources.",
			topic: "Topic",
			topicGeneral: "General",
			topicNews: "News",
			country: "Country",
			countryHint: "ISO 2-letter code (e.g. cn).",
			searchLang: "Search language",
			searchLangHint: "e.g. zh-hans or en.",
			freshness: "Freshness",
			freshnessAny: "Any time",
			freshnessDay: "Past day",
			freshnessWeek: "Past week",
			freshnessMonth: "Past month",
			freshnessYear: "Past year",
			proxy: "Proxy",
			proxyPlaceholder: "Leave blank to use HTTPS_PROXY / HTTP_PROXY.",
			deepseekApiKeyEnv: "Credential reference",
			deepseekApiKeyEnvHint: "Name of the credential/env var resolved for DeepSeek search.",
			deepseekBaseURL: "Endpoint",
			deepseekBaseURLHint: "Leave blank to use the DeepSeek Anthropic-compatible API default.",
			model: "Model",
			modelHint: "Anthropic-format model name for the search request.",
			apiVersion: "API version",
			apiVersionHint: "anthropic-version header value.",
			maxTokens: "Max tokens",
			maxTokensHint: "Upper bound on generated tokens for the search request.",
			maxUses: "Max uses",
			maxUsesHint: "Maximum web_search server-tool uses per request.",
			expand: "Show settings",
			collapse: "Hide settings",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			overridden: "Overridden",
			reset: "Restore default",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			savedToast: "✓ Settings saved and applied",
			nothingToSave: "No changes to save",
			invalidToast: "Fix the highlighted fields before saving.",
			readOnly: "This deployment stores settings read-only.",
			invalidNumber: "Enter a whole number of at least 1, or leave blank for the default.",
			quotaTitle: "Quota",
			quotaPlan: "Plan {plan}",
			quotaUsed: "Used {used} / {limit}",
			quotaUsedOnly: "Used {used}",
			quotaRemaining: "{remaining} left",
			quotaUnlimited: "No published limit",
			quotaResets: "Resets {time}",
			quotaCycle: "Resets with the billing cycle",
			quotaBurst: "Burst {remaining}/{limit}",
			quotaBraveCapacity: "Capacity",
			quotaBraveRps: "{limit} requests per second",
			quotaBraveRpsWindow: "Per-second window",
			braveDefaultPlaceholder: "Leave blank for Brave's default.",
			quotaEmpty: "Usage appears after the next search.",
			quotaKeyedHint: "Keyed Tavily: local deductions vs periodic /usage, whichever is higher.",
			quotaBraveUnlimited: "No monthly request cap",
			quotaRefresh: "Refresh usage",
			quotaRefreshing: "Refreshing…",
			quotaError: "Usage unavailable: {error}",
			quotaWarn: "Remaining quota is low.",
			quotaDanger: "Remaining quota is critical.",
			quotaPaygo: "Pay-as-you-go {used}/{limit}"
		};
		/** Simplified Chinese copy. */
		const zh = {
			nav: "网页搜索",
			provider: "搜索引擎",
			providerTavily: "Tavily",
			providerBrave: "Brave Search",
			providerDeepseek: "DeepSeek（官方）",
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
			searchDepth: "搜索深度",
			searchDepthBasic: "Basic（较快）",
			searchDepthAdvanced: "Advanced（较慢、更深）",
			includeAnswer: "包含摘要回答",
			includeAnswerHint: "请求 Tavily 生成摘要回答，显示在结果上方。",
			topic: "主题",
			topicGeneral: "通用",
			topicNews: "新闻",
			country: "国家/地区",
			countryHint: "ISO 两位码（如 cn）。",
			searchLang: "搜索语言",
			searchLangHint: "如 zh-hans、en。",
			freshness: "时效",
			freshnessAny: "不限",
			freshnessDay: "过去一天",
			freshnessWeek: "过去一周",
			freshnessMonth: "过去一月",
			freshnessYear: "过去一年",
			proxy: "代理",
			proxyPlaceholder: "留空使用 HTTPS_PROXY / HTTP_PROXY环境变量",
			deepseekApiKeyEnv: "凭据引用名",
			deepseekApiKeyEnvHint: "DeepSeek 搜索解析的凭据/环境变量名。",
			deepseekBaseURL: "接口地址",
			deepseekBaseURLHint: "留空则使用 DeepSeek Anthropic 兼容 API 默认地址。",
			model: "模型",
			modelHint: "搜索请求使用的 Anthropic 格式模型名。",
			apiVersion: "API 版本",
			apiVersionHint: "anthropic-version 请求头值。",
			maxTokens: "最大 token",
			maxTokensHint: "搜索请求生成 token 的上限。",
			maxUses: "最大调用次数",
			maxUsesHint: "每次请求 web_search 服务端工具的最大调用次数。",
			expand: "展开设置",
			collapse: "收起设置",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unsaved: "未保存",
			overridden: "已覆盖",
			reset: "恢复默认",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			savedToast: "✓ 设置已保存并立即生效",
			nothingToSave: "没有需要保存的更改",
			invalidToast: "请先修正标红的字段再保存。",
			readOnly: "本部署的设置为只读。",
			invalidNumber: "请输入不小于 1 的整数；留空表示使用默认值。",
			quotaTitle: "额度",
			quotaPlan: "计划 {plan}",
			quotaUsed: "已用 {used} / {limit}",
			quotaUsedOnly: "已用 {used}",
			quotaRemaining: "剩余 {remaining}",
			quotaUnlimited: "未公布限额",
			quotaResets: "{time} 重置",
			quotaCycle: "按计费周期重置",
			quotaBurst: "突发 {remaining}/{limit}",
			quotaBraveCapacity: "容量",
			quotaBraveRps: "{limit} 次/秒",
			quotaBraveRpsWindow: "每秒窗口",
			braveDefaultPlaceholder: "留空使用 Brave 默认。",
			quotaEmpty: "下次搜索后显示用量。",
			quotaKeyedHint: "Tavily keyed：本地扣费与定时 /usage 取较高值。",
			quotaBraveUnlimited: "月请求不限额",
			quotaRefresh: "刷新额度",
			quotaRefreshing: "刷新中…",
			quotaError: "额度不可用：{error}",
			quotaWarn: "剩余额度偏低。",
			quotaDanger: "剩余额度告急。",
			quotaPaygo: "按量 {used}/{limit}"
		};

		const MAX_RESULTS_CAP = 20;
		/** A whole-number field spec: empty draft clears; non-digits block save; max is clamped. */
		function numberField(field, bounds) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (!/^[0-9]+$/u.test(trimmed)) return void 0;
					let parsed = Number(trimmed);
					if (!Number.isInteger(parsed) || parsed < 1) return void 0;
					if (bounds?.min != null && parsed < bounds.min) parsed = bounds.min;
					if (bounds?.max != null && parsed > bounds.max) parsed = bounds.max;
					return { kind: "set", value: parsed };
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
					numberField("maxResults", { min: 1, max: MAX_RESULTS_CAP }),
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
					textField("proxy"),
					textField("deepseekApiKeyEnv"),
					textField("deepseekBaseURL"),
					textField("model"),
					textField("apiVersion"),
					numberField("maxTokens", { min: 1 }),
					numberField("maxUses", { min: 1 })
				].map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.saving = false;
				this.failed = false;
				this.credential = { ref: "", configured: false, writable: true };
				this.toastKey = null;
				this.toastTimer = 0;
				this.listeners = new Set();
				const draft = readDraft();
				if (draft?.staged) {
					for (const [field, edit] of Object.entries(draft.staged)) {
						if (!this.specs.has(field) || edit === null || typeof edit !== "object") continue;
						this.staged.set(field, { text: String(edit.text ?? ""), clear: edit.clear === true });
					}
					if (draft.failed === true) this.failed = true;
				}
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
					failed: this.failed,
					toastKey: this.toastKey
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
			showToast(key) {
				this.toastKey = key;
				if (this.toastTimer) clearTimeout(this.toastTimer);
				this.toastTimer = setTimeout(() => {
					this.toastKey = null;
					this.toastTimer = 0;
					this.publish();
				}, 2500);
				this.publish();
			}
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (this.saving) return;
				if (plan.length === 0) {
					this.showToast("nothing");
					return;
				}
				if (writes.length !== plan.length) {
					this.showToast("invalid");
					return;
				}
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				try {
					for (const write of writes) landed = await write() && landed;
				} catch (_saveFailure) {
					landed = false;
				}
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.showToast(landed ? "saved" : "failed");
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
				try {
					await this.scope.unset(field);
					return true;
				} catch (_clearFailure) {
					return false;
				}
			}
			async store(field, value) {
				try {
					await this.scope.set(field, value);
					return true;
				} catch (_storeFailure) {
					return false;
				}
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
				if (field === "provider" || field === "apiKeyEnv" || field === "braveApiKeyEnv" || field === "deepseekApiKeyEnv") this.readCredential();
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
				writeDraft(this);
				for (const listener of this.listeners) listener();
			}
			/** Draft-aware engine: staged `provider` wins over the saved section. */
			providerOf() {
				const staged = this.staged.get("provider");
				if (staged !== void 0 && !staged.clear && staged.text.trim() !== "") return staged.text.trim();
				const declared = this.sectionValue("provider");
				return declared === "brave" || declared === "deepseek-official" ? declared : "tavily";
			}
			tavilyRef() {
				const declared = this.sectionValue("apiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_TAVILY_KEY_REF;
			}
			braveRef() {
				const declared = this.sectionValue("braveApiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_BRAVE_KEY_REF;
			}
			deepseekRef() {
				const declared = this.sectionValue("deepseekApiKeyEnv");
				return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_DEEPSEEK_KEY_REF;
			}
			/** The credential reference the currently visible engine uses. */
			refOf() {
				const provider = this.providerOf();
				return provider === "brave" ? this.braveRef() : provider === "deepseek-official" ? this.deepseekRef() : this.tavilyRef();
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
				const ref = field === BRAVE_API_KEY_FIELD ? this.braveRef() : field === DEEPSEEK_API_KEY_FIELD ? this.deepseekRef() : this.tavilyRef();
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
					deepseekApiKey: this.form.field(DEEPSEEK_API_KEY_FIELD),
					deepseekApiKeyEnv: this.form.field("deepseekApiKeyEnv"),
					deepseekBaseURL: this.form.field("deepseekBaseURL"),
					model: this.form.field("model"),
					apiVersion: this.form.field("apiVersion"),
					maxTokens: this.form.field("maxTokens"),
					maxUses: this.form.field("maxUses"),
					apiKeyConfigured: this.form.credential.configured,
					apiKeyWritable: this.form.credential.writable,
					toastKey: this.form.toastKey
				};
			}
			inject() {
				return {
					hooks: { pluginSearchCard: this.store },
					...this.form.actions()
				};
			}
		};

		/** Row style: one labelled field with optional override badge and restore-default. */
		const fieldRow = (label, hint, children, meta) => react.createElement("div", { className: "dshws_field" },
			react.createElement("div", { className: "dshws_field_head" },
				react.createElement("label", { className: "dshws_field_label" }, label),
				meta?.overridden ? react.createElement("span", { className: "dshws_field_badges" },
					react.createElement("span", { className: "dshws_badge" }, meta.t("overridden")),
					react.createElement("button", { type: "button", className: "dshws_reset", disabled: meta.disabled === true, onClick: meta.onReset }, meta.t("reset"))) : null),
			children,
			meta?.invalid ? react.createElement("p", { className: "dshws_field_error" }, meta.t("invalidNumber")) : hint ? react.createElement("p", { className: "dshws_field_hint" }, hint) : null);
		const pair = (left, right) => {
			if (!left && !right) return null;
			if (!left) return right;
			if (!right) return left;
			return react.createElement("div", { className: "dshws_pair" }, left, right);
		};
		const controlStyle = { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", font: "inherit", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", lineHeight: "1.5", width: "100%", boxSizing: "border-box" };
		const textInput = (props) => react.createElement("input", { style: controlStyle, type: "text", ...props });
		const numberInput = (props) => react.createElement("input", {
			style: controlStyle,
			type: "text",
			inputMode: "numeric",
			pattern: "[0-9]*",
			autoComplete: "off",
			...props,
			onChange: (event) => {
				props.onChange?.({ target: { value: String(event.target.value ?? "").replace(/\D/g, "") } });
			}
		});
		const secretInput = (props) => react.createElement("input", { style: controlStyle, type: "password", autoComplete: "off", ...props });
		const selectInput = (props) => react.createElement("select", { style: controlStyle, ...props });
		const checkboxInput = (props) => react.createElement("input", { type: "checkbox", style: { width: "16px", height: "16px", accentColor: "var(--dsw-alias-brand-primary)" }, ...props });

		const CSS_ID = "dsh-web-search-plugin/styles.css#maxresults";
		const GLOBE_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zM2.1 8.75h2.55c.12 1.58.48 3 1 4.12A6.02 6.02 0 0 1 2.1 8.75zm8.25 4.12c.52-1.12.88-2.54 1-4.12H13.9a6.02 6.02 0 0 1-3.55 4.12zM13.9 7.25h-2.55c-.12-1.58-.48-3-1-4.12A6.02 6.02 0 0 1 13.9 7.25zM5.65 3.13c-.52 1.12-.88 2.54-1 4.12H2.1a6.02 6.02 0 0 1 3.55-4.12zM8 2.2c.82 1.12 1.36 2.82 1.5 4.95H6.5C6.64 5.02 7.18 3.32 8 2.2zm0 11.6c-.82-1.12-1.36-2.82-1.5-4.95h3C9.36 10.98 8.82 12.68 8 13.8z'/%3E%3C/svg%3E\") 50%/contain no-repeat";
		if (typeof document !== "undefined") {
			for (const old of document.querySelectorAll('style[data-plugin="dsh-web-search-plugin"]')) old.remove();
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-search-plugin";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				"@keyframes dshws-toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
				".dshws_quota{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;margin:4px 0 8px}",
				".dshws_quota_head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}",
				".dshws_quota_title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".dshws_quota_pct{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);background:transparent;border:none;padding:0;font:inherit;font-weight:600;cursor:pointer}",
				".dshws_quota_pct:disabled{cursor:wait;opacity:.7}",
				".dshws_quota_track{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,0.14));overflow:hidden}",
				".dshws_quota_fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#10b981);transition:width .2s ease}",
				".dshws_quota_fill_warning{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshws_quota_fill_danger{background:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshws_quota_meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
				".dshws_quota_hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.45;margin:0}",
				".dshws_quota_alert{font-size:11.5px;margin:0;line-height:1.45}",
				".dshws_quota_alert_warning{color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
				".dshws_quota_alert_danger{color:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshws_btn{appearance:none;font:inherit;cursor:pointer;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;display:inline-flex;align-items:center;justify-content:center;transition:filter .15s ease,opacity .15s ease}",
				".dshws_btn:disabled{cursor:not-allowed;opacity:.45}",
				".dshws_btn_primary{border:1px solid transparent;color:var(--dsw-alias-label-on-brand,#fff);background:var(--dsw-alias-bg-brand-solid,var(--dsw-alias-brand-primary,#3b82f6));font-weight:600}",
				".dshws_btn_primary:hover:not(:disabled){filter:brightness(1.08)}",
				".dshws_btn_outline{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}",
				".dshws_toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-state-success-primary,#10b981);color:#fff;padding:8px 18px;border-radius:999px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.3));font-size:12.5px;font-weight:500;z-index:100000;animation:dshws-toast-in .2s ease-out}",
				".dshws_toast_error{background:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshws_toast_info{background:var(--dsw-alias-label-secondary,#6b7280)}",
				".dshws_card_header{display:flex;align-items:flex-start;gap:12px;padding:6px 0 2px}",
				".dshws_card_headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
				".dshws_card_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
				".dshws_card_desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
				".dshws_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,0.12));color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
				".dshws_form{display:flex;flex-direction:column;gap:0}",
				".dshws_field{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);min-width:0}",
				".dshws_field_head{display:flex;align-items:center;gap:8px}",
				".dshws_field_label{min-width:0;flex:1;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}",
				".dshws_field_badges{display:inline-flex;align-items:center;gap:8px;flex:none}",
				".dshws_field_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.45}",
				".dshws_field_error{color:var(--dsw-alias-state-error-primary,#ef4444)!important;margin:0;font-size:12px;line-height:1.45;font-weight:500}",
				".dshws_pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:12px;border-top:1px solid var(--dsw-alias-border-l2)}",
				".dshws_pair>.dshws_field{border-top:none;padding:10px 0}",
				".dshws_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,0.12));color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
				".dshws_reset{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;padding:0;font-size:12px;line-height:1.5}",
				".dshws_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
				".dshws_reset:disabled{cursor:default;opacity:.45}",
				".dshws_input_invalid{border-color:var(--dsw-alias-state-error-primary,#ef4444)!important}",
				"[data-dshws-nav]>[class*='_navIcon']{display:none}",
				"[data-dshws-nav]:before{content:'';background:currentColor;flex:none;width:16px;height:16px;-webkit-mask:" + GLOBE_MASK + ";mask:" + GLOBE_MASK + "}"
			].join("\n");
			document.head.appendChild(tag);
		}

		function interpolate(template, vars) {
			return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => vars[key] == null ? "" : String(vars[key]));
		}
		function tFill(t, key, vars) {
			return interpolate(t(key), vars);
		}
		function formatResetTime(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "—";
			const date = new Date(ms);
			return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
		}
		function usedPercent(used, limit) {
			if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return 0;
			return Math.max(0, Math.min(100, (100 * used) / limit));
		}
		function remainingLevel(used, limit) {
			if (!Number.isFinite(limit) || limit <= 0) return "unknown";
			const remainingPct = Math.max(0, (100 * (limit - used)) / limit);
			if (remainingPct <= 10) return "danger";
			if (remainingPct <= 20) return "warning";
			return "success";
		}

		const USAGE_POLL_MS = 15000;
		function createUsageClientStore() {
			let snap = { status: "idle", payload: null, refreshing: false };
			const listeners = new Set();
			const publish = () => {
				for (const listener of listeners) listener();
			};
			const load = async (force) => {
				if (force) {
					snap = { ...snap, refreshing: true };
					publish();
				}
				try {
					const response = await fetch(force ? "/dsh-web-search/usage?force=1" : "/dsh-web-search/usage", { cache: "no-store" });
					const payload = await response.json();
					snap = { status: "ok", payload, refreshing: false };
				} catch (error) {
					snap = { status: "error", payload: snap.payload, refreshing: false, error: String(error?.message ?? error) };
				}
				publish();
				return snap;
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				getSnapshot() {
					return snap;
				},
				refresh: () => load(true),
				start() {
					void load(true);
					const timer = setInterval(() => {
						void load(false);
					}, USAGE_POLL_MS);
					return () => clearInterval(timer);
				}
			};
		}
		const usageStore = createUsageClientStore();

		function QuotaBar(props) {
			const { name, used, limit, remainingText, resetText, level, onRefresh, refreshing, t, extra } = props;
			const pct = usedPercent(used, limit);
			const hasLimit = Number.isFinite(limit) && limit > 0;
			const fillClass = "dshws_quota_fill" + (level === "danger" ? " dshws_quota_fill_danger" : level === "warning" ? " dshws_quota_fill_warning" : "");
			return react.createElement("div", { className: "dshws_quota" },
				react.createElement("div", { className: "dshws_quota_head" },
					react.createElement("span", { className: "dshws_quota_title" }, name),
					react.createElement("button", {
						type: "button",
						className: "dshws_quota_pct",
						disabled: refreshing,
						title: refreshing ? t("quotaRefreshing") : t("quotaRefresh"),
						onClick: onRefresh
					}, hasLimit ? Math.round(pct) + "%" : (Number.isFinite(used) && used > 0 ? String(used) : "—"))),
				react.createElement("div", { className: "dshws_quota_track" },
					react.createElement("div", { className: fillClass, style: { width: (hasLimit ? pct : 0) + "%" } })),
				react.createElement("div", { className: "dshws_quota_meta" },
					react.createElement("span", null, remainingText),
					react.createElement("span", null, resetText)),
				level === "warning" || level === "danger"
					? react.createElement("p", { className: "dshws_quota_alert dshws_quota_alert_" + level }, t(level === "danger" ? "quotaDanger" : "quotaWarn"))
					: null,
				extra);
		}

		function QuotaCard(props) {
			const { t, provider, keyed } = props;
			const usage = react.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot);
			const showTavily = provider === "tavily" && keyed;
			const showBrave = provider === "brave";
			if (!showTavily && !showBrave) return null;
			const payload = usage.payload;
			const refreshing = usage.refreshing === true;
			const onRefresh = (event) => {
				event.preventDefault();
				void usageStore.refresh();
			};
			if (showTavily) {
				const info = payload?.tavily;
				const error = info?.error || (usage.status === "error" ? usage.error : null);
				if (!info || info.fetchedAt === 0 && info.used === 0 && !error) {
					return react.createElement("div", { className: "dshws_quota" },
						react.createElement("div", { className: "dshws_quota_head" },
							react.createElement("span", { className: "dshws_quota_title" }, t("quotaTitle")),
							react.createElement("button", { type: "button", className: "dshws_quota_pct", disabled: refreshing, onClick: onRefresh }, refreshing ? t("quotaRefreshing") : t("quotaRefresh"))),
						react.createElement("p", { className: "dshws_quota_hint" }, t("quotaEmpty")),
						react.createElement("p", { className: "dshws_quota_hint" }, t("quotaKeyedHint")));
				}
				const used = Number(info.used) || 0;
				const limit = info.limit;
				const remaining = info.remaining;
				const level = remainingLevel(used, limit);
				const name = info.plan ? tFill(t, "quotaPlan", { plan: info.plan }) : t("quotaTitle");
				const remainingText = Number.isFinite(limit) && limit > 0
					? tFill(t, "quotaUsed", { used, limit }) + " · " + tFill(t, "quotaRemaining", { remaining: remaining ?? Math.max(0, limit - used) })
					: used > 0
						? tFill(t, "quotaUsedOnly", { used }) + " · " + t("quotaUnlimited")
						: t("quotaUnlimited");
				return react.createElement(QuotaBar, {
						name,
						used,
						limit,
						remainingText,
						resetText: t("quotaCycle"),
						level,
						onRefresh,
						refreshing,
						t,
						extra: [
							info.paygoUsed > 0 ? react.createElement("p", { className: "dshws_quota_hint", key: "paygo" }, tFill(t, "quotaPaygo", { used: info.paygoUsed, limit: info.paygoLimit ?? "—" })) : null,
							error ? react.createElement("p", { className: "dshws_quota_hint", key: "err" }, tFill(t, "quotaError", { error })) : react.createElement("p", { className: "dshws_quota_hint", key: "hint" }, t("quotaKeyedHint"))
						]
					});
			}
			const brave = payload?.brave;
			const monthly = brave?.monthly;
			const burst = brave?.burst;
			if (!monthly && !burst) {
				return react.createElement("div", { className: "dshws_quota" },
					react.createElement("span", { className: "dshws_quota_title" }, t("quotaTitle")),
					react.createElement("p", { className: "dshws_quota_hint" }, t("quotaEmpty")));
			}
			const monthlyCapped = Number.isFinite(monthly?.limit) && monthly.limit > 0;
			const primary = monthlyCapped ? monthly : (burst ?? monthly);
			const used = Number(primary.used) || 0;
			const limit = primary.limit;
			const remaining = primary.remaining;
			const level = remainingLevel(used, limit);
			return react.createElement(QuotaBar, {
					name: monthlyCapped ? t("quotaTitle") : t("quotaBraveCapacity"),
					used,
					limit,
					remainingText: monthlyCapped
						? tFill(t, "quotaUsed", { used, limit }) + " · " + tFill(t, "quotaRemaining", { remaining: remaining ?? Math.max(0, limit - used) })
						: tFill(t, "quotaBraveRps", { limit: limit ?? 0 }) + " · " + tFill(t, "quotaRemaining", { remaining: remaining ?? 0 }),
					resetText: monthlyCapped
						? tFill(t, "quotaResets", { time: formatResetTime(monthly.resetAt) })
						: t("quotaBraveUnlimited") + (monthly?.resetAt ? " · " + tFill(t, "quotaResets", { time: formatResetTime(monthly.resetAt) }) : ""),
					level,
					onRefresh,
					refreshing,
					t,
					extra: monthlyCapped && burst
						? react.createElement("p", { className: "dshws_quota_hint", key: "burst" }, tFill(t, "quotaBurst", { remaining: burst.remaining, limit: burst.limit }))
						: null
				});
		}

		function toastCopy(t, key) {
			if (key === "saved") return t("savedToast");
			if (key === "nothing") return t("nothingToSave");
			if (key === "invalid") return t("invalidToast");
			if (key === "failed") return t("saveFailed");
			return "";
		}

		/** Render the provider selector plus the backend-specific staged form. */
		function WebSearchCard(props) {
			const { t, state, actions } = props;
			if (!state.available) return null;
			const disabled = !state.writable;
			const provider = state.provider.text === "brave" ? "brave" : state.provider.text === "deepseek-official" ? "deepseek-official" : "tavily";
			const brave = provider === "brave";
			const deepseek = provider === "deepseek-official";
			const keyed = state.mode.text === "keyed";
			const toastText = toastCopy(t, state.toastKey);
			const toastTone = state.toastKey === "failed" || state.toastKey === "invalid" ? "error" : state.toastKey === "nothing" ? "info" : "success";
			const row = (field, label, hint, children) => fieldRow(label, hint, children, {
				t,
				overridden: state[field]?.overridden === true,
				invalid: state[field]?.invalid === true,
				disabled,
				onReset: () => actions.resetField(field)
			});
			const maxResultsWrite = numberField("maxResults", { min: 1, max: MAX_RESULTS_CAP }).parse(String(state.maxResults.text ?? "").trim());
			const maxResultsValue = maxResultsWrite?.kind === "set" ? String(maxResultsWrite.value) : "8";
			const maxResultsRow = row("maxResults", t("maxResults"), null, selectInput({
				id: "ws-max",
				value: maxResultsValue,
				disabled,
				className: state.maxResults.invalid ? "dshws_input_invalid" : void 0,
				onChange: (e) => actions.edit("maxResults", e.target.value),
				children: Array.from({ length: MAX_RESULTS_CAP }, (_, index) => {
					const n = String(index + 1);
					return react.createElement("option", { value: n, key: n }, n);
				})
			}));
			return react.createElement("div", { className: "dshws_form" },
				react.createElement("div", { className: "dshws_card_header" },
					react.createElement("div", { className: "dshws_card_headText" },
						react.createElement("span", { className: "dshws_card_name" }, t("nav"))),
					state.dirty || state.failed ? react.createElement("span", { className: "dshws_pending" }, t("unsaved")) : null),
				!state.writable ? react.createElement("p", { className: "dshws_field_hint", style: { padding: "8px 0 0" } }, t("readOnly")) : null,
				pair(
					row("provider", t("provider"), null, selectInput({ id: "ws-provider", value: provider, disabled, onChange: (e) => actions.edit("provider", e.target.value), children: [
						react.createElement("option", { value: "tavily", key: "tavily" }, t("providerTavily")),
						react.createElement("option", { value: "brave", key: "brave" }, t("providerBrave")),
						react.createElement("option", { value: "deepseek-official", key: "deepseek-official" }, t("providerDeepseek"))
					] })),
					deepseek || brave ? null : row("mode", t("mode"), null, selectInput({ id: "ws-mode", value: state.mode.text, disabled, onChange: (e) => actions.edit("mode", e.target.value), children: [
						react.createElement("option", { value: "keyless", key: "keyless" }, t("modeKeyless")),
						react.createElement("option", { value: "keyed", key: "keyed" }, t("modeKeyed"))
					] }))
				),
				react.createElement(QuotaCard, { t, provider, keyed }),
				deepseek ? pair(
					fieldRow(t("apiKey"), t("apiKeyHint"), secretInput({ id: "ws-deepseek-key", value: state.deepseekApiKey.text, disabled: !state.apiKeyWritable, placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onChange: (e) => actions.edit(DEEPSEEK_API_KEY_FIELD, e.target.value) })),
					row("deepseekApiKeyEnv", t("deepseekApiKeyEnv"), t("deepseekApiKeyEnvHint"), textInput({ id: "ws-deepseek-keyref", value: state.deepseekApiKeyEnv.text, disabled, onChange: (e) => actions.edit("deepseekApiKeyEnv", e.target.value) }))
				) : null,
				brave ? pair(
					fieldRow(t("apiKey"), t("apiKeyHint"), secretInput({ id: "ws-brave-key", value: state.braveApiKey.text, disabled: !state.apiKeyWritable, placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onChange: (e) => actions.edit(BRAVE_API_KEY_FIELD, e.target.value) })),
					row("braveApiKeyEnv", t("braveApiKeyEnv"), t("braveApiKeyEnvHint"), textInput({ id: "ws-brave-keyref", value: state.braveApiKeyEnv.text, disabled, onChange: (e) => actions.edit("braveApiKeyEnv", e.target.value) }))
				) : null,
				(!brave && !deepseek && keyed) ? pair(
					fieldRow(t("apiKey"), t("apiKeyHint"), secretInput({ id: "ws-tavily-key", value: state.apiKey.text, disabled: !state.apiKeyWritable, placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onChange: (e) => actions.edit(TAVILY_API_KEY_FIELD, e.target.value) })),
					row("apiKeyEnv", t("apiKeyEnv"), t("apiKeyEnvHint"), textInput({ id: "ws-tavily-keyref", value: state.apiKeyEnv.text, disabled, onChange: (e) => actions.edit("apiKeyEnv", e.target.value) }))
				) : null,
				deepseek ? row("deepseekBaseURL", t("deepseekBaseURL"), t("deepseekBaseURLHint"), textInput({ id: "ws-deepseek-base", value: state.deepseekBaseURL.text, disabled, onChange: (e) => actions.edit("deepseekBaseURL", e.target.value) })) : null,
				brave ? row("braveBaseURL", t("braveBaseURL"), t("braveBaseURLHint"), textInput({ id: "ws-brave-base", value: state.braveBaseURL.text, disabled, onChange: (e) => actions.edit("braveBaseURL", e.target.value) })) : null,
				(!brave && !deepseek) ? row("baseURL", t("baseURL"), t("baseURLHint"), textInput({ id: "ws-tavily-base", value: state.baseURL.text, disabled, onChange: (e) => actions.edit("baseURL", e.target.value) })) : null,
				deepseek ? pair(
					row("model", t("model"), t("modelHint"), textInput({ id: "ws-model", value: state.model.text, disabled, onChange: (e) => actions.edit("model", e.target.value) })),
					row("apiVersion", t("apiVersion"), t("apiVersionHint"), textInput({ id: "ws-apiversion", value: state.apiVersion.text, disabled, onChange: (e) => actions.edit("apiVersion", e.target.value) }))
				) : null,
				deepseek ? pair(
					row("maxTokens", t("maxTokens"), t("maxTokensHint"), numberInput({ id: "ws-maxtokens", value: state.maxTokens.text, disabled, onChange: (e) => actions.edit("maxTokens", e.target.value), className: state.maxTokens.invalid ? "dshws_input_invalid" : void 0 })),
					row("maxUses", t("maxUses"), t("maxUsesHint"), numberInput({ id: "ws-maxuses", value: state.maxUses.text, disabled, onChange: (e) => actions.edit("maxUses", e.target.value), className: state.maxUses.invalid ? "dshws_input_invalid" : void 0 }))
				) : null,
				(!brave && !deepseek) ? pair(
					row("searchDepth", t("searchDepth"), null, selectInput({ id: "ws-depth", value: state.searchDepth.text, disabled, onChange: (e) => actions.edit("searchDepth", e.target.value), children: [
						react.createElement("option", { value: "basic", key: "basic" }, t("searchDepthBasic")),
						react.createElement("option", { value: "advanced", key: "advanced" }, t("searchDepthAdvanced"))
					] })),
					row("topic", t("topic"), null, selectInput({ id: "ws-topic", value: state.topic.text, disabled, onChange: (e) => actions.edit("topic", e.target.value), children: [
						react.createElement("option", { value: "general", key: "general" }, t("topicGeneral")),
						react.createElement("option", { value: "news", key: "news" }, t("topicNews"))
					] }))
				) : null,
				(!brave && !deepseek) ? pair(
					row("includeAnswer", t("includeAnswer"), t("includeAnswerHint"), checkboxInput({ id: "ws-answer", checked: state.includeAnswer.text === "true", disabled, onChange: (e) => actions.edit("includeAnswer", e.target.checked ? "true" : "") })),
					maxResultsRow
				) : null,
				brave ? pair(
					row("country", t("country"), t("countryHint"), textInput({ id: "ws-country", value: state.country.text, disabled, placeholder: t("braveDefaultPlaceholder"), onChange: (e) => actions.edit("country", e.target.value) })),
					row("searchLang", t("searchLang"), t("searchLangHint"), textInput({ id: "ws-lang", value: state.searchLang.text, disabled, placeholder: t("braveDefaultPlaceholder"), onChange: (e) => actions.edit("searchLang", e.target.value) }))
				) : null,
				brave ? pair(
					row("freshness", t("freshness"), null, selectInput({ id: "ws-freshness", value: state.freshness.text, disabled, onChange: (e) => actions.edit("freshness", e.target.value), children: [
						react.createElement("option", { value: "", key: "any" }, t("freshnessAny")),
						react.createElement("option", { value: "pd", key: "pd" }, t("freshnessDay")),
						react.createElement("option", { value: "pw", key: "pw" }, t("freshnessWeek")),
						react.createElement("option", { value: "pm", key: "pm" }, t("freshnessMonth")),
						react.createElement("option", { value: "py", key: "py" }, t("freshnessYear"))
					] })),
					maxResultsRow
				) : null,
				brave ? row("proxy", t("proxy"), null, textInput({ id: "ws-proxy", value: state.proxy.text, disabled, placeholder: t("proxyPlaceholder"), onChange: (e) => actions.edit("proxy", e.target.value) })) : null,
				deepseek ? maxResultsRow : null,
				react.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", justifyContent: "flex-end", alignItems: "center", gap: "8px", padding: "12px 0 4px", display: "flex" } },
					react.createElement("button", {
						type: "button",
						className: "dshws_btn dshws_btn_outline",
						disabled: (!state.dirty && !state.failed) || state.saving,
						onClick: (event) => {
							event.preventDefault();
							actions.discard();
						}
					}, t("discard")),
					react.createElement("button", {
						type: "button",
						className: "dshws_btn dshws_btn_primary",
						disabled: state.saving || !state.writable,
						onClick: (event) => {
							event.preventDefault();
							void actions.save();
						}
					}, t(state.saving ? "saving" : "save"))),
				toastText ? react.createElement("div", { className: "dshws_toast" + (toastTone === "error" ? " dshws_toast_error" : toastTone === "info" ? " dshws_toast_info" : ""), role: "status" }, toastText) : null);
		}

		/** Section component: the "Web search" page body, driven by useSyncExternalStore. */
		function makeSection(ctx, controller) {
			return function WebSearchSection() {
				const state = react.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
				const t = ctx.locale.bind(NS);
				if (!state.available) return react.createElement("p", { style: { padding: "16px" } }, t("readOnly"));
				return react.createElement("div", { style: { padding: "16px" } },
					react.createElement("div", { style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: "12px", padding: "4px 16px" } },
						react.createElement(WebSearchCard, { t: t, state: state, actions: controller.form.actions() })));
			};
		}

		function syncSettingsNavIcon() {
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
			const lists = document.querySelectorAll("[class*='_navList']");
			for (const list of lists) {
				const cells = list.querySelectorAll(":scope > [class*='_navCell']");
				for (const cell of cells) {
					const text = String(cell.textContent ?? "").replace(/\s+/g, " ").trim();
					if (text === "网页搜索" || text === "Web search") cell.setAttribute("data-dshws-nav", "web-search");
					else cell.removeAttribute("data-dshws-nav");
				}
			}
		}
		function startSettingsNavIconSync() {
			if (typeof document === "undefined") return () => {};
			const run = () => {
				try { syncSettingsNavIcon(); } catch { /* settings sheet not mounted yet */ }
			};
			run();
			if (typeof MutationObserver !== "function") return () => {};
			const root = document.body || document.documentElement;
			if (!root) return () => {};
			const observer = new MutationObserver(run);
			observer.observe(root, { childList: true, subtree: true, characterData: true });
			return () => observer.disconnect();
		}

		/** Mount the top-level "Web search" settings section. */
		function apply(ctx) {
			const { api } = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-web-search-plugin: card dictionaries");
			const controller = new SearchCardController(ctx.settingsScope.bind({ namespace: NS }), api);
			ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => {
				controller.form.refreshCredential(ref);
			}), "dsh-web-search-plugin: credential invalidations");
			ctx.effect(() => usageStore.start(), "dsh-web-search-plugin: usage poll");
			ctx.effect(() => startSettingsNavIconSync(), "dsh-web-search-plugin: settings nav icon");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "web-search",
				order: 10,
				label: () => t("nav"),
				locale: NS
			}, makeSection(ctx, controller)));
		}

		const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
