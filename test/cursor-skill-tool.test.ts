import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { BeforeAgentStartEvent, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_ACTIVATE_SKILL_MCP_NAME,
	CURSOR_ACTIVATE_SKILL_TOOL_NAME,
	formatCursorSkillsForPrompt,
	registerCursorSkillTool,
	resolveCursorSkillSystemPrompt,
	__testUtils as skillToolTestUtils,
} from "../src/cursor-skill-tool.js";
import { buildCursorPiToolBridgeSnapshot } from "../src/cursor-pi-tool-bridge.js";
import { buildCursorPrompt } from "../src/context.js";
import {
	createDefaultSystemPromptOptions,
	createExtensionTestContext,
	createPiHarness,
	getHarnessRegisteredTool,
	makeModel,
} from "./helpers/pi-harness.js";

afterEach(() => {
	delete process.env.PI_CURSOR_RUNTIME;
	delete process.env.PI_CURSOR_PI_TOOL_BRIDGE;
	skillToolTestUtils.clearActivatedSkillsThisSession();
});

function makeSkill(overrides: Partial<Skill> & Pick<Skill, "name" | "filePath">): Skill {
	return {
		description: `${overrides.name} description`,
		baseDir: overrides.filePath.slice(0, overrides.filePath.lastIndexOf("/")),
		sourceInfo: {
			source: "test",
			path: overrides.filePath,
			scope: "user",
			origin: "top-level",
		},
		disableModelInvocation: false,
		...overrides,
	};
}

describe("formatCursorSkillsForPrompt", () => {
	it("builds a Cursor-safe pi skill catalog and excludes explicit-only skills", () => {
		const prompt = formatCursorSkillsForPrompt([
			makeSkill({ name: "global-skill", description: "Use for global work", filePath: "/Users/me/.pi/agent/skills/global-skill/SKILL.md" }),
			makeSkill({ name: "manual-only", description: "Manual", filePath: "/skills/manual-only/SKILL.md", disableModelInvocation: true }),
		]);

		expect(prompt).toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(prompt).toContain("<name>global-skill</name>");
		expect(prompt).not.toContain("manual-only");
	});

	it("does not invite SKILL.md file-read while the activation tool is the load path", () => {
		const prompt = formatCursorSkillsForPrompt([
			makeSkill({ name: "global-skill", description: "Use for global work", filePath: "/Users/me/.pi/agent/skills/global-skill/SKILL.md" }),
			makeSkill({ name: "global-skill", description: "Duplicate name later path", filePath: "/Users/me/.agents/skills/global-skill/SKILL.md" }),
		]);

		expect(prompt).toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(prompt).not.toContain("file-read capability");
		expect(prompt).not.toContain("<location>");
		expect(prompt).not.toContain("SKILL.md");
		expect(prompt).not.toContain("/Users/me/.pi/agent/skills/global-skill/SKILL.md");
		expect(prompt).not.toContain("/Users/me/.agents/skills/global-skill/SKILL.md");
		expect(prompt.match(/<name>global-skill<\/name>/g)).toHaveLength(1);
	});

	it("lists SKILL.md only when the activation tool is unavailable", () => {
		const prompt = formatCursorSkillsForPrompt(
			[
				makeSkill({ name: "global-skill", description: "Use for global work", filePath: "/Users/me/.pi/agent/skills/global-skill/SKILL.md" }),
				makeSkill({ name: "global-skill", description: "Duplicate name later path", filePath: "/Users/me/.agents/skills/global-skill/SKILL.md" }),
			],
			{ activationAvailable: false },
		);

		expect(prompt).not.toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(prompt).toContain("file-read capability");
		expect(prompt).toContain("/Users/me/.agents/skills/global-skill/SKILL.md");
		expect(prompt).not.toContain("/Users/me/.pi/agent/skills/global-skill/SKILL.md");
		expect(prompt.match(/<name>global-skill<\/name>/g)).toHaveLength(1);
	});
});

