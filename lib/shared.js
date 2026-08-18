/**
 * Shared abort / credential helpers for the Tavily and Brave backends.
 * @module dsh-web-search-plugin/shared
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";

/** Attribution header sent on every request. */
export const USER_AGENT = "dsh-web-search-plugin/0.2.1";
/** Shared cap: Tavily `max_results` and Brave `count` both accept 1..20. */
export const MAX_RESULTS_CAP = 20;

/**
 * Resolve one secret without retaining it: literal config, credentials
 * service, launching environment, then `process.env`.
 * @param ctx - plugin context.
 * @param config - section fields naming the literal and the env/credential ref.
 * @returns the snapshot used by one search.
 */
export function resolveSecret(ctx, config) {
	const envName = config.envName;
	const apiKeyEnv = credentialRef(envName);
	const literal = config.literal !== void 0 && config.literal.length > 0 ? config.literal : void 0;
	return {
		...literal === void 0 ? {} : { apiKey: literal },
		apiKeyEnv,
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) {
				const stored = (await credentials.resolve(apiKeyEnv))?.value;
				if (stored !== void 0 && stored.length > 0) return stored;
			}
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			if (ambient !== void 0 && ambient.value.length > 0) return ambient.value;
			const raw = process.env[apiKeyEnv];
			return typeof raw === "string" && raw.length > 0 ? raw : void 0;
		}
	};
}

/** Race a same-process asynchronous preflight against caller cancellation. */
export function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
export function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
export function searchAborted(signal, fallback) {
	return new WebError("Search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
export function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}

/** True for positive integers (result counts and request bounds). */
export function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}

/**
 * Resolve one operation's credential without retaining it on the provider.
 * @param options - the caller's snapshot.
 * @param signal - abort signal for the surrounding search.
 * @param missingMessage - thrown when no key can be resolved.
 * @returns the resolved key.
 */
export async function resolveApiKey(options, signal, missingMessage) {
	throwIfSearchAborted(signal);
	if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
	let resolved;
	try {
		resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
	} catch (error) {
		if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
		throw new WebError(`Search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
	}
	if (resolved !== void 0 && resolved.length > 0) return resolved;
	throw new WebError(missingMessage, "WEB_PROVIDER_CREDENTIAL_MISSING");
}
