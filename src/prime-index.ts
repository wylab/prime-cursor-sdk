import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import cursorExtension from "./index.js";

/**
 * Prime Agent adapter for the Cursor SDK provider.
 *
 * Prime can have another Cursor provider installed (for example the CLI-based
 * `@netandreus/pi-cursor-provider`). Remove its queued registration before the
 * SDK extension registers the canonical `cursor` provider.
 */
export default async function primeCursorExtension(pi: Pick<ExtensionAPI, "unregisterProvider">): Promise<void> {
	pi.unregisterProvider("cursor");
	await Reflect.apply(cursorExtension, undefined, [pi]);
}
