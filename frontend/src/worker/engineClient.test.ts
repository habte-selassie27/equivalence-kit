import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_CEILING_MS,
  BOOT_TIMEOUT_MS,
  EngineClient,
  RUN_TIMEOUT_MS,
} from "./engine";

/**
 * A stand-in for the module worker. It records what the client posts and lets a test
 * deliver boot heartbeats and replies at controlled times.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  requestId(): number {
    const request = this.posted.find(
      (message) => typeof (message as { id?: unknown }).id === "number",
    ) as { id: number } | undefined;
    if (!request) throw new Error("no request posted");
    return request.id;
  }
}

let client: EngineClient;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  client = new EngineClient();
});

afterEach(() => {
  client.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function worker(): FakeWorker {
  const instance = FakeWorker.instances[0];
  if (!instance) throw new Error("worker was not created");
  return instance;
}

describe("EngineClient boot watchdog", () => {
  it("fails a boot that sends no heartbeat for the stall budget", async () => {
    const request = client.send({ kind: "listCases", patternId: "P1" });
    const rejection = expect(request).rejects.toMatchObject({ reason: "TIMEOUT" });
    expect(client.getStatus()).toBe("loading");

    await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS + 1);

    await rejection;
    expect(client.getStatus()).toBe("failed");
    expect(worker().terminated).toBe(true);
  });

  it("keeps a slow boot alive when heartbeats arrive", async () => {
    const request = client.send({ kind: "listCases", patternId: "P1" });
    const instance = worker();

    // Well past the old fixed 60 s limit, but with progress: this is the slow-network
    // case that used to fail while the download was still working.
    await vi.advanceTimersByTimeAsync(110_000);
    instance.reply({ kind: "boot", phase: "runtime" });
    await vi.advanceTimersByTimeAsync(110_000);

    expect(client.getStatus()).toBe("loading");
    instance.reply({
      id: instance.requestId(),
      response: { ok: true, result: [], packageVersion: "0.1.0" },
    });

    await expect(request).resolves.toEqual([]);
    expect(client.getStatus()).toBe("ready");
    expect(client.getProgress()).toBeNull();
  });

  it("stops a boot that heartbeats past the absolute ceiling", async () => {
    const request = client.send({ kind: "listCases", patternId: "P1" });
    const rejection = expect(request).rejects.toMatchObject({ reason: "BOOT_CEILING" });
    const instance = worker();

    for (let elapsed = 0; elapsed <= BOOT_CEILING_MS; elapsed += 60_000) {
      await vi.advanceTimersByTimeAsync(60_000);
      instance.reply({ kind: "boot", phase: "runtime" });
    }

    await rejection;
    expect(client.getStatus()).toBe("failed");
  });

  it("uses the short run budget once the engine is ready", async () => {
    const warmUp = client.send({ kind: "listCases", patternId: "P1" });
    const instance = worker();
    instance.reply({
      id: instance.requestId(),
      response: { ok: true, result: [], packageVersion: "0.1.0" },
    });
    await warmUp;

    const run = client.send({ kind: "audit", source: "x = 1" });
    const rejection = expect(run).rejects.toMatchObject({ reason: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1);
    await rejection;
  });

  it("publishes boot phases to progress listeners", async () => {
    const phases: string[] = [];
    client.onProgress((progress) => {
      if (progress) phases.push(progress.phase);
    });

    const request = client.send({ kind: "listCases", patternId: "P1" });
    const instance = worker();
    instance.reply({ kind: "boot", phase: "runtime" });
    instance.reply({ kind: "boot", phase: "python" });

    expect(phases).toEqual(["runtime", "python"]);
    instance.reply({
      id: instance.requestId(),
      response: { ok: true, result: [], packageVersion: "0.1.0" },
    });
    await request;
  });
});
