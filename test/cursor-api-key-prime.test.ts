import { afterEach, describe, expect, it, vi } from "vitest";

const { getStoredCredential, createAuthStorage, AuthStorage } = vi.hoisted(
  () => {
    const getStoredCredential = vi.fn();
    const createAuthStorage = vi.fn(() => ({ get: getStoredCredential }));
    const AuthStorage = Object.assign(vi.fn(), { create: createAuthStorage });
    return { getStoredCredential, createAuthStorage, AuthStorage };
  },
);

vi.mock("@earendil-works/pi-coding-agent", () => ({ AuthStorage }));

import { resolveCursorRuntimeApiKey } from "../src/cursor-api-key.js";

describe("cursor-api-key Prime AuthStorage compatibility", () => {
  const originalApiKey = process.env.CURSOR_API_KEY;

  afterEach(() => {
    getStoredCredential.mockReset();
    createAuthStorage.mockClear();
    if (originalApiKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = originalApiKey;
  });

  it("reads a stored Cursor API key when the environment is empty", async () => {
    delete process.env.CURSOR_API_KEY;
    getStoredCredential.mockReturnValue({
      type: "api_key",
      key: "prime-stored-key",
    });

    expect(await resolveCursorRuntimeApiKey()).toBe("prime-stored-key");
    expect(createAuthStorage).toHaveBeenCalledTimes(1);
    expect(getStoredCredential).toHaveBeenCalledWith("cursor");
  });

  it("ignores non-API-key Prime credentials and falls back to the environment", async () => {
    getStoredCredential.mockReturnValue({
      type: "oauth",
      key: "not-an-api-key",
    });
    process.env.CURSOR_API_KEY = "prime-env-key";

    expect(await resolveCursorRuntimeApiKey()).toBe("prime-env-key");
  });
});
