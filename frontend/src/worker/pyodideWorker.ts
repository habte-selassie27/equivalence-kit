/**
 * The Pyodide worker: runs the real `equivalencekit` package in the browser.
 *
 * Rules this file follows (UI.md section 13):
 *  - Pyodide runs in a Web Worker; the main thread never blocks.
 *  - The package is loaded from `public/pkg/`, which is built from the repo.
 *  - No network calls besides loading Pyodide and the package. No LLM calls.
 *  - Requests are size-capped and the run is time-limited by the main thread.
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
import { BOOT_ATTEMPTS, isTransientBootError, retryDelayMs } from "./bootRetry";

// The Pyodide runtime is served from this site (public/pyodide/, copied by
// tools/copy_pkg.mjs), not from a CDN. It is resolved from pkgBase on init because a
// worker resolves relative URLs against its own asset path rather than the page.
let pyodideBaseValue = "/pyodide/";// The package base is sent by the main thread, because a worker resolves relative URLs
// against its own asset path rather than the page.
let pkgBaseValue = "/pkg/";

// CDN fallback for the Pyodide runtime. Self-hosting is preferred (no external
// dependency, works offline), but a slow or flaky connection to the origin can
// abort the 10 MB wasm download. The CDN is a globally distributed fallback so
// the playground still boots when the origin is slow.
const PYODIDE_CDN_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

type PyodideModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<Pyodide>;
  version: string;
};

interface Pyodide {
  version: string;
  FS: {
    writeFile(path: string, data: string): void;
    mkdirTree(path: string): void;
  };
  runPythonAsync(code: string): Promise<unknown>;
  loadFile(path: string): Promise<unknown>;
}

let pyodide: Pyodide | null = null;
let packageVersion = "unknown";
let bootPromise: Promise<void> | null = null;

/**
 * How often the worker tells the main thread that boot is still alive. The main thread
 * treats a missing heartbeat as a stall, not as a slow download; this interval is what
 * lets a 13 MB first visit finish on a slow-but-working connection.
 */
const BOOT_HEARTBEAT_MS = 5_000;

function postBoot(phase: BootPhase): void {
  (self as unknown as Worker).postMessage({ kind: "boot", phase } satisfies WorkerBoot);
}

/**
 * Run one boot phase and keep the main thread's watchdog alive while it runs.
 *
 * A single `loadPyodide` call can spend minutes downloading and compiling without any
 * progress event of its own. Heartbeats distinguish that from a worker that died.
 */
