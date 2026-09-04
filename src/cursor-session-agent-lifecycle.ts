import type {
	ExtensionHandler,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import {
	cursorSessionScopeKeyFromSessionManager,
	getCursorSessionScopeKey,
	onCursorSessionScopeKeyChange,
} from "./cursor-session-scope.js";
import {
	disposeSessionCursorAgent,
	invalidateSessionAgent,
	resetSessionCursorAgent,
} from "./cursor-session-agent.js";

export interface CursorSessionAgentLifecycleExtensionApi {
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent>): void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
	on(event: "model_select", handler: () => Promise<void> | void): void;
}

export function registerCursorSessionAgentLifecycle(pi: CursorSessionAgentLifecycleExtensionApi): void {
	onCursorSessionScopeKeyChange(async (previousScopeKey) => {
		// RLM children (and other concurrent sessions in one daemon worker) fire
		// session_start and rewrite the process-global Cursor scope key. Disposing
		// the previous scope cancels that session's pi tool bridge run, which aborts
		// in-flight parent pi__ipython as rejectionKind "cancelled" / "Request was aborted".
		// Keep the previous-scope agent while any live run is still open; shutdown /
		// tree / reload paths still dispose.
		// Only skip when the previous scope still owns an active live run.
		// A global liveCount>0 gate over-retains idle prior-scope agents.
		const activeForPrevious = cursorLiveRuns.getActiveForScope(previousScopeKey);
		if (activeForPrevious) {
			if (process.env.PI_CURSOR_PI_TOOL_BRIDGE_DEBUG === "1" || process.env.PI_CURSOR_PI_TOOL_BRIDGE_DEBUG === "true") {
				console.error(
					`[pi-cursor-sdk:lifecycle] skip-dispose previous=${previousScopeKey} activeForPrevious=true`,
				);
			}
			return;
		}
		await disposeSessionCursorAgent(previousScopeKey);
	});
	pi.on("session_shutdown", async (event, ctx) => {
		try {
			const shutdownScope =
				cursorSessionScopeKeyFromSessionManager(ctx?.sessionManager) ?? getCursorSessionScopeKey();
			if (event?.reason === "reload") {
				await resetSessionCursorAgent(shutdownScope);
				return;
			}
			// Child closed:killed fires session_shutdown on that child's ExtensionAPI.
			// disposeSessionCursorAgent() without a key used the process-global
			// current scope, which stays on the parent during delete_subagent
			// from an in-flight parent pi__ipython.
			await disposeSessionCursorAgent(shutdownScope);
		} finally {
			clearCursorSdkHttp1();
		}
	});
	pi.on("session_compact", () => {
		invalidateSessionAgent();
	});
	pi.on("session_before_tree", () => {
		invalidateSessionAgent();
	});
	pi.on("session_tree", async () => {
		await resetSessionCursorAgent();
	});
	pi.on("model_select", () => {
		invalidateSessionAgent();
	});
}
