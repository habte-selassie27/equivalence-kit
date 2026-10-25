/**
 * Message protocol between the main thread and the Pyodide worker.
 *
 * The worker exposes exactly one function, `run(request)`, with a closed set of request
 * kinds. Responses carry reason codes and structured results — never raw tracebacks.
 */

export const PATTERN_IDS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

export type ErrorClass =
  | "EXPECTED"
  | "EXTERNAL"
  | "TRANSIENT"
  | "LLM_ERROR"
  | "ENGINE";

/**
 * Boot phases reported by the worker while Pyodide starts. The main thread uses these
 * as heartbeats: a slow download keeps making progress, so it must not be mistaken for
 * a hung engine.
 */
export type BootPhase = "import" | "runtime" | "package" | "python" | "retry";

export interface WorkerBoot {
  kind: "boot";
  phase: BootPhase;
}

export type Request =
  | {
      kind: "compare";
      patternId: PatternId;
      leader: unknown;
      validator: unknown;
      context?: unknown;
    }
  | {
      kind: "perturb";
      patternId: PatternId;
      leader: unknown;
      mode: "harmless" | "harmful";
      seed: number;
    }
  | { kind: "normalize"; fn: string; value: unknown }
  | { kind: "listCases"; patternId: PatternId }
  | { kind: "audit"; source: string };

/** One finding of `ekit audit`, returned by the "audit" request kind. */
export interface AuditFinding {
  rule: string;
  line: number;
  message: string;
  doc: string;
}

export type Response =
  | { ok: true; result: unknown; packageVersion: string }
  | { ok: false; errorClass: ErrorClass; reason: string };

/** Envelope used by the worker so replies can be matched to their request. */
export interface WorkerRequest {
  id: number;
  request: Request;
}

export interface WorkerResponse {
  id: number;
  response: Response;
}

/**
 * Sent once when the worker starts. The package base cannot be derived inside a worker,
 * because relative URLs there resolve against the worker's own asset path.
 */
export interface WorkerInit {
  kind: "init";
  pkgBase: string;
}

/** One field of a comparison result, as returned by the package. */
export interface FieldResult {
  name: string;
  ok: boolean;
  reason: string;
}

export interface CompareResult {
  ok: boolean;
  reason: string;
  fields: FieldResult[];
  not_compared: string[];
}

export function isPatternId(value: string): value is PatternId {
  return (PATTERN_IDS as readonly string[]).includes(value);
}
