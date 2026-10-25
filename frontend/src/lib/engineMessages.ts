/**
 * Human-facing text for engine failures and boot phases.
 *
 * The engine's wire reasons are stable codes (`BOOT_NETWORK`, `TIMEOUT`, ...) suitable
 * for logs and tests. They are not suitable for the page: a visitor cannot act on
 * "Failed to fetch dynamically imported module". Keep the mapping in one place so the
 * playground, audit, and builder screens explain the same failure the same way.
 */

import type { EngineProgress } from "../worker/engine";

export function engineFailureMessage(error: string | null): string {
  if (!error) {
    return "The local engine did not start. Check your connection and retry.";
  }
  if (error.includes("BOOT_NETWORK")) {
    return "The engine files could not be downloaded. Check your connection, then press Retry.";
  }
  if (error.includes("TIMEOUT") || error.includes("BOOT_CEILING")) {
    return "The engine did not finish starting in time. The first visit downloads about 13 MB; on a slow connection this can take a few minutes. Press Retry to resume.";
  }
  if (error.includes("WORKER_FAILED")) {
    return "The browser stopped the engine worker. Press Retry; if it repeats, reload the page.";
  }
  if (error.includes("WORKER_MESSAGE")) {
    return "The engine sent an unreadable reply. Press Retry; if it repeats, reload the page.";
  }
  return "The engine could not start. Press Retry. If it keeps failing, run the same checks locally with `pip install equivalencekit` and `ekit audit`.";
}

export function bootProgressLabel(progress: EngineProgress | null): string {
  switch (progress?.phase) {
    case "import":
      return "Loading the engine — fetching the loader";
    case "runtime":
      return "Loading the engine — downloading the 13 MB runtime";
    case "package":
      return "Loading the engine — installing the equivalencekit package";
    case "python":
      return "Loading the engine — starting Python";
    case "retry":
      return "Loading the engine — retrying after a network error";
    default:
      return "Loading the engine";
  }
}
