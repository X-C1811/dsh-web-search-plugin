/**
 * Local usage cache for Tavily keyed searches and Brave rate-limit headers.
 *
 * Tavily: each keyed search sends `include_usage` and adds those credits to a
 * high-water local counter. A slower `GET /usage` poll supplies plan name /
 * plan_limit and the vendor's own used count. Displayed used is
 * `max(local, remote)`. A drop in remote used, or a plan/limit change, is
 * treated as a new billing cycle (local resets to remote).
 *
 * Brave: there is no usage endpoint. Limit / remaining / reset come from
 * `X-RateLimit-*` on each search response and are cached as-is.
 *
 * @module dsh-web-search-plugin/usage
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { USER_AGENT, resolveApiKey } from "./shared.js";

/** Persist path under `$DSH_HOME/storages`. */
export const USAGE_FILE = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "storages", "dsh-web-search-usage.json");
/** Tavily `/usage` is itself rate-limited (~10 / 10 min); poll slower than that. */
export const TAVILY_USAGE_POLL_MS = 10 * 60 * 1000;
/** Coalesce disk writes. */
const SAVE_DEBOUNCE_MS = 800;

/** Finite non-negative number, otherwise `fallback`. */
function num(value, fallback = 0) {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Finite number or `null` (Tavily `key.limit` is null when unlimited). */
function numOrNull(value) {
	if (value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Split `1, 15000` style Brave headers into numbers. */
function csvNumbers(header) {
	if (header == null || header === "") return [];
	return String(header).split(",").map((part) => Number(part.trim())).filter((n) => Number.isFinite(n));
}

/**
 * Parse Brave `X-RateLimit-Policy` (`1;w=1, 15000;w=2592000`) into
 * `{ limit, windowSec }[]` aligned with Limit / Remaining / Reset by index.
 */
export function parseBravePolicy(header) {
	if (header == null || header === "") return [];
	return String(header).split(",").flatMap((part) => {
		const match = part.trim().match(/^(\d+)\s*;\s*w\s*=\s*(\d+)$/u);
		if (match === null) return [];
		return [{ limit: Number(match[1]), windowSec: Number(match[2]) }];
	});
}

/**
 * Project Brave rate-limit headers into burst + monthly windows.
 * Monthly is the largest window (≥ 1 day); burst is the smallest (≤ 60s).
 * Brave documents monthly `limit: 0` as unlimited — not “zero quota left”.
 */
export function parseBraveRateLimitHeaders(headers) {
	const get = typeof headers.get === "function"
		? (name) => headers.get(name)
		: (name) => headers[name] ?? headers[name.toLowerCase()];
	const policy = parseBravePolicy(get("x-ratelimit-policy"));
	const limits = csvNumbers(get("x-ratelimit-limit"));
	const remaining = csvNumbers(get("x-ratelimit-remaining"));
	const reset = csvNumbers(get("x-ratelimit-reset"));
	const count = Math.max(policy.length, limits.length, remaining.length, reset.length);
	if (count === 0) return null;
	const now = Date.now();
	const windows = [];
	for (let i = 0; i < count; i++) {
		const windowSec = policy[i]?.windowSec ?? (i === 0 ? 1 : 2_592_000);
		const limit = policy[i]?.limit ?? limits[i];
		const left = remaining[i];
		const resetSec = reset[i];
		if (!Number.isFinite(limit) || !Number.isFinite(left)) continue;
		const unlimited = limit === 0;
		windows.push({
			limit,
			remaining: unlimited ? null : Math.max(0, left),
			used: unlimited ? null : Math.max(0, limit - Math.max(0, left)),
			unlimited,
			windowSec,
			resetAt: Number.isFinite(resetSec) ? now + Math.max(0, resetSec) * 1000 : null
		});
	}
	if (windows.length === 0) return null;
	const monthly = windows.reduce((best, item) => item.windowSec > best.windowSec ? item : best);
	const burst = windows.find((item) => item.windowSec <= 60 && item !== monthly) ?? (monthly.windowSec <= 60 ? monthly : null);
	return {
		monthly: monthly.windowSec > 60 ? monthly : windows[windows.length - 1],
		burst: burst !== null && burst.windowSec <= 60 ? burst : null,
		fetchedAt: now
	};
}

/** Normalize Tavily `GET /usage` into plan-level used/limit. */
export function parseTavilyUsageBody(body) {
	if (body === null || typeof body !== "object") return null;
	const account = body.account !== null && typeof body.account === "object" ? body.account : null;
	const key = body.key !== null && typeof body.key === "object" ? body.key : null;
	if (account === null && key === null) return null;
	const acc = account ?? {};
	const ky = key ?? {};
	const plan = typeof acc.current_plan === "string" && acc.current_plan.length > 0 ? acc.current_plan : null;
	const limit = numOrNull(acc.plan_limit) ?? numOrNull(ky.limit);
	const hasPlanUsage = acc.plan_usage != null;
	const hasKeyUsage = ky.usage != null;
	if (plan == null && limit == null && !hasPlanUsage && !hasKeyUsage) return null;
	const remoteUsed = Math.max(hasPlanUsage ? num(acc.plan_usage) : 0, hasKeyUsage ? num(ky.usage) : 0);
	return {
		plan,
		limit,
		remoteUsed,
		keyUsed: numOrNull(ky.usage),
		keyLimit: numOrNull(ky.limit),
		paygoUsed: numOrNull(acc.paygo_usage),
		paygoLimit: numOrNull(acc.paygo_limit)
	};
}

/** Credits charged for one Tavily search (`include_usage` body). */
export function parseTavilySearchCredits(body) {
	const credits = Number(body?.usage?.credits);
	return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

/** Empty persisted shape. */
function emptyState() {
	return {
		version: 1,
		tavily: {
			plan: null,
			limit: null,
			localUsed: 0,
			remoteUsed: 0,
			used: 0,
			fetchedAt: 0,
			error: null
		},
		brave: {
			monthly: null,
			burst: null,
			fetchedAt: 0,
			error: null
		}
	};
}

/**
 * Merge a Tavily `/usage` snapshot into local high-water used.
 * Plan/limit change or a drop in remote used starts a new cycle.
 */
export function mergeTavilyRemote(current, remote) {
	const prev = current ?? emptyState().tavily;
	if (remote === null) return { ...prev, error: prev.error };
	const hadIdentity = prev.plan != null || prev.limit != null;
	const planChanged = hadIdentity && (remote.plan !== prev.plan || remote.limit !== prev.limit);
	const cycleReset = prev.remoteUsed > 0 && remote.remoteUsed < prev.remoteUsed;
	const localUsed = planChanged || cycleReset ? remote.remoteUsed : Math.max(prev.localUsed, remote.remoteUsed);
	return {
		plan: remote.plan ?? prev.plan,
		limit: remote.limit ?? prev.limit,
		localUsed,
		remoteUsed: remote.remoteUsed,
		used: Math.max(localUsed, remote.remoteUsed),
		fetchedAt: Date.now(),
		error: null,
		keyUsed: remote.keyUsed,
		keyLimit: remote.keyLimit,
		paygoUsed: remote.paygoUsed,
		paygoLimit: remote.paygoLimit
	};
}

/** Add one search's credits onto the Tavily high-water counter. */
export function mergeTavilyCredits(current, credits) {
	const prev = current ?? emptyState().tavily;
	if (!Number.isFinite(credits) || credits < 0) return prev;
	const localUsed = Math.max(prev.localUsed, prev.used) + credits;
	return {
		...prev,
		localUsed,
		used: Math.max(localUsed, prev.remoteUsed),
		error: null
	};
}

/** Host-side usage cache with disk persist and Tavily `/usage` polling. */
export class UsageTracker {
	constructor(options) {
		this.getTavilyOptions = options.getTavilyOptions;
		this.state = emptyState();
		this.saveTimer = null;
		this.hydrated = false;
	}

	/** Load the previous process's cache; missing file is a first run. */
	async hydrate() {
		try {
			const raw = JSON.parse(await readFile(USAGE_FILE, "utf8"));
			if (raw && typeof raw === "object") {
				this.state = {
					version: 1,
					tavily: { ...emptyState().tavily, ...(raw.tavily && typeof raw.tavily === "object" ? raw.tavily : {}) },
					brave: { ...emptyState().brave, ...(raw.brave && typeof raw.brave === "object" ? raw.brave : {}) }
				};
			}
		} catch {
			/* first run */
		}
		this.hydrated = true;
		return this.snapshot();
	}

	snapshot() {
		return this.state;
	}

	/** Browser-safe view used by `GET /dsh-web-search/usage`. */
	serialize(provider, tavilyMode) {
		const tavily = this.state.tavily;
		const brave = this.state.brave;
		const tavilyLimit = tavily.limit;
		const tavilyUsed = tavily.used;
		const tavilyRemaining = tavilyLimit == null ? null : Math.max(0, tavilyLimit - tavilyUsed);
		return {
			ok: true,
			provider,
			tavilyMode: tavilyMode ?? "keyless",
			tavily: {
				available: tavilyMode === "keyed",
				plan: tavily.plan,
				used: tavilyUsed,
				limit: tavilyLimit,
				remaining: tavilyRemaining,
				localUsed: tavily.localUsed,
				remoteUsed: tavily.remoteUsed,
				fetchedAt: tavily.fetchedAt,
				error: tavily.error,
				paygoUsed: tavily.paygoUsed ?? null,
				paygoLimit: tavily.paygoLimit ?? null
			},
			brave: {
				available: provider === "brave",
				monthly: brave.monthly,
				burst: brave.burst,
				fetchedAt: brave.fetchedAt,
				error: brave.error
			},
			fetchedAt: Math.max(tavily.fetchedAt ?? 0, brave.fetchedAt ?? 0)
		};
	}

	recordTavilyCredits(credits) {
		this.state.tavily = mergeTavilyCredits(this.state.tavily, credits);
		this.scheduleSave();
	}

	recordBraveHeaders(headers) {
		const parsed = parseBraveRateLimitHeaders(headers);
		if (parsed === null) return;
		this.state.brave = { ...parsed, error: null };
		this.scheduleSave();
	}

	recordBraveError(message) {
		this.state.brave = { ...this.state.brave, error: String(message) };
		this.scheduleSave();
	}

	/** Pull Tavily `/usage` and reconcile with the local high-water counter. */
	async refreshTavily(signal, force = false) {
		const options = this.getTavilyOptions?.();
		if (options == null || options.mode !== "keyed") return this.snapshot();
		if (!URL.canParse(options.baseURL)) return this.snapshot();
		const last = this.state.tavily.fetchedAt || 0;
		const hasIdentity = this.state.tavily.plan != null || this.state.tavily.limit != null;
		const interval = hasIdentity ? TAVILY_USAGE_POLL_MS : 60_000;
		if (!force && last > 0 && (Date.now() - last) < interval) return this.snapshot();
		let apiKey;
		try {
			apiKey = await resolveApiKey(options, signal, "Tavily usage has no API key");
		} catch (error) {
			this.state.tavily = { ...this.state.tavily, error: String(error?.message ?? error), fetchedAt: Date.now() };
			this.scheduleSave();
			return this.snapshot();
		}
		const endpoint = `${options.baseURL.replace(/\/+$/u, "")}/usage`;
		let response;
		try {
			response = await fetch(endpoint, {
				method: "GET",
				redirect: "error",
				headers: {
					authorization: `Bearer ${apiKey}`,
					accept: "application/json",
					"user-agent": USER_AGENT
				},
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			this.state.tavily = { ...this.state.tavily, error: String(error?.message ?? error), fetchedAt: Date.now() };
			this.scheduleSave();
			return this.snapshot();
		}
		if (!response.ok) {
			this.state.tavily = { ...this.state.tavily, error: `Tavily /usage HTTP ${response.status}`, fetchedAt: Date.now() };
			this.scheduleSave();
			return this.snapshot();
		}
		let body;
		try {
			body = await response.json();
		} catch (error) {
			this.state.tavily = { ...this.state.tavily, error: String(error?.message ?? error), fetchedAt: Date.now() };
			this.scheduleSave();
			return this.snapshot();
		}
		const remote = parseTavilyUsageBody(body);
		if (remote === null) {
			this.state.tavily = { ...this.state.tavily, error: "Tavily /usage returned an unreadable body", fetchedAt: Date.now() };
		} else {
			this.state.tavily = mergeTavilyRemote(this.state.tavily, remote);
		}
		this.scheduleSave();
		return this.snapshot();
	}

	scheduleSave() {
		if (this.saveTimer !== null) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			const payload = JSON.stringify(this.state);
			mkdir(dirname(USAGE_FILE), { recursive: true })
				.then(() => writeFile(USAGE_FILE, payload))
				.catch(() => { /* in-memory cache still serves the UI */ });
		}, SAVE_DEBOUNCE_MS);
	}

	dispose() {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}
}
