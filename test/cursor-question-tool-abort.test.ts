import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionTestContext } from "./helpers/pi-harness.js";
import { createExtensionPi, resetIndexExtensionTestState } from "./helpers/index-extension-test-kit.js";

vi.mock("../src/model-discovery.js", () => ({
	discoverModels: vi.fn(),
	getCursorModelMetadata: vi.fn(),
}));

vi.mock("../src/cursor-provider.js", () => ({
	streamCursor: vi.fn(),
}));

import extensionFactory from "../src/index.js";
import { discoverModels } from "../src/model-discovery.js";
import {
	CURSOR_ASK_QUESTION_BLOCKED_EVENT,
	CURSOR_ASK_QUESTION_HOST_ABORT_TEXT,
	CURSOR_ASK_QUESTION_TOOL_NAME,
} from "../src/cursor-question-tool.js";

const mockedDiscover = vi.mocked(discoverModels);

describe("cursor_ask_question abort vs user cancel", () => {
	beforeEach(async () => {
		await resetIndexExtensionTestState();
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "0";
		mockedDiscover.mockResolvedValueOnce([]);
	});

	it("reports User cancelled only when the UI dismisses without host abort", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const select = vi.fn().mockResolvedValue(undefined);
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);
		const result = await tool!.execute(
			"question-user-cancel",
			{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
			undefined,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);

		expect(result.content).toEqual([{ type: "text", text: "User cancelled the question." }]);
		expect(result.details).toMatchObject({ cancelled: true });
		expect(result.details).not.toHaveProperty("aborted");
	});

	it("does not blame the user when AbortSignal is already aborted", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const select = vi.fn().mockResolvedValue("Yes");
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);
		const controller = new AbortController();
		controller.abort();

		const result = await tool!.execute(
			"question-pre-abort",
			{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
			controller.signal,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);

		expect(select).not.toHaveBeenCalled();
		expect(result.content).toEqual([{ type: "text", text: CURSOR_ASK_QUESTION_HOST_ABORT_TEXT }]);
		expect(result.details).toMatchObject({ cancelled: false, aborted: true, answers: [] });
		expect(pi._eventsEmitted.filter((entry) => entry.channel === CURSOR_ASK_QUESTION_BLOCKED_EVENT)).toEqual([
			{ channel: CURSOR_ASK_QUESTION_BLOCKED_EVENT, data: { active: true } },
			{ channel: CURSOR_ASK_QUESTION_BLOCKED_EVENT, data: { active: false } },
		]);
	});

	it("does not blame the user when the UI returns empty after the host aborts", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const controller = new AbortController();
		const select = vi.fn().mockImplementation(async () => {
			controller.abort();
			return undefined;
		});
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);

		const result = await tool!.execute(
			"question-abort-during-select",
			{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
			controller.signal,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);

		expect(result.content).toEqual([{ type: "text", text: CURSOR_ASK_QUESTION_HOST_ABORT_TEXT }]);
		expect(result.details).toMatchObject({ cancelled: false, aborted: true });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).not.toContain("User cancelled");
		expect(select).toHaveBeenCalledWith("Proceed?", ["Yes", "No"], { signal: controller.signal });
	});

	it("does not blame the user when UI settles cancelled then host abort races before return", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const controller = new AbortController();
		const select = vi.fn().mockResolvedValue(undefined);
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);

		const executePromise = tool!.execute(
			"question-abort-after-cancel-settle",
			{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
			controller.signal,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);
		await Promise.resolve();
		controller.abort();
		const result = await executePromise;

		expect(result.content).toEqual([{ type: "text", text: CURSOR_ASK_QUESTION_HOST_ABORT_TEXT }]);
		expect(result.details).toMatchObject({ cancelled: false, aborted: true });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).not.toContain("User cancelled");
	});

	it("does not blame the user when the UI rejects with an abort-like error", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const select = vi.fn().mockRejectedValue(new DOMException("Request was aborted", "AbortError"));
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);

		const result = await tool!.execute(
			"question-abort-error",
			{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
			undefined,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);

		expect(result.content).toEqual([{ type: "text", text: CURSOR_ASK_QUESTION_HOST_ABORT_TEXT }]);
		expect(result.details).toMatchObject({ cancelled: false, aborted: true });
	});


	it("keeps already-collected answers when host aborts between questions", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const controller = new AbortController();
		let selectCalls = 0;
		const select = vi.fn().mockImplementation(async () => {
			selectCalls += 1;
			if (selectCalls === 1) return "Yes";
			controller.abort();
			throw new DOMException("Request was aborted", "AbortError");
		});
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);

		const result = await tool!.execute(
			"question-abort-mid-batch",
			{
				questions: [
					{ question: "First?", options: ["Yes", "No"], allowCustom: false },
					{ question: "Second?", options: ["A", "B"], allowCustom: false },
				],
			},
			controller.signal,
			undefined,
			createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
		);

		expect(result.content).toEqual([{ type: "text", text: CURSOR_ASK_QUESTION_HOST_ABORT_TEXT }]);
		expect(result.details).toMatchObject({
			cancelled: false,
			aborted: true,
		});
		expect(result.details?.answers).toEqual([
			expect.objectContaining({ answer: "Yes", cancelled: false }),
		]);
	});
	it("still surfaces non-abort UI failures as errors", async () => {
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		const select = vi.fn().mockRejectedValue(new Error("UI failed"));
		const tool = pi._tools.find((candidate) => candidate.name === CURSOR_ASK_QUESTION_TOOL_NAME);

		await expect(
			tool!.execute(
				"question-ui-fail",
				{ question: "Proceed?", options: ["Yes", "No"], allowCustom: false },
				undefined,
				undefined,
				createExtensionTestContext({ ui: { notify: vi.fn(), setStatus: vi.fn(), select, input: vi.fn() } }),
			),
		).rejects.toThrow("UI failed");
	});
});
