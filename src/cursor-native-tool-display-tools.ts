import {
	createBashToolDefinition,
	createEditToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type TSchema } from "typebox";
import { getCursorSessionCwd } from "./cursor-session-scope.js";
import {
	BUILTIN_NATIVE_CURSOR_TOOL_NAMES,
	CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES,
	CURSOR_REPLAY_TOOL_NAMES,
	isNativeCursorToolName,
	NATIVE_CURSOR_TOOL_NAMES,
	type BuiltinNativeCursorToolName,
	type NativeCursorToolName,
} from "./cursor-native-tool-names.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import {
	createCursorReplayOnlyToolDefinition,
	isCursorReplayNativeEditDetails,
	isCursorReplayNativeWriteDetails,
	parseCursorReplayToolDetails,
	renderCursorReplayResult,
	renderNativeLookingCursorFileMutationCall,
	renderNativeLookingCursorReadReplayResult,
} from "./cursor-native-tool-display-replay.js";
import {
	consumeCursorNativeToolDisplay,
	isCursorReplayToolCallId,
} from "./cursor-native-tool-display-state.js";


type AnyToolDefinition = ToolDefinition<TSchema, unknown, unknown>;
type RenderCall = NonNullable<AnyToolDefinition["renderCall"]>;
type RenderResult = NonNullable<AnyToolDefinition["renderResult"]>;

type NativeReplayStrategy = {
	createDefinition: (cwd: string) => AnyToolDefinition;
	missingReplayPolicy?: "block-file-mutation";
	renderReplayCall?: (
		args: Parameters<RenderCall>[0],
		theme: Parameters<RenderCall>[1],
		context: Parameters<RenderCall>[2],
		renderBase: () => ReturnType<RenderCall>,
	) => ReturnType<RenderCall>;
	renderReplayResult?: (
		result: Parameters<RenderResult>[0],
		options: Parameters<RenderResult>[1],
		theme: Parameters<RenderResult>[2],
		context: Parameters<RenderResult>[3],
		renderBase: () => ReturnType<RenderResult>,
	) => ReturnType<RenderResult>;
};

function emptyText(): Text {
	return new Text("", 0, 0);
}

function renderReadReplayCall(
	args: Parameters<RenderCall>[0],
	theme: Parameters<RenderCall>[1],
	context: Parameters<RenderCall>[2],
	renderBase: () => ReturnType<RenderCall>,
): ReturnType<RenderCall> {
	const rendered = renderBase();
	if ((args as Record<string, unknown>).localReadPreview !== true || context.expanded) return rendered;
	const baseText = rendered.render(120).join("\n").trimEnd();
	const labeled = `${baseText}${theme.fg("muted", " · local file preview")}`;
	if (rendered instanceof Text) {
		rendered.setText(labeled);
		return rendered;
	}
	return new Text(labeled, 0, 0);
}

function renderReadReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	context: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	return renderNativeLookingCursorReadReplayResult(
		result,
		options,
		theme,
		context as Parameters<typeof renderNativeLookingCursorReadReplayResult>[3],
		renderBase,
	);
}

function renderEditReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	context: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeEditDetails(details)
		? renderCursorReplayResult(result, options, theme, context as Parameters<typeof renderCursorReplayResult>[3], context.isError)
		: renderBase();
}

function renderWriteReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	context: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeWriteDetails(details)
		? renderCursorReplayResult(result, options, theme, context as Parameters<typeof renderCursorReplayResult>[3], context.isError)
		: renderBase();
}

type OptionalNativeToolFactory = (cwd: string) => AnyToolDefinition;

function getOptionalNativeToolFactory(name: string): OptionalNativeToolFactory | undefined {
	const candidate = (PiCodingAgent as Record<string, unknown>)[name];
	return typeof candidate === "function" ? candidate as OptionalNativeToolFactory : undefined;
}

const FALLBACK_NATIVE_TOOL_SCHEMAS: Record<BuiltinNativeCursorToolName, TSchema> = {
	read: Type.Object({ path: Type.Optional(Type.String()) }, { additionalProperties: true }),
	bash: Type.Object({ command: Type.Optional(Type.String()) }, { additionalProperties: true }),
	edit: Type.Object({ path: Type.Optional(Type.String()) }, { additionalProperties: true }),
	write: Type.Object({ path: Type.Optional(Type.String()), content: Type.Optional(Type.String()) }, { additionalProperties: true }),
	grep: Type.Object({ pattern: Type.Optional(Type.String()), path: Type.Optional(Type.String()) }, { additionalProperties: true }),
	find: Type.Object({ pattern: Type.Optional(Type.String()), path: Type.Optional(Type.String()) }, { additionalProperties: true }),
	ls: Type.Object({ path: Type.Optional(Type.String()) }, { additionalProperties: true }),
};

function createPrimeFallbackNativeToolDefinition(toolName: BuiltinNativeCursorToolName): AnyToolDefinition {
	return {
		name: toolName,
		label: toolName,
		description: `Display recorded Cursor ${toolName} activity. This Prime-compatible replay surface never executes work directly.`,
		parameters: FALLBACK_NATIVE_TOOL_SCHEMAS[toolName],
		async execute() {
			throw new Error(`Prime does not expose a native ${toolName} tool definition; this Cursor surface is replay-only.`);
		},
		renderCall(args, theme, context) {
			if (!context.isPartial) return new Text("", 0, 0);
			const summary = typeof (args as Record<string, unknown>)?.path === "string" ? ` ${(args as Record<string, unknown>).path}` : "";
			return new Text(theme.fg("toolTitle", theme.bold(`${toolName}${summary}`)), 0, 0);
		},
		renderResult(result, _options, theme, _context) {
			const text = result.content.find((entry) => entry.type === "text");
			return new Text(theme.fg("toolOutput", text?.type === "text" ? text.text : "Cursor activity replayed"), 0, 0);
		},
	};
}

