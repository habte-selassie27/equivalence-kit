/**
 * Main-thread client for the Pyodide worker.
 *
 * Responsibilities:
 *  - spawn the worker and keep it alive for the session;
 *  - cap request size before sending;
 *  - enforce a run time limit by terminating and restarting the worker;
 *  - expose a status the shell can show ("Loading the engine", ready, failed).
 */

import type {
  BootPhase,
  Request,
  Response,
  WorkerBoot,
  WorkerInit,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

export const MAX_REQUEST_BYTES = 64 * 1024;
export const RUN_TIMEOUT_MS = 15_000;
/**
 * How long the main thread waits for the next boot heartbeat before declaring a stall.
 *
 * The first visit downloads about 13 MB (pyodide.asm.wasm 9.7 MB, python_stdlib.zip
 * 2.3 MB, pyodide.asm.js 1.2 MB, measured 2026-10-23). A fixed 60 s total limit
 * rejected downloads that were still making progress on a slow connection. The worker
 * now reports a heartbeat at every boot phase and every five seconds inside a phase;
 * this is the gap that counts as "stalled", not the total time.
 */
export const BOOT_TIMEOUT_MS = 180_000;
/** Absolute cap even while heartbeats arrive, so a tab cannot load forever. */
export const BOOT_CEILING_MS = 15 * 60_000;

export type EngineStatus = "idle" | "loading" | "ready" | "failed";

export interface EngineProgress {
  phase: BootPhase;
  /** When the first heartbeat for this phase arrived. */
  since: number;
}

export class EngineError extends Error {
  readonly errorClass: "EXPECTED" | "EXTERNAL" | "TRANSIENT" | "LLM_ERROR" | "ENGINE";
  readonly reason: string;

  constructor(
    errorClass: "EXPECTED" | "EXTERNAL" | "TRANSIENT" | "LLM_ERROR" | "ENGINE",
    reason: string,
  ) {
    super(`${errorClass}: ${reason}`);
    this.errorClass = errorClass;
    this.reason = reason;
  }
}

interface PendingEntry {
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  /** True while the request is also waiting for the first boot. */
  boot: boolean;
  arm: (delayMs: number, reason?: "TIMEOUT" | "BOOT_CEILING") => void;
}

export class EngineClient {
  private worker: Worker | null = null;
  private status: EngineStatus = "idle";
  private version = "unknown";
  private lastError: string | null = null;
  private progress: EngineProgress | null = null;
  private listeners = new Set<(status: EngineStatus, version: string) => void>();
  private progressListeners = new Set<(progress: EngineProgress | null) => void>();
  private pending = new Map<number, PendingEntry>();
  private counter = 0;

  onStatus(listener: (status: EngineStatus, version: string) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.version);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to boot-phase changes (used for "downloading the runtime" hints). */
  onProgress(listener: (progress: EngineProgress | null) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.progress);
    return () => this.progressListeners.delete(listener);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getVersion(): string {
    return this.version;
  }

  /** The reason the engine last failed, for the UI to show instead of a generic notice. */
  getLastError(): string | null {
    return this.lastError;
  }

  getProgress(): EngineProgress | null {
    return this.progress;
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(this.status, this.version);
    }
  }

  private setProgress(phase: BootPhase | null): void {
    // The same phase repeats every heartbeat. Keep its original start time so React does
    // not re-render every five seconds just because the engine is still downloading.
    if (phase !== null && this.progress?.phase === phase) return;
    this.progress = phase === null ? null : { phase, since: Date.now() };
    for (const listener of this.progressListeners) {
      listener(this.progress);
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.setStatus("loading");
    const worker = new Worker(new URL("./pyodideWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse | WorkerBoot>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = () => {
      this.failAll("WORKER_FAILED");
    };
    worker.onmessageerror = () => {
      this.failAll("WORKER_MESSAGE");
    };
    this.worker = worker;

    // Tell the worker where the package assets live. A worker cannot derive this itself:
    // relative URLs there resolve against the worker's asset path, not the page.
    const pkgBase = new URL("pkg", document.baseURI).href;
    worker.postMessage({ kind: "init", pkgBase } satisfies WorkerInit);

    return worker;
  }

  private handleMessage(message: WorkerResponse | WorkerBoot): void {
    if ((message as WorkerBoot).kind === "boot") {
      this.handleBoot((message as WorkerBoot).phase);
      return;
    }
    this.handleReply(message as WorkerResponse);
  }

  /**
   * A boot heartbeat both updates the UI and resets the stall watchdog. The ceiling is
   * still enforced from the original request start, so heartbeats cannot keep a broken
   * boot alive forever.
   */
  private handleBoot(phase: BootPhase): void {
    this.setProgress(phase);
    const now = Date.now();
    for (const entry of this.pending.values()) {
      if (!entry.boot) continue;
      const elapsed = now - entry.startedAt;
      const remaining = BOOT_CEILING_MS - elapsed;
      if (remaining <= 0) {
        this.failAll("BOOT_CEILING");
        return;
      }
      entry.arm(
        Math.min(BOOT_TIMEOUT_MS, remaining),
        remaining < BOOT_TIMEOUT_MS ? "BOOT_CEILING" : "TIMEOUT",
      );
    }
  }

  private handleReply(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);
    if (message.response.ok) {
      this.version = message.response.packageVersion;
      this.lastError = null;
      this.setProgress(null);
      this.setStatus("ready");
    } else if (this.status === "loading") {
      // A failed response while still booting means the engine is unusable this
      // session: the shell must show the precomputed state, not "loading" forever.
      this.lastError = `${message.response.errorClass}: ${message.response.reason}`;
      this.setProgress(null);
      this.setStatus("failed");
    }
    entry.resolve(message.response);
  }

  /** Fail every pending request and tear down the worker that stopped answering. */
  private failAll(reason: string): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new EngineError("ENGINE", reason));
    }
    this.terminateWorker();
    this.lastError = `ENGINE: ${reason}`;
    this.setProgress(null);
    this.setStatus("failed");
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Start the engine so the status line reflects reality before the first run.
   *
   * A trivial request is enough: the worker boots, imports the package, and the status
   * moves to "ready". Failures are swallowed — the playground falls back to the stored
   * results, and the status line says so.
   */
  async warmUp(): Promise<void> {
    try {
      await this.send({ kind: "listCases", patternId: "P1" });
    } catch {
      // The status line already reports the failure.
    }
  }

  /** Give the engine another chance after a failure or a timeout. */
  async retry(): Promise<void> {
    this.restart();
    await this.warmUp();
  }

  /** Send a request, enforcing the size cap and the run time limit. */
  async send(request: Request): Promise<unknown> {
    const payload = JSON.stringify(request);
    if (payload.length > MAX_REQUEST_BYTES) {
      throw new EngineError("EXPECTED", "OVER_LIMIT");
    }

    const worker = this.ensureWorker();
    const id = ++this.counter;
    const startedAt = Date.now();
    const boot = this.status === "loading";

    const response = await new Promise<Response>((resolve, reject) => {
      let entry: PendingEntry;
      entry = {
        resolve,
        reject,
        startedAt,
        boot,
        // Warmed then replaced immediately by arm(); keeps the type non-optional.
        timer: setTimeout(() => undefined, 0),
        arm: (delayMs: number, reason: "TIMEOUT" | "BOOT_CEILING" = "TIMEOUT") => {
          clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            this.failAll(reason);
          }, delayMs);
        },
      };
      this.pending.set(id, entry);
      entry.arm(boot ? BOOT_TIMEOUT_MS : RUN_TIMEOUT_MS);
      worker.postMessage({ id, request } satisfies WorkerRequest);
    });

    if (!response.ok) {
      throw new EngineError(response.errorClass, response.reason);
    }
    return response.result;
  }

  /** Terminate the worker so the next request starts a fresh one. */
  restart(): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new EngineError("ENGINE", "RESTARTED"));
    }
    this.terminateWorker();
    this.lastError = null;
    this.setProgress(null);
    this.setStatus("idle");
  }

  dispose(): void {
    this.restart();
    this.listeners.clear();
    this.progressListeners.clear();
  }
}

export const engine = new EngineClient();
