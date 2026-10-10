/** Supplier-specific configuration names and their pre-prefix aliases. */
export const SUPPLIER_CONFIG_ALIASES = {
	tavilyApiKey: "apiKey",
	tavilyApiKeyEnv: "apiKeyEnv",
	tavilyBaseURL: "baseURL",
	tavilyMode: "mode",
	tavilySearchDepth: "searchDepth",
	tavilyIncludeAnswer: "includeAnswer",
	tavilyTopic: "topic",
	deepseekModel: "model",
	deepseekApiVersion: "apiVersion",
	deepseekMaxTokens: "maxTokens",
	deepseekMaxUses: "maxUses",
	braveCountry: "country",
	braveSearchLang: "searchLang",
	braveFreshness: "freshness",
	braveProxy: "proxy",
	scavioCountry: "country",
	scavioSearchLang: "searchLang"
};

/** Explicit new values, including false and empty strings, override old names. */
export function resolveSupplierConfig(config) {
	const resolved = { ...config };
	for (const [field, legacy] of Object.entries(SUPPLIER_CONFIG_ALIASES)) {
		resolved[field] = config[field] ?? config[legacy];
	}
	return resolved;
}
