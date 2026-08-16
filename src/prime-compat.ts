import { join } from "node:path";
import * as CodingAgent from "@earendil-works/pi-coding-agent";

/** Explicit opt-in for Prime's otherwise-untrusted project configuration. */
export const PRIME_AGENT_PROJECT_TRUSTED_ENV = "PRIME_AGENT_PROJECT_TRUSTED";

function parseBoolean(value: string | undefined): boolean {
  return (
    value?.trim().toLowerCase() === "1" ||
    value?.trim().toLowerCase() === "true" ||
    value?.trim().toLowerCase() === "yes"
  );
}

/**
 * Detect the Prime host without relying on a Prime-only package import path.
 * Prime exports AuthStorage; Pi 0.84 does not. The directory override is kept
 * as a test and smoke-run escape hatch when both hosts share one install.
 */
export function isPrimeAgentHost(): boolean {
  return (
    "AuthStorage" in CodingAgent ||
    process.env.PRIME_AGENT_CODING_AGENT_DIR !== undefined
  );
}

/**
 * Prime 0.7.2 has no project-trust event or context method. Keep project
 * config untrusted by default and permit it only when the operator explicitly
 * opts in for the process. This prevents a checked-out project's config from
 * changing Cursor runtime or safety settings implicitly.
 */
export function isPrimeProjectTrusted(): boolean {
  return (
    isPrimeAgentHost() &&
    parseBoolean(process.env[PRIME_AGENT_PROJECT_TRUSTED_ENV])
  );
}

/**
 * Prime Agent keeps the inherited Pi package identifiers for extension
 * compatibility, but stores its project resources under `.prime/agent`.
 * Resolve the directory from the host instead of importing CONFIG_DIR_NAME,
 * which is not part of the extension compatibility surface.
 */
export function getCursorProjectConfigDirName(): ".prime/agent" | ".pi" {
  return isPrimeAgentHost() ? ".prime/agent" : ".pi";
}

export function getCursorProjectConfigPath(
  cwd: string,
  fileName: string,
): string {
  return join(cwd, getCursorProjectConfigDirName(), fileName);
}

export type CursorExtensionMode = "tui" | "json" | "rpc" | "print" | undefined;

/** Resolve the host mode across Pi's context.mode and Prime's CLI context. */
export function getCursorExtensionMode(context: {
  hasUI?: boolean;
}): CursorExtensionMode {
  const contextMode = Reflect.get(context, "mode");
  if (
    contextMode === "tui" ||
    contextMode === "json" ||
    contextMode === "rpc" ||
    contextMode === "print"
  )
    return contextMode;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    const inlineMode = arg?.startsWith("--mode=")
      ? arg.slice("--mode=".length)
      : undefined;
    const mode =
      inlineMode ?? (arg === "--mode" ? process.argv[index + 1] : undefined);
    if (mode === "tui" || mode === "json" || mode === "rpc" || mode === "print")
      return mode;
  }
  return context.hasUI ? "tui" : undefined;
}
