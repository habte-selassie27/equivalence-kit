/**
 * How the worker decides that a failed boot is worth retrying.
 *
 * The engine is fetched over the network on first use. A mobile connection can drop
 * mid-download, and a browser reports that as a generic `TypeError: Failed to fetch` or
 * a failed dynamic import. Those are transient. A syntax error, a missing file, or a
 * Python import error is not: retrying would only hide the real cause.
 */

const TRANSIENT_BOOT_PATTERN =
  /failed to fetch|networkerror|network error|load failed|err_network|dynamically imported module|importing a module script failed|fetch failed/i;

/** One initial attempt plus two retries. */
export const BOOT_ATTEMPTS = 3;

/** Backoff between boot attempts: 750 ms, then 1500 ms. */
export function retryDelayMs(attempt: number): number {
  return 750 * attempt;
}

export function isTransientBootError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return TRANSIENT_BOOT_PATTERN.test(message);
}