describe("resolveCursorSkillSystemPrompt", () => {
	const cursorModel = makeModel("composer-2.5");
	const otherModel = { provider: "anthropic", id: "claude-sonnet-4-5" } as ReturnType<typeof makeModel>;
	const skill = makeSkill({ name: "global-skill", description: "Global pi skill", filePath: "/Users/me/.pi/agent/skills/global-skill/SKILL.md" });
	const piSkillSection = [
		"System prompt before skills.",
		"",
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"",
		"<available_skills>",
		"  <skill>",
		"    <name>global-skill</name>",
		"    <description>Global pi skill</description>",
		"    <location>/Users/me/.pi/agent/skills/global-skill/SKILL.md</location>",
		"  </skill>",
		"</available_skills>",
	].join("\n");

	it("replaces pi's raw read-based skill wording for Cursor models", () => {
		const resolved = resolveCursorSkillSystemPrompt(
			piSkillSection,
			cursorModel,
			{ ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
		);

		expect(resolved).toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(resolved).toContain("<name>global-skill</name>");
		expect(resolved).not.toContain("Use the read tool to load a skill's file");
		expect(resolved).not.toContain("file-read capability");
		expect(resolved).not.toContain("/Users/me/.pi/agent/skills/global-skill/SKILL.md");
	});

	it("keeps SKILL.md locations only when the pi bridge is disabled", () => {
		process.env.PI_CURSOR_PI_TOOL_BRIDGE = "false";
		const resolved = resolveCursorSkillSystemPrompt(
			piSkillSection,
			cursorModel,
			{ ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
		);

		expect(resolved).not.toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(resolved).toContain("file-read capability");
		expect(resolved).toContain("/Users/me/.pi/agent/skills/global-skill/SKILL.md");
	});

	it("removes Pi skill metadata for cloud Cursor models", () => {
		const resolved = resolveCursorSkillSystemPrompt(
			piSkillSection,
			cursorModel,
			{ ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
			"cloud",
		);

		expect(resolved).toContain("System prompt before skills.");
		expect(resolved).not.toContain("<available_skills>");
		expect(resolved).not.toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(resolved).not.toContain("/Users/me/.pi/agent/skills");
	});

	it("does not change prompts for non-Cursor models", () => {
		expect(
			resolveCursorSkillSystemPrompt(piSkillSection, otherModel, { ...createDefaultSystemPromptOptions("/repo"), skills: [skill] }),
		).toBe(piSkillSection);
	});

	it("preserves the rewritten catalog through buildCursorPrompt sanitization", () => {
		const resolved = resolveCursorSkillSystemPrompt(
			piSkillSection,
			cursorModel,
			{ ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
		);
		const prompt = buildCursorPrompt({ systemPrompt: resolved, messages: [] });

		expect(prompt.text).toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(prompt.text).toContain("global-skill");
	});
});

describe("registerCursorSkillTool", () => {
	it("adds a bridgeable activation tool for Cursor runs with visible pi skills", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-cursor-skill-"));
		const skillDir = join(dir, "global-skill");
		await mkdir(join(skillDir, "references"), { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		await writeFile(skillPath, "---\nname: global-skill\ndescription: Global skill\n---\n# Global Skill\nFollow this skill.");
		await writeFile(join(skillDir, "references", "guide.md"), "Reference details");
		const skill = makeSkill({ name: "global-skill", description: "Global skill", filePath: skillPath });
		const pi = createPiHarness({ activeTools: ["read"] });
		registerCursorSkillTool(pi);

		const result = await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: "System prompt.",
				systemPromptOptions: { ...createDefaultSystemPromptOptions(dir), skills: [skill] },
			} satisfies BeforeAgentStartEvent,
			{ model: makeModel("composer-2.5"), cwd: dir },
		);

		expect(result?.systemPrompt).toContain(CURSOR_ACTIVATE_SKILL_MCP_NAME);
		expect(pi._activeToolNames()).toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);
		expect(buildCursorPiToolBridgeSnapshot(pi).piToolNameToMcpToolName.get(CURSOR_ACTIVATE_SKILL_TOOL_NAME)).toBe(CURSOR_ACTIVATE_SKILL_MCP_NAME);

		const tool = getHarnessRegisteredTool(pi._tools, CURSOR_ACTIVATE_SKILL_TOOL_NAME);
		const toolResult = await tool.execute("call-1", { name: "global-skill" }, undefined, undefined, createExtensionTestContext({ model: makeModel("composer-2.5"), cwd: dir }));
		const text = toolResult.content?.[0]?.type === "text" ? toolResult.content[0].text : "";

		expect(toolResult).not.toMatchObject({ isError: true });
		expect(text).toContain("<skill_content name=\"global-skill\">");
		expect(text).toContain("# Global Skill");
		expect(text).toContain("references/guide.md");
	});

	it("keeps the activation tool exposed through Cursor turn_start after prompt rewrite", async () => {
		const skill = makeSkill({ name: "global-skill", description: "Global skill", filePath: "/repo/global-skill/SKILL.md" });
		const pi = createPiHarness({ activeTools: ["read"] });
		const model = makeModel("composer-2.5");
		registerCursorSkillTool(pi);

		await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: "System prompt.",
				systemPromptOptions: { ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
			} satisfies BeforeAgentStartEvent,
			{ model, cwd: "/repo" },
		);
		expect(pi._activeToolNames()).toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);

		await pi.runTurnStart({ model, cwd: "/repo" });

		expect(pi._activeToolNames()).toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);
		expect(buildCursorPiToolBridgeSnapshot(pi).piToolNameToMcpToolName.get(CURSOR_ACTIVATE_SKILL_TOOL_NAME)).toBe(CURSOR_ACTIVATE_SKILL_MCP_NAME);
	});

	it("keeps the activation tool inactive and omits the catalog in cloud runtime", async () => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		const skill = makeSkill({ name: "global-skill", description: "Global skill", filePath: "/repo/global-skill/SKILL.md" });
		const pi = createPiHarness({ activeTools: ["read"] });
		registerCursorSkillTool(pi);

		const result = await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: [
					"System prompt.",
					"",
					"The following skills provide specialized instructions for specific tasks.",
					"<available_skills><skill><name>global-skill</name><location>/repo/global-skill/SKILL.md</location></skill></available_skills>",
				].join("\n"),
				systemPromptOptions: { ...createDefaultSystemPromptOptions("/repo"), skills: [skill] },
			} satisfies BeforeAgentStartEvent,
			{ model: makeModel("composer-2.5"), cwd: "/repo" },
		);

		expect(result?.systemPrompt).not.toContain("<available_skills>");
		expect(result?.systemPrompt).not.toContain("/repo/global-skill/SKILL.md");
		expect(pi._activeToolNames()).not.toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);
	});

	it("ignores invalid Cursor runtime overrides for non-Cursor models", async () => {
		process.env.PI_CURSOR_RUNTIME = "remote";
		const pi = createPiHarness({ activeTools: ["read"] });
		registerCursorSkillTool(pi);
		const model = { provider: "anthropic", id: "claude-sonnet-4-5" } as ExtensionContext["model"];

		const result = await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: "System prompt.",
				systemPromptOptions: createDefaultSystemPromptOptions("/repo"),
			} satisfies BeforeAgentStartEvent,
			{ model, cwd: "/repo" },
		);

		expect(result).toBeUndefined();
		expect(pi._activeToolNames()).not.toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);
	});

	it("returns already_loaded on a second activate in the same session and does not re-read SKILL.md", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-cursor-skill-once-"));
		const skillDir = join(dir, "global-skill");
		await mkdir(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		await writeFile(skillPath, "---\nname: global-skill\ndescription: Global skill\n---\n# First body");
		const skill = makeSkill({ name: "global-skill", description: "Global skill", filePath: skillPath });
		const pi = createPiHarness({ activeTools: ["read"] });
		registerCursorSkillTool(pi);
		await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: "System prompt.",
				systemPromptOptions: { ...createDefaultSystemPromptOptions(dir), skills: [skill] },
			} satisfies BeforeAgentStartEvent,
			{ model: makeModel("composer-2.5"), cwd: dir },
		);

		const tool = getHarnessRegisteredTool(pi._tools, CURSOR_ACTIVATE_SKILL_TOOL_NAME);
		const first = await tool.execute("call-1", { name: "global-skill" }, undefined, undefined, createExtensionTestContext({ model: makeModel("composer-2.5"), cwd: dir }));
		const firstText = first.content?.[0]?.type === "text" ? first.content[0].text : "";
		expect(firstText).toContain("<skill_content name=\"global-skill\">");
		expect(firstText).toContain("# First body");
		expect(first.details).not.toMatchObject({ alreadyLoaded: true });

		await writeFile(skillPath, "---\nname: global-skill\ndescription: Global skill\n---\n# Mutated body");
		const second = await tool.execute("call-2", { name: "global-skill" }, undefined, undefined, createExtensionTestContext({ model: makeModel("composer-2.5"), cwd: dir }));
		const secondText = second.content?.[0]?.type === "text" ? second.content[0].text : "";
		expect(secondText).toContain("<skill_already_loaded name=\"global-skill\">");
		expect(secondText).not.toContain("# Mutated body");
		expect(secondText).not.toContain("<skill_content");
		expect(second.details).toMatchObject({ alreadyLoaded: true, name: "global-skill" });

		const catalog = formatCursorSkillsForPrompt([skill]);
		expect(catalog).toContain("<status>already_loaded</status>");
		expect(catalog).not.toContain("SKILL.md");

		await pi.runSessionStart({ model: makeModel("composer-2.5"), cwd: dir });
		await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello again",
				systemPrompt: "System prompt.",
				systemPromptOptions: { ...createDefaultSystemPromptOptions(dir), skills: [skill] },
			} satisfies BeforeAgentStartEvent,
			{ model: makeModel("composer-2.5"), cwd: dir },
		);
		const third = await tool.execute("call-3", { name: "global-skill" }, undefined, undefined, createExtensionTestContext({ model: makeModel("composer-2.5"), cwd: dir }));
		const thirdText = third.content?.[0]?.type === "text" ? third.content[0].text : "";
		expect(thirdText).toContain("<skill_content name=\"global-skill\">");
		expect(thirdText).toContain("# Mutated body");
		expect(third.details).not.toMatchObject({ alreadyLoaded: true });
	});

	it("does not expose the activation tool when no visible skills are available", async () => {
		const pi = createPiHarness({ activeTools: ["read"] });
		registerCursorSkillTool(pi);
		await pi.invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "hello",
				systemPrompt: "System prompt.",
				systemPromptOptions: createDefaultSystemPromptOptions("/repo"),
			} satisfies BeforeAgentStartEvent,
			{ model: makeModel("composer-2.5"), cwd: "/repo" },
		);

		expect(pi._activeToolNames()).not.toContain(CURSOR_ACTIVATE_SKILL_TOOL_NAME);
	});
});
