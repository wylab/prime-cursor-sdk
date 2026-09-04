import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridgePiHarness } from "./helpers/pi-harness.js";
import { __testUtils, registerCursorPiToolBridge } from "../src/cursor-pi-tool-bridge.js";

describe("registerCursorPiToolBridge re-register during RLM child start", () => {
	afterEach(async () => {
		await __testUtils.resetRegisteredBridgeForTests();
	});

	it("keeps the existing registry and does not disposeAll when a child session re-registers with zero endpoints", async () => {
		const firstPi = createBridgePiHarness({ active: [], tools: [] });
		const first = registerCursorPiToolBridge(firstPi);
		expect(first.getEndpointCount()).toBe(0);
		const disposeAll = vi.spyOn(first, "disposeAll");

		const secondPi = createBridgePiHarness({ active: [], tools: [] });
		const second = registerCursorPiToolBridge(secondPi);

		expect(second).toBe(first);
		expect(disposeAll).not.toHaveBeenCalled();
		expect(__testUtils.getRegisteredBridgeForTests()).toBe(first);
	});

	it("does not disposeAll on non-reload session_shutdown", async () => {
		const pi = createBridgePiHarness({ active: [], tools: [] });
		const bridge = registerCursorPiToolBridge(pi);
		const disposeAll = vi.spyOn(bridge, "disposeAll");
		await pi.runSessionShutdown({ reason: "completed" });
		expect(disposeAll).not.toHaveBeenCalled();
	});

	it("disposeAll on reload session_shutdown", async () => {
		const pi = createBridgePiHarness({ active: [], tools: [] });
		const bridge = registerCursorPiToolBridge(pi);
		const disposeAll = vi.spyOn(bridge, "disposeAll").mockResolvedValue(undefined);
		await pi.runSessionShutdown({ reason: "reload" });
		expect(disposeAll).toHaveBeenCalledOnce();
	});
});
