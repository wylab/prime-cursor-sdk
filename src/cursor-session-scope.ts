import { resolve } from "node:path";
import { isPrimeProjectTrusted } from "./prime-compat.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";

interface CursorSessionScopeExtensionApi {
	on(event: string, handler: (...args: never[]) => unknown): void;
}

const ANONYMOUS_SESSION_SCOPE_KEY = "__anonymous__";
const EPHEMERAL_SESSION_SCOPE_PREFIX = "__ephemeral__:";
export const MAX_CURSOR_SESSION_NAME_LENGTH = 100;

type CursorSessionScopeChangeHandler = (previousScopeKey: string) => Promise<void> | void;

const state = {
	sessionCwd: process.cwd(),
	sessionFile: undefined as string | undefined,
	sessionId: undefined as string | undefined,
	sessionName: undefined as string | undefined,
	projectTrusted: false,
	sessionGeneration: 0,
};

const scopeGenerations = new Map<string, number>([[ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration]]);
const projectTrustResolutionCwds = new Set<string>();
let nextSessionGeneration = 1;
let scopeChangeHandler: CursorSessionScopeChangeHandler | undefined;

/**
 * Pi session file when known; used to scope reused Cursor SDK agents to one pi session.
 */
export function getCursorSessionFile(): string | undefined {
	return state.sessionFile;
}

/**
 * Stable scope key for session-agent pooling. Falls back to a process-local anonymous key
 * before the first session_start (tests and early startup).
 */
export function getCursorSessionScopeKey(): string {
	if (state.sessionFile) return state.sessionFile;
	if (state.sessionId) return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${state.sessionId}`;
	return ANONYMOUS_SESSION_SCOPE_KEY;
}

export function cursorSessionScopeKeyFromSessionManager(sessionManager?: {
	getSessionFile?: () => string | undefined;
	getSessionId?: () => string | undefined;
}): string | undefined {
	const sessionFile = sessionManager?.getSessionFile?.();
	if (sessionFile) return sessionFile;
	const sessionId = sessionManager?.getSessionId?.();
	if (sessionId) return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${sessionId}`;
	return undefined;
}

export function getCursorSessionScopeGeneration(scopeKey: string = getCursorSessionScopeKey()): number {
	return scopeGenerations.get(scopeKey) ?? 0;
}

/**
 * Pi session cwd when known; falls back to process.cwd() before session_start.
 * Updated on session_start only until pi threads cwd into streamSimple—mid-session cwd
 * changes without a new session_start event are not reflected here.
 */
export function getCursorSessionCwd(): string {
	return state.sessionCwd;
}

export function getCursorSessionProjectTrusted(): boolean {
	return state.projectTrusted;
}

export function getCursorSessionName(): string | undefined {
	return state.sessionName;
}

function normalizeCursorSessionName(name: string | undefined): string | undefined {
	if (name === undefined) return undefined;
	return truncateCursorDisplayLine(name, MAX_CURSOR_SESSION_NAME_LENGTH) || undefined;
}

function setCursorSessionScope(
	cwd: string,
	sessionFile: string | undefined,
	sessionId?: string,
	projectTrusted = false,
	sessionName?: string,
): void {
	state.sessionCwd = cwd;
	state.sessionFile = sessionFile;
	state.sessionId = sessionId;
	state.sessionName = normalizeCursorSessionName(sessionName);
	state.projectTrusted = projectTrusted;
	state.sessionGeneration = nextSessionGeneration;
	nextSessionGeneration += 1;
	scopeGenerations.set(getCursorSessionScopeKey(), state.sessionGeneration);
}

function recordProjectTrustResolution(cwd: string): void {
	projectTrustResolutionCwds.add(resolve(cwd));
}

function isCliProjectTrustApproved(args = process.argv.slice(2)): boolean {
	let approved = false;
	const valueOptions = new Set(["--model", "--provider", "--name", "--session", "--session-dir", "--config", "--api-key", "--mode", "--prompt", "--system-prompt", "--extension"]);
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--approve" || arg === "-a" || arg === "--approve=true") approved = true;
		if (arg === "--no-approve" || arg === "--approve=false") approved = false;
		if (valueOptions.has(arg)) index += 1;
	}
	return approved;
}

function resetCursorSessionScope(): void {
	state.sessionCwd = process.cwd();
	state.sessionFile = undefined;
	state.sessionId = undefined;
	state.sessionName = undefined;
	state.projectTrusted = false;
	state.sessionGeneration = 0;
	nextSessionGeneration = 1;
	scopeGenerations.clear();
	scopeGenerations.set(ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration);
	projectTrustResolutionCwds.clear();
}

export function onCursorSessionScopeKeyChange(handler: CursorSessionScopeChangeHandler): void {
	scopeChangeHandler = handler;
}

export function registerCursorSessionScope(pi: CursorSessionScopeExtensionApi): void {
	// Prime ignores these legacy provenance events; the broad local `on` seam
	// keeps the Pi implementation and its trust semantics intact.
	pi.on("project_trust", (event: { cwd: string }) => {
		recordProjectTrustResolution(event.cwd);
		return { trusted: "undecided" };
	});
	pi.on("session_start", async (_event: unknown, ctx: {
		cwd: string;
		sessionManager?: { getSessionFile?: () => string | undefined; getSessionId?: () => string | undefined; getSessionName?: () => string | undefined };
		isProjectTrusted?: () => boolean;
	}) => {
		const previousScopeKey = getCursorSessionScopeKey();
		const piProjectTrust = ctx.isProjectTrusted?.() === true
			&& (projectTrustResolutionCwds.has(resolve(ctx.cwd)) || isCliProjectTrustApproved());
		setCursorSessionScope(
			ctx.cwd,
			ctx.sessionManager?.getSessionFile?.() ?? undefined,
			ctx.sessionManager?.getSessionId?.() ?? undefined,
			piProjectTrust || isPrimeProjectTrusted(),
			ctx.sessionManager?.getSessionName?.() ?? undefined,
		);
		if (previousScopeKey !== getCursorSessionScopeKey()) {
			await scopeChangeHandler?.(previousScopeKey);
		}
	});
	pi.on("session_info_changed", (event: { name?: string }) => {
		state.sessionName = normalizeCursorSessionName(event.name);
	});
}

export const __testUtils = {
	ANONYMOUS_SESSION_SCOPE_KEY,
	EPHEMERAL_SESSION_SCOPE_PREFIX,
	set: setCursorSessionScope,
	recordProjectTrustResolution,
	isCliProjectTrustApproved,
	reset: resetCursorSessionScope,
};
