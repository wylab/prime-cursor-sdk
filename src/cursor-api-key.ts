import * as CodingAgent from "@earendil-works/pi-coding-agent";

export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_PROVIDER_ID = "cursor";

// Non-secret literal sentinel for pi's provider registry. Pi 0.77 treats `$ENV_VAR`
// values as unconfigured when the env var is absent, which hides fallback models
// before `/login`. Keep the provider available and resolve the real key in the
// Cursor provider turn path from pi auth or CURSOR_API_KEY.
export const CURSOR_API_KEY_CONFIG_VALUE = "pi-cursor-sdk-cursor-api-key-placeholder";

type StoredCursorCredential = { type?: string; key?: string };
type PrimeAuthStorage = { create: () => { get: (provider: string) => StoredCursorCredential | undefined } };

function isPrimeAuthStorage(value: unknown): value is PrimeAuthStorage {
	if (typeof value !== "function" || !("create" in value)) return false;
	return typeof value.create === "function";
}

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
	CURSOR_API_KEY_ENV_VAR,
	`$${CURSOR_API_KEY_ENV_VAR}`,
	`\${${CURSOR_API_KEY_ENV_VAR}}`,
	CURSOR_API_KEY_CONFIG_VALUE,
]);

export function resolveCursorApiKey(apiKey?: string): string | undefined {
	const trimmed = apiKey?.trim();
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}

function getStoredCursorApiKey(): string | undefined {
	try {
		const host = CodingAgent;
		if ("readStoredCredential" in host && typeof host.readStoredCredential === "function") {
			const credential = host.readStoredCredential(CURSOR_PROVIDER_ID);
			return resolveCursorApiKey(credential?.type === "api_key" ? credential.key : undefined);
		}

		// Prime Agent exposes AuthStorage instead of Pi's readStoredCredential.
		// `get()` is synchronous and reads the active ~/.prime/agent/auth.json.
		if ("AuthStorage" in host && isPrimeAuthStorage(host.AuthStorage)) {
			const credential = host.AuthStorage.create().get(CURSOR_PROVIDER_ID);
			return resolveCursorApiKey(credential?.type === "api_key" ? credential.key : undefined);
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function resolveCursorRuntimeApiKey(): Promise<string | undefined> {
	return Promise.resolve(getStoredCursorApiKey() ?? resolveCursorApiKey(process.env.CURSOR_API_KEY));
}
