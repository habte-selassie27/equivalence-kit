import { describe, expect, it } from "vitest";
import { isTransientBootError, retryDelayMs } from "./bootRetry";

describe("boot retry classification", () => {
  it("retries browser network failures", () => {
    expect(isTransientBootError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isTransientBootError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://example.test/pyodide/pyodide.asm.js",
        ),
      ),
    ).toBe(true);
    expect(isTransientBootError(new Error("net::ERR_NETWORK_CHANGED"))).toBe(true);
    expect(isTransientBootError(new Error("Load failed"))).toBe(true);
  });

  it("does not retry deterministic failures", () => {
    expect(isTransientBootError(new Error("package file missing: audit.py"))).toBe(false);
    expect(isTransientBootError(new Error("NameError: name 'x' is not defined"))).toBe(false);
    expect(isTransientBootError(new Error("SyntaxError: invalid syntax"))).toBe(false);
    expect(isTransientBootError(null)).toBe(false);
  });

  it("backs off between attempts", () => {
    expect(retryDelayMs(1)).toBe(750);
    expect(retryDelayMs(2)).toBe(1500);
  });
});
