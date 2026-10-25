/**
 * Audit screen tests, with the Pyodide engine mocked.
 *
 * The engine singleton is replaced at the module boundary; tests assert what the screen
 * does with real response shapes: findings rendered with rule ids and lines, the clean
 * state, the error path (using the real EngineError), URL-state hydration, the share
 * link, and a failed engine disabling the run button while offering a retry.
 */

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditScreen, decodeAuditState, encodeAuditState } from "./AuditScreen";
import { EngineError } from "../../worker/engine";
import type { EngineStatus } from "../../worker/engine";

const send = vi.fn();
let engineStatus: EngineStatus = "ready";

vi.mock("../../worker/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../worker/engine")>();
  return {
    ...actual,
    engine: {
      onStatus: (listener: (status: EngineStatus, version: string) => void) => {
        listener(engineStatus, "0.1.0");
        return () => {};
      },
      warmUp: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      send: (...args: Parameters<typeof send>) => send(...args),
      getStatus: () => engineStatus,
      getLastError: () => null,
      getProgress: () => null,
      onProgress: (listener: (progress: null) => void) => {
        listener(null);
        return () => {};
      },
    },
  };
});

function ui() {
  return render(
    <MemoryRouter initialEntries={["/audit"]}>
      <AuditScreen />
    </MemoryRouter>,
  );
}

const FINDINGS = [
  { rule: "A18", line: 7, message: "TOLERANCE_BPS is 0; a zero tolerance is vacuous", doc: "docs/anti-patterns.md#A18" },
  { rule: "A13", line: 9, message: "float literal; use integer math", doc: "docs/anti-patterns.md#A13" },
];

beforeEach(() => {
  engineStatus = "ready";
  send.mockReset();
});

afterEach(() => cleanup());

describe("Audit screen", () => {
  it("shows the sample source and the run controls", () => {
    const { container } = ui();
    const textarea = screen.getByLabelText("Contract source") as HTMLTextAreaElement;
    expect(textarea.value).toContain("class MyJudge");
    expect(screen.getByRole("button", { name: "Run audit" })).toBeInTheDocument();
    expect(container.querySelector(".audit-source")).not.toBeNull();
  });

  it("renders findings with rule ids and line numbers", async () => {
    const user = fireEvent;
    send.mockResolvedValue(FINDINGS);
    ui();

    user.click(screen.getByRole("button", { name: "Run audit" }));
    await waitFor(() => {
      expect(screen.getByText(/TOLERANCE_BPS is 0/)).toBeInTheDocument();
    });
    expect(screen.getByText("line 9")).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith({
      kind: "audit",
      source: expect.stringContaining("class MyJudge"),
    });
  });

  it("celebrates a clean source but does not overclaim tightness", async () => {
    send.mockResolvedValue([]);
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Run audit" }));
    await waitFor(() => {
      expect(screen.getByText(/0 findings/)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/it cannot prove a rule is tight/),
    ).toBeInTheDocument();
  });

  it("surfaces engine errors through the notice, using the real EngineError", async () => {
    send.mockRejectedValue(new EngineError("EXPECTED", "OVER_LIMIT"));
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Run audit" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("EXPECTED: OVER_LIMIT");
    });
  });

  it("copies a share link that round-trips through the URL", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    ui();
    fireEvent.change(screen.getByLabelText("Contract source"), {
      target: { value: "def demo():\n    return 0\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    const link = (vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0] as string) ?? "";
    const encoded = link.split("state=")[1]!;
    expect(decodeAuditState(encoded)).toContain("def demo");
    expect(screen.getByText(/Share link copied/)).toBeInTheDocument();
  });

  it("hydrates the pasted source from a shared state parameter", () => {
    const encoded = encodeAuditState("SHARED_CONTRACT = 1\n");
    cleanup();
    render(
      <MemoryRouter initialEntries={[`/audit?state=${encoded}`]}>
        <AuditScreen />
      </MemoryRouter>,
    );
    const textarea = screen.getByLabelText("Contract source") as HTMLTextAreaElement;
    expect(textarea.value).toContain("SHARED_CONTRACT");
  });

  it("rejects a malformed state parameter by falling back to the sample", () => {
    render(
      <MemoryRouter initialEntries={["/audit?state=not-a-state"]}>
        <AuditScreen />
      </MemoryRouter>,
    );
    const textarea = screen.getByLabelText("Contract source") as HTMLTextAreaElement;
    expect(textarea.value).toContain("class MyJudge");
  });

  it("keeps the run button off and offers retry when the engine failed", () => {
    engineStatus = "failed";
    const { container } = ui();
    expect(screen.getByRole("button", { name: "Run audit" })).toBeDisabled();
    expect(container.querySelector(".error-notice")).not.toBeNull();
    expect(screen.getByText(/Engine failed to start/)).toBeInTheDocument();
  });
});
