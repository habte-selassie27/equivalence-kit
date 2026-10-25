import { describe, expect, it } from "vitest";
import { bootProgressLabel, engineFailureMessage } from "./engineMessages";

describe("engine failure messages", () => {
  it("explains a dropped download without leaking a browser error", () => {
    const message = engineFailureMessage("ENGINE: BOOT_NETWORK");
    expect(message).toContain("could not be downloaded");
    expect(message).not.toContain("Failed to fetch");
  });

  it("explains a slow first load and keeps the user moving", () => {
    for (const code of ["ENGINE: TIMEOUT", "ENGINE: BOOT_CEILING"]) {
      const message = engineFailureMessage(code);
      expect(message).toContain("13 MB");
      expect(message).toContain("Retry");
    }
  });

  it("does not hide an unknown code behind a claim of success", () => {
    const message = engineFailureMessage("ENGINE: SOMETHING_NEW");
    expect(message).toContain("could not start");
    expect(message).toContain("pip install equivalencekit");
  });

  it("handles no recorded error", () => {
    expect(engineFailureMessage(null)).toContain("did not start");
  });
});

describe("boot phase labels", () => {
  it("names every phase", () => {
    expect(bootProgressLabel({ phase: "import", since: 0 })).toContain("loader");
    expect(bootProgressLabel({ phase: "runtime", since: 0 })).toContain("13 MB");
    expect(bootProgressLabel({ phase: "package", since: 0 })).toContain("equivalencekit");
    expect(bootProgressLabel({ phase: "python", since: 0 })).toContain("Python");
    expect(bootProgressLabel({ phase: "retry", since: 0 })).toContain("retrying");
  });

  it("falls back to a neutral label before the first phase", () => {
    expect(bootProgressLabel(null)).toBe("Loading the engine");
  });
});
