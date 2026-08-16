import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index.js", () => ({
  default: vi.fn(async () => undefined),
}));

import cursorExtension from "../src/index.js";
import primeExtension from "../src/prime-index.js";
import { getCursorSdkProjectConfigPath } from "../src/cursor-config.js";
import {
  isPrimeProjectTrusted,
  PRIME_AGENT_PROJECT_TRUSTED_ENV,
} from "../src/prime-compat.js";

const originalPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR;

function restorePrimeAgentDir(): void {
  if (originalPrimeAgentDir === undefined)
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR;
  else process.env.PRIME_AGENT_CODING_AGENT_DIR = originalPrimeAgentDir;
}

afterEach(() => {
  restorePrimeAgentDir();
  vi.clearAllMocks();
});

describe("Prime Agent adapter", () => {
  it("removes a competing cursor provider before registering the SDK provider", async () => {
    const pi = { unregisterProvider: vi.fn() } as {
      unregisterProvider: (name: string) => void;
    };

    await primeExtension(pi);

    expect(pi.unregisterProvider).toHaveBeenCalledWith("cursor");
    expect(cursorExtension).toHaveBeenCalledWith(pi);
  });

  it("uses Prime's project config directory when the Prime agent dir is configured", () => {
    process.env.PRIME_AGENT_CODING_AGENT_DIR = "/tmp/prime-agent";

    expect(getCursorSdkProjectConfigPath("/repo")).toBe(
      join("/repo", ".prime/agent/cursor-sdk.json"),
    );
  });
  it("keeps Prime project config untrusted unless explicitly enabled", () => {
    process.env.PRIME_AGENT_CODING_AGENT_DIR = "/tmp/prime-agent";
    delete process.env[PRIME_AGENT_PROJECT_TRUSTED_ENV];
    expect(isPrimeProjectTrusted()).toBe(false);

    process.env[PRIME_AGENT_PROJECT_TRUSTED_ENV] = "true";
    expect(isPrimeProjectTrusted()).toBe(true);
  });
});