async function withHeartbeat<T>(phase: BootPhase, task: () => Promise<T>): Promise<T> {
  postBoot(phase);
  const timer = setInterval(() => postBoot(phase), BOOT_HEARTBEAT_MS);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

/**
 * The package lives at a clean in-FS path: sys.path entries are Unix paths inside the
 * Pyodide filesystem, so the pkg URL the main thread sends is only used for fetching
 * the source files, never as an import path.
 */
const PKG_MOUNT = "/lib";

/**
 * Load Pyodide once, no matter how many requests arrive during boot.
 *
 * The shell and the active screen both warm the engine up, and React StrictMode mounts
 * effects twice in development. Without a shared promise each call started its own
 * Pyodide download — several copies of the 13 MB runtime at once — which could trip the
 * boot watchdog on a slow connection.
 */
async function loadEngine(): Promise<void> {
  if (pyodide) return;
  if (!bootPromise) {
    bootPromise = bootWithRetry();
  }
  try {
    await bootPromise;
  } catch (error) {
    // Let Retry start a fresh boot after a real failure.
    bootPromise = null;
    throw error;
  }
}

/**
 * Boot with retries for transient network failures.
 *
 * A dropped connection halfway through the 13 MB runtime used to leave the page with
 * "Failed to fetch dynamically imported module" until the visitor pressed Retry. The
 * same boot usually succeeds on the next attempt (the bytes already received are in the
 * HTTP cache), so retry twice before surfacing the failure.
 */
async function bootWithRetry(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      postBoot("retry");
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
    try {
      await boot();
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientBootError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Load Pyodide, then write the package source into the in-memory filesystem and import
 * it as a normal package. Importing the real package (rather than a copy) is the point:
 * the site must show what the contracts actually do.
 */
async function boot(): Promise<void> {
  // Try the self-hosted runtime first; fall back to the CDN so a slow or flaky
  // origin (the 10 MB wasm is the bottleneck) does not brick the playground.
  const bases = [pyodideBaseValue, PYODIDE_CDN_BASE];
  let module: PyodideModule | null = null;
  let instance: Pyodide | null = null;
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      module = (await withHeartbeat(
        "import",
        () => import(/* @vite-ignore */ `${base}pyodide.mjs`) as Promise<PyodideModule>,
      ));
      instance = await withHeartbeat("runtime", () =>
        module!.loadPyodide({ indexURL: base }),
      );
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!instance) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  await withHeartbeat("package", async () => {
    const manifestResponse = await fetch(`${pkgBaseValue}manifest.json`);
    if (!manifestResponse.ok) {
      throw new Error(`package manifest missing (${manifestResponse.status})`);
    }
    const manifest = (await manifestResponse.json()) as {
      package: string;
      version: string;
      files: string[];
    };

    const root = `${PKG_MOUNT}/${manifest.package}`;
    instance.FS.mkdirTree(root);
    for (const file of manifest.files) {
      const response = await fetch(`${pkgBaseValue}${manifest.package}/${file}`);
      if (!response.ok) {
        throw new Error(`package file missing: ${file}`);
      }
      instance.FS.writeFile(`${root}/${file}`, await response.text());
    }

    packageVersion = manifest.version;
  });

  await withHeartbeat("python", () =>
    instance.runPythonAsync(`
import sys
sys.path.insert(0, ${JSON.stringify(PKG_MOUNT)})
from equivalencekit.patterns import compare_pattern
from equivalencekit.perturb import harmless_variation, harmful_variation
from equivalencekit.normalize import normalize_text, normalize_enum, normalize_bool
from equivalencekit.audit import audit_source as _audit_source
from equivalencekit import __version__ as __ek_version__
`),
  );
  // Publish the instance only after the package imports, so no request can run against
  // a half-initialised runtime.
  pyodide = instance;
}

/**
 * Run one request. Errors are translated into the closed error classes from the package
 * registry; anything unexpected becomes ENGINE.
 */
async function run(request: Request): Promise<Response> {
  try {
    await loadEngine();
  } catch (error) {
    // Keep the wire reason stable and small. The raw network message can contain the
    // failing URL and differs between browsers; BOOT_NETWORK is what the UI explains.
    if (isTransientBootError(error)) {
      return { ok: false, errorClass: "ENGINE", reason: "BOOT_NETWORK" };
    }
    return {
      ok: false,
      errorClass: "ENGINE",
      reason: error instanceof Error ? lastMeaningfulLine(error.message) : "BOOT_FAILED",
    };
  }

  const runtime = pyodide as Pyodide;

  try {
    const raw = (await runtime.runPythonAsync(
      buildPython(request),
    )) as unknown;
    // The Python side returns JSON strings (the same `json.dumps` the contracts use);
    // parse here so callers receive structured results, never a bare string.
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    return { ok: true, result: parsed, packageVersion };
  } catch (error) {
    return { ok: false, ...classifyError(error) };
  }
}

/**
 * Translate a Python exception into the package's error classes.
 *
 * The package raises `KitError` with a code like "LLM_ERROR: UNKNOWN_ENUM". Anything
 * else is an engine fault. Tracebacks never leave the worker: only the final exception
 * line survives, stripped of frames and boilerplate.
 */
function classifyError(error: unknown): {
  errorClass: "EXPECTED" | "EXTERNAL" | "TRANSIENT" | "LLM_ERROR" | "ENGINE";
  reason: string;
} {
  const text = error instanceof Error ? error.message : String(error);
  const match = /(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR):\s*([A-Z_]+)/.exec(text);
  if (match) {
    return {
      errorClass: match[1] as "EXPECTED" | "EXTERNAL" | "TRANSIENT" | "LLM_ERROR",
      reason: match[2] as string,
    };
  }
  return { errorClass: "ENGINE", reason: lastMeaningfulLine(text) };
}

/**
 * The last informative line of a traceback ("NameError: name 'x' is not defined"),
 * with frames and the "Traceback (most recent call last):" header removed.
 */
function lastMeaningfulLine(text: string): string {
  const lines = text
    .split("\n")
    .filter((part) => part.trim().length > 0)
    .filter((part) => !part.trim().startsWith("Traceback"))
    .filter((part) => !part.trim().startsWith('File "'))
    .filter((part) => !part.includes("runPythonAsync"))
    .map((part) => part.trim());
  return (lines.at(-1) ?? "unknown error").slice(0, 200);
}

/**
 * Build the Python source for a request. Values are passed as JSON so the Python side
 * parses them with its own JSON parser — the same parser the contracts use.
 */
function buildPython(request: Request): string {
  const json = (value: unknown) => JSON.stringify(value ?? null);
  // A Python string literal for a value: stringify twice so the outer layer carries
  // quotes and escaping. Used wherever a value is handed to json.loads in Python.
  const pystr = (value: unknown) => JSON.stringify(JSON.stringify(value ?? null));

  switch (request.kind) {
    case "compare":
      return `
import json as _json
_leader = _json.loads(${pystr(request.leader)})
_validator = _json.loads(${pystr(request.validator)})
_context = _json.loads(${pystr(request.context)})
_result = compare_pattern(${json(request.patternId)}, _leader, _validator, _context)
_json.dumps(_result)
`;
    case "perturb":
      return `
import json as _json
_leader = _json.loads(${pystr(request.leader)})
_fn = harmless_variation if ${json(request.mode)} == "harmless" else harmful_variation
_variant = _fn(${json(request.patternId)}, _leader, ${Number(request.seed) | 0})
_json.dumps(_variant)
`;
    case "normalize":
      return `
import json as _json
_value = _json.loads(${pystr(request.value)})
_fn = globals().get(${json(request.fn)})
if _fn is None:
    raise ValueError("unknown normalizer")
_json.dumps(_fn(_value))
`;
    case "listCases":
      return `
import json as _json
_json.dumps([])
`;
    case "audit":
      return `
import json as _json
_source = _json.loads(${pystr(request.source)})
_findings = _audit_source(_source, "audit_input.py")
_json.dumps([
    {"rule": _f.rule, "line": _f.line, "message": _f.message, "doc": _f.doc}
    for _f in _findings
])
`;
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest | WorkerInit>) => {
  const data = event.data;

  if ((data as WorkerInit).kind === "init") {
    const pkgBase = (data as WorkerInit).pkgBase;
    pkgBaseValue = pkgBase.endsWith("/") ? pkgBase : `${pkgBase}/`;
    // public/pkg/ is a sibling of public/pyodide/.
    pyodideBaseValue = new URL("../pyodide/", pkgBaseValue).href;
    return;
  }

  const { id, request } = data as WorkerRequest;
  const response = await run(request);
  const reply: WorkerResponse = { id, response };
  (self as unknown as Worker).postMessage(reply);
};
