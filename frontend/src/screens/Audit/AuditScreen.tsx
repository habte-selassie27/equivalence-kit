import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNotice } from "../../components/Notices";
import { engine, EngineError, type EngineProgress, type EngineStatus } from "../../worker/engine";
import { bootProgressLabel, engineFailureMessage } from "../../lib/engineMessages";
import { useSlowBoot } from "../../lib/useSlowBoot";
import type { AuditFinding } from "../../worker/protocol";

/** First-visit demo input: a small contract that trips two real anti-patterns. */
const SAMPLE_SOURCE = `# Paste your contract here, or keep this sample.
MAX_ITEMS = 100


class MyJudge:
    TOLERANCE_BPS = 0

    def score(self, raw):
        value = float(raw)
        if value < TOLERANCE_BPS:
            return []
        return [i for i in range(len(raw)) if i < MAX_ITEMS]
`;

const MAX_STATE_CHARS = 8000;

/** Encode the pasted source for a share link. Mirrors lib/urlState (playground shape). */
export function encodeAuditState(source: string): string {
  return encodeURIComponent(JSON.stringify({ s: source }));
}

export function decodeAuditState(encoded: string): string | null {
  if (!encoded) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(encoded)) as { s?: unknown };
    return typeof payload.s === "string" ? payload.s : null;
  } catch {
    return null;
  }
}

/**
 * Screen — Audit.
 *
 * Paste a contract, run the real anti-pattern gallery (the same checks `ekit audit`
 * runs in CI) inside the browser engine, get findings with rule ids and line numbers.
 * The audit is deterministic: no network, no LLM, no upload — the source stays on the
 * machine, and a share link carries the whole state in the URL hash.
 */
export function AuditScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shared = decodeAuditState(searchParams.get("state") ?? "");
  const [sourceText, setSourceText] = useState(shared ?? SAMPLE_SOURCE);
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(engine.getStatus());
  const [engineError, setEngineError] = useState<string | null>(engine.getLastError());
  const [engineProgress, setEngineProgress] = useState<EngineProgress | null>(engine.getProgress());

  useEffect(
    () =>
      engine.onStatus((status) => {
        setEngineStatus(status);
        setEngineError(engine.getLastError());
      }),
    [],
  );
  useEffect(() => engine.onProgress(setEngineProgress), []);
  useEffect(() => {
    void engine.warmUp();
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await engine.send({ kind: "audit", source: sourceText });
      setFindings(result as AuditFinding[]);
    } catch (err) {
      if (err instanceof EngineError) {
        setError(err.message);
      } else {
        setError("ENGINE: AUDIT_FAILED");
      }
    } finally {
      setRunning(false);
    }
  }, [sourceText]);

  const reset = useCallback(() => {
    setSourceText(SAMPLE_SOURCE);
    setFindings(null);
    setError(null);
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const copyShareLink = useCallback(() => {
    const encoded = encodeAuditState(sourceText);
    if (encoded.length > MAX_STATE_CHARS) {
      setToast("This source is too long for a share link — share it as a file instead");
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}#/audit?state=${encoded}`;
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      clipboard
        .writeText(link)
        .then(() => setToast("Share link copied — it rebuilds this exact audit"))
        .catch(() => setToast("Could not copy — the address bar has the same link"));
    } else {
      setToast("Could not copy — the address bar has the same link");
    }
    setSearchParams(new URLSearchParams([["state", encoded]]));
  }, [sourceText, setSearchParams]);

  const engineFailed = engineStatus === "failed";
  const slowBoot = useSlowBoot(engineStatus === "loading");
  const statusLine =
    engineStatus === "ready"
      ? "Engine ready — the audit runs locally"
      : engineStatus === "loading"
        ? `${bootProgressLabel(engineProgress)}…`
        : engineStatus === "failed"
          ? `Engine unavailable — ${engineFailureMessage(engineError)}`
          : "Engine idle";

  return (
    <div className="stack">
      <header className="panel">
        <h1 className="panel-title">Audit a contract</h1>
        <p className="panel-note">
          The same gallery <code>ekit audit</code> runs in CI — floats in comparisons,
          unbounded inputs, zero tolerances, hallucination-prone citations, and the other
          anti-patterns from docs/anti-patterns.md. Findings are reasons to look, not
          verdicts: every rule links to the anti-pattern it guards.
        </p>
        <p className="small muted">{statusLine}</p>
        {engineStatus === "loading" && slowBoot ? (
          <p className="small muted">
            The first visit downloads about 13 MB of engine files. A slow connection can
            take a few minutes; the page keeps trying while the download is making
            progress.
          </p>
        ) : null}
      </header>

      <section className="panel">
        <h2 className="panel-title">Your contract</h2>
        <textarea
          aria-label="Contract source"
          className="audit-source"
          rows={14}
          spellCheck={false}
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
        />
        {toast ? <p className="small toast">{toast}</p> : null}
        {error ? <ErrorNotice message={error} /> : null}
        {engineFailed ? (
          <ErrorNotice
            message={`Engine failed to start — ${engineFailureMessage(engineError)}`}
            action={
              <div className="btn-row">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    void engine.retry();
                  }}
                >
                  Retry engine
                </button>
                {engineError ? <code className="small muted">{engineError}</code> : null}
              </div>
            }
          />
        ) : null}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={running || engineFailed}
          >
            {running ? "Auditing" : "Run audit"}
          </button>
          <button type="button" className="btn" onClick={copyShareLink} disabled={running}>
            Copy share link
          </button>
          <button type="button" className="btn" onClick={reset} disabled={running}>
            Reset
          </button>
          <span className="small muted">{sourceText.length} chars</span>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Findings</h2>
        {findings === null ? (
          <EmptyState
            title="Run the audit to see findings — the sample source trips known rules on purpose."
            action={
              <button
                type="button"
                className="btn"
                onClick={() => void run()}
                disabled={running || engineFailed}
              >
                Audit the sample
              </button>
            }
          />
        ) : findings.length === 0 ? (
          <p className="gaps-ok">
            0 findings — no known anti-pattern in this source. The gallery is heuristic:
            it cannot prove a rule is tight, run <code>ekit tighten</code> for that.
          </p>
        ) : (
          <ul className="audit-findings">
            {findings.map((finding, index) => (
              <li key={`${finding.rule}-${finding.line}-${index}`} className="finding-row">
                <code className="finding-rule">{finding.rule}</code>
                <span className="finding-line">line {finding.line}</span>
                <span className="finding-message">{finding.message}</span>
                <a
                  className="finding-doc"
                  href={`https://github.com/habte-selassie27/equivalence-kit/blob/main/${finding.doc}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  anti-pattern
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