function createPrimeCompatibleNativeToolDefinition(toolName: BuiltinNativeCursorToolName, cwd: string): AnyToolDefinition {
	if (toolName === "bash") return createBashToolDefinition(cwd) as AnyToolDefinition;
	if (toolName === "edit") return createEditToolDefinition(cwd) as AnyToolDefinition;
	const factory = getOptionalNativeToolFactory(`create${toolName[0].toUpperCase()}${toolName.slice(1)}ToolDefinition`);
	return factory ? factory(cwd) : createPrimeFallbackNativeToolDefinition(toolName);
}

const NATIVE_CURSOR_TOOL_STRATEGIES: Record<BuiltinNativeCursorToolName, NativeReplayStrategy> = {
	read: {
		createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("read", cwd),
		renderReplayCall: renderReadReplayCall,
		renderReplayResult: renderReadReplayResult,
	},
	bash: { createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("bash", cwd) },
	edit: {
		createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("edit", cwd),
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, theme, context) =>
			renderNativeLookingCursorFileMutationCall("edit", args as Record<string, unknown>, theme, context.isPartial),
		renderReplayResult: renderEditReplayResult,
	},
	write: {
		createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("write", cwd),
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, theme, context) =>
			renderNativeLookingCursorFileMutationCall("write", args as Record<string, unknown>, theme, context.isPartial),
		renderReplayResult: renderWriteReplayResult,
	},
	grep: { createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("grep", cwd) },
	find: { createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("find", cwd) },
	ls: { createDefinition: (cwd) => createPrimeCompatibleNativeToolDefinition("ls", cwd) },
};


function getNativeReplayStrategy(toolName: string): NativeReplayStrategy | undefined {
	return Object.hasOwn(NATIVE_CURSOR_TOOL_STRATEGIES, toolName)
		? NATIVE_CURSOR_TOOL_STRATEGIES[toolName as BuiltinNativeCursorToolName]
		: undefined;
}


export function wrapNativeCursorTool<TParams extends TSchema, TDetails, TState>(
	definition: ToolDefinition<TParams, TDetails, TState>,
	getCurrentDefinition: () => ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const strategy = getNativeReplayStrategy(definition.name);
	return {
		...definition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cursorDisplay = consumeCursorNativeToolDisplay(toolCallId);
			if (cursorDisplay) {
				if (cursorDisplay.isError) {
					const text = cursorDisplay.result.content
						.map((entry) => (entry.type === "text" ? entry.text : undefined))
						.filter((entry): entry is string => Boolean(entry))
						.join("\n");
					throw new Error(text || "Cursor tool replay failed");
				}
				return {
					content: cursorDisplay.result.content,
					details: cursorDisplay.result.details as TDetails,
					terminate: cursorDisplay.terminate ?? true,
				};
			}
			if (strategy?.missingReplayPolicy === "block-file-mutation" && isCursorReplayToolCallId(toolCallId)) {
				throw new Error(`No recorded Cursor ${definition.name} result was available. This replay-only call does not execute file mutations.`);
			}
			return getCurrentDefinition().execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			const currentRenderCall = getCurrentDefinition().renderCall;
			const renderBase = () => currentRenderCall?.(args, theme, context) ?? emptyText();
			const isReplayCall = typeof context.toolCallId === "string" && isCursorReplayToolCallId(context.toolCallId);
			if (isReplayCall && strategy?.renderReplayCall) {
				return strategy.renderReplayCall(args, theme, context, renderBase) as ReturnType<NonNullable<ToolDefinition<TParams, TDetails, TState>["renderCall"]>>;
			}
			return renderBase();
		},
		renderResult(result, options, theme, context) {
			const currentRenderResult = getCurrentDefinition().renderResult;
			const renderBase = () => currentRenderResult?.(result, options, theme, context) ?? emptyText();
			const isReplayCall = typeof context.toolCallId === "string" && isCursorReplayToolCallId(context.toolCallId);
			if (isReplayCall && strategy?.renderReplayResult) {
				return strategy.renderReplayResult(result, options, theme, context, renderBase) as ReturnType<NonNullable<ToolDefinition<TParams, TDetails, TState>["renderResult"]>>;
			}
			return renderBase();
		},
	};
}

export function createNativeCursorToolDefinition(toolName: NativeCursorToolName, cwd: string): ToolDefinition<TSchema, unknown, unknown> {
	const strategy = getNativeReplayStrategy(toolName);
	if (strategy) return strategy.createDefinition(cwd);
	if (isCursorReplayToolName(toolName)) return createCursorReplayOnlyToolDefinition(toolName) as ToolDefinition<TSchema, unknown, unknown>;
	throw new Error(`Unsupported Cursor native replay tool: ${toolName}`);
}

export function registerNativeCursorTool(
	pi: Pick<import("@earendil-works/pi-coding-agent").ExtensionAPI, "registerTool">,
	toolName: NativeCursorToolName,
): void {
	const definition = createNativeCursorToolDefinition(toolName, getCursorSessionCwd());
	pi.registerTool(wrapNativeCursorTool(definition, () => createNativeCursorToolDefinition(toolName, getCursorSessionCwd())));
}

export { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES };
