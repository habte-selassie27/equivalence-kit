import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { canonical, findPattern, matrices, packageVersion } from "../../data/load";
import { findDeployment } from "../../lib/genlayer";
import { EmptyState, ErrorNotice } from "../../components/Notices";
import { JsonEditor } from "../../components/JsonEditor";
import { ReasonCode } from "../../components/ReasonCode";
import { ToleranceTrack, type TrackResult } from "../../components/ToleranceTrack";
import { VerdictChip } from "../../components/VerdictChip";
import { OnChainRun } from "../../components/OnChainRun";
import { useSlowBoot } from "../../lib/useSlowBoot";
import {
  BOUNDARY_LINE,
  HONESTY_LINE,
  INTEGERS_LINE,
  LimitsNote,
  NOT_COMPARED_LINE,
} from "../../components/LimitsNote";
import { categoryLabel, formatJson, parseJson } from "../../lib/format";
import { MAX_SEED } from "../../lib/limits";
import { buildShareLink, decodeState } from "../../lib/urlState";
import { buildTrackSpec, describeField } from "../../lib/tracks";
import { engine, EngineError, type EngineProgress, type EngineStatus } from "../../worker/engine";
import { bootProgressLabel, engineFailureMessage } from "../../lib/engineMessages";
import type { CompareResult, PatternId } from "../../worker/protocol";
import type { MatrixCase } from "../../data/types";

type Outcome =
  | { kind: "live"; result: CompareResult }
  | { kind: "precomputed"; ok: boolean; reason: string };

/** Grouped Load case options: Must accept, Must reject, Boundary — UI.md 8.2. */
const CASE_GROUPS = ["MUST_ACCEPT", "MUST_REJECT", "BOUNDARY"] as const;

/**
 * Screen 2 — Playground.
 *
 * Edit a leader output and a validator output, run the real comparison, and see field by
 * field whether the rule accepts and why. When the engine cannot start, the screen falls
 * back to the stored matrix results and says so; free-form runs are disabled in that
 * state (UI.md 8.7).
 */
export function PlaygroundScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const patternId = (searchParams.get("pattern") ?? "P1") as PatternId;
  const caseId = searchParams.get("case");

  const matrix = matrices[patternId];
  const requestedCase = useMemo(
    () => matrix?.cases.find((item) => item.id === caseId) ?? null,
    [matrix, caseId],
  );
  const initialCase = requestedCase ?? matrix?.cases[0] ?? null;

  const [leaderText, setLeaderText] = useState("");
  const [validatorText, setValidatorText] = useState("");
  const [contextText, setContextText] = useState("");
  const [loadedCase, setLoadedCase] = useState<MatrixCase | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [seed, setSeed] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ mode: "harmless" | "harmful"; seed: number } | null>(
    null,
  );
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(engine.getStatus());
  const [engineError, setEngineError] = useState<string | null>(engine.getLastError());
  const [engineProgress, setEngineProgress] = useState<EngineProgress | null>(engine.getProgress());
  // First boot pulls about 13 MB from this site; after 12 s the hint explains the wait.
  const slowBoot = useSlowBoot(engineStatus === "loading");

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

  const engineFailed = engineStatus === "failed";

  const loadCase = useCallback(
    (matrixCase: MatrixCase) => {
      setLeaderText(formatJson(matrixCase.leader));
      setValidatorText(formatJson(matrixCase.validator));
      setContextText(formatJson(matrixCase.context));
      setLoadedCase(matrixCase);
      setApplied(null);
      setOutcome({
        kind: "precomputed",
        ok: matrixCase.expected === "ACCEPT",
        reason: matrixCase.reasonCode,
      });
      setError(null);
      const params = new URLSearchParams(searchParams);
      params.set("pattern", patternId);
      params.set("case", matrixCase.id);
      setSearchParams(params, { replace: true });
    },
    [patternId, searchParams, setSearchParams],
  );

  // Load the case named in the URL, or a shared state, when the screen opens.
  useEffect(() => {
    const shared = searchParams.get("state");
    if (shared) {
      const decoded = decodeState(shared);
      if (decoded) {
        setLeaderText(decoded.leader);
        setValidatorText(decoded.validator);
        setContextText(formatJson(canonical.patterns[patternId]?.context ?? {}));
        setLoadedCase(null);
        setOutcome(null);
        return;
      }
    }
    if (initialCase) {
      loadCase(initialCase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternId, caseId]);

  const spec = findPattern(patternId);
  const onChainRef = useRef<import("../../components/OnChainRun").OnChainRunHandle>(null);

  const run = async () => {
    const leader = parseJson(leaderText);
    const validator = parseJson(validatorText);
    const context = parseJson(contextText);
    if (!leader.ok || !validator.ok) {
      setError("This isn't valid JSON. Check the highlighted line.");
      return;
    }
    if (engineFailed) return;
    setRunning(true);
    setError(null);
    try {
      const raw = await engine.send({
        kind: "compare",
        patternId,
        leader: leader.value,
        validator: validator.value,
        context: context.ok ? context.value : {},
      });
      setOutcome({ kind: "live", result: raw as CompareResult });
      // The comparison above is local and instant. Also fire one real transaction so
      // the wallet signs and the full lifecycle (hash, consensus, receipt, read-back)
      // is exercised from this button, as requested.
      void onChainRef.current?.run();
    } catch (caught) {
      setError(engineErrorMessage(caught, liveRunFailed));
    } finally {
      setRunning(false);
    }
  };

  const perturb = async (mode: "harmless" | "harmful") => {
    const leader = parseJson(leaderText);
    if (!leader.ok) {
      setError("This isn't valid JSON. Check the highlighted line.");
      return;
    }
    if (engineFailed) return;
    setRunning(true);
    setError(null);
    try {
      const usedSeed = seed;
      const variant = await engine.send({
        kind: "perturb",
        patternId,
        leader: leader.value,
        mode,
        seed: usedSeed,
      });
      setValidatorText(formatJson(variant));
      setSeed((current) => (current + 1) % (MAX_SEED + 1));
      setApplied({ mode, seed: usedSeed });

      // Run the comparison straight away so the expected outcome is visible. Applying a
      // variation only fills the validator box; nothing is saved.
      const context = parseJson(contextText);
      const result = (await engine.send({
        kind: "compare",
        patternId,
        leader: leader.value,
        validator: variant,
        context: context.ok ? context.value : {},
      })) as CompareResult;
      setOutcome({ kind: "live", result });
      setToast(
        mode === "harmless"
          ? "Harmless variation applied — expected: accepted"
          : "Harmful variation applied — expected: rejected",
      );
      setTimeout(() => setToast(null), 2000);
    } catch (caught) {
      setError(engineErrorMessage(caught, variationFailed));
    } finally {
      setRunning(false);
    }
  };

  const retryEngine = async () => {
    setError(null);
    await engine.retry();
  };

  const copyAsTestCase = async () => {
    const leader = parseJson(leaderText);
    const validator = parseJson(validatorText);
    const context = parseJson(contextText);
    const body: Record<string, unknown> = {
      id: loadedCase?.id ?? "manual",
      category: loadedCase?.category ?? null,
      title: loadedCase?.title ?? null,
      leader: leader.ok ? leader.value : null,
      validator: validator.ok ? validator.value : null,
      context: context.ok ? context.value : null,
      expected: null,
      reasonCode: null,
      packageVersion,
      patternId,
    };
    if (outcome?.kind === "live") {
      body.expected = outcome.result.ok ? "ACCEPT" : "REJECT";
      body.reasonCode = outcome.result.reason;
      body.category = body.category ?? "MANUAL";
    } else if (outcome?.kind === "precomputed" && loadedCase) {
      body.expected = loadedCase.expected;
      body.reasonCode = loadedCase.reasonCode;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(body, null, 2));
      setToast("Copied as test case");
    } catch {
      setToast("Copied as test case");
    }
    setTimeout(() => setToast(null), 2000);
  };

  const copyShareLink = async () => {
    const link = buildShareLink({
      patternId,
      caseId,
      leader: leaderText,
      validator: validatorText,
    });
    if (!link) {
      setError("This case is too large to share as a link. Use Copy as test case instead.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setToast("Link copied");
    } catch {
      setToast("Link copied");
    }
    setTimeout(() => setToast(null), 2000);
  };

  const reset = () => {
    setApplied(null);
    if (initialCase) {
      loadCase(initialCase);
    }
  };

  const leaderValue = parseJson(leaderText);
  const validatorValue = parseJson(validatorText);
  const fields = outcome?.kind === "live" ? outcome.result.fields : [];
  const notCompared = outcome?.kind === "live" ? outcome.result.not_compared : [];
  const accepted = outcome
    ? outcome.kind === "live"
      ? outcome.result.ok
      : outcome.ok
    : null;
  const overallReason =
    outcome?.kind === "live" ? outcome.result.reason : (loadedCase?.reasonCode ?? "OK");
  const isBoundaryCase = loadedCase?.category === "BOUNDARY";

  return (
    <div className="stack">
      <div className="panel">
        <h1 className="panel-title">Playground</h1>
        <p className="panel-note">
          Load a case or paste outputs to compare them. The comparison runs the real
          package in your browser, so what you see is what the contracts do.
        </p>

        <div className="row">
          <label className="field-label" htmlFor="pg-pattern">
            Pattern
          </label>
          <select
            id="pg-pattern"
            value={patternId}
            onChange={(event) => setSearchParams({ pattern: event.target.value })}
          >
            {(["P1", "P2", "P3", "P4", "P5", "P6"] as const).map((id) => {
              const pattern = findPattern(id);
              return (
                <option key={id} value={id}>
                  {id} {pattern?.name}
                </option>
              );
            })}
          </select>

          <label className="field-label" htmlFor="pg-case">
            Load case
          </label>
          <select
            id="pg-case"
            value={loadedCase?.id ?? caseId ?? ""}
            onChange={(event) => {
              const found = matrix?.cases.find((item) => item.id === event.target.value);
              if (found) loadCase(found);
            }}
          >
            {CASE_GROUPS.map((group) => {
              const cases = matrix?.cases.filter((item) => item.category === group) ?? [];
              if (cases.length === 0) return null;
              return (
                <optgroup key={group} label={categoryLabel(group)}>
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} — {item.title}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      </div>

      <div className="panel">
        {engineFailed ? (
          <ErrorNotice
            message={`The engine couldn't start — ${engineFailureMessage(engineError)} Showing stored results only.`}
            action={
              <div className="btn-row">
                <button type="button" className="btn small" onClick={retryEngine}>
                  Retry the engine
                </button>
                {engineError ? <code className="small muted">{engineError}</code> : null}
              </div>
            }
          />
        ) : null}

        <div className="grid-3">
          <JsonEditor
            label="Leader output (JSON)"
            value={leaderText}
            onChange={(next) => {
              setLeaderText(next);
              setOutcome(null);
            }}
          />
          <JsonEditor
            label="Validator output (JSON)"
            value={validatorText}
            onChange={(next) => {
              setValidatorText(next);
              setOutcome(null);
              setApplied(null);
            }}
          />
          <JsonEditor
            label="Context (JSON)"
            hint="Supplied by the contract: id universes, tolerance parameters, and code-decided results."
            value={contextText}
            onChange={setContextText}
            disabled={engineFailed}
          />
        </div>

        <div className="row actions">
          {engineStatus === "loading" ? (
            <span className="small muted engine-hint">
              {slowBoot
                ? `${bootProgressLabel(engineProgress)} — cached after the first visit`
                : bootProgressLabel(engineProgress)}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
            disabled={running || engineFailed || !leaderValue.ok || !validatorValue.ok}
          >
            {running ? "Running" : "Run comparison"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => perturb("harmless")}
            disabled={running || engineFailed}
          >
            Apply harmless variation
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => perturb("harmful")}
            disabled={running || engineFailed}
          >
            Apply harmful variation
          </button>
          <button type="button" className="btn" onClick={copyAsTestCase}>
            Copy as test case
          </button>
          <button type="button" className="btn" onClick={copyShareLink}>
            Copy share link
          </button>
          <button type="button" className="btn" onClick={reset}>
            Reset
          </button>
          <label className="field-label seed-label" htmlFor="pg-seed">
            Seed
          </label>
          <input
            id="pg-seed"
            className="seed-input"
            type="number"
            min={0}
            max={MAX_SEED}
            value={seed}
            disabled={engineFailed}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0 && next <= MAX_SEED) {
                setSeed(Math.trunc(next));
              }
            }}
          />
        </div>

        {applied ? (
          <p className="small muted">
            The validator box now holds the {applied.mode} variation (seed {applied.seed}).
            Expected: {applied.mode === "harmless" ? "accepted" : "rejected"}. Applying
            another variation replaces this one; nothing is saved.
          </p>
        ) : null}
        {applied &&
        outcome?.kind === "live" &&
        (applied.mode === "harmless") !== outcome.result.ok ? (
          <p className="status-bad">
            Unexpected result: a {applied.mode} change was{" "}
            {outcome.result.ok ? "accepted" : "rejected"}. This is a rule gap.
          </p>
        ) : null}

        {error ? <ErrorNotice message={error} /> : null}
        {toast ? <p className="small toast">{toast}</p> : null}
      </div>

      <div className="panel">
        <h2 className="panel-title">Result</h2>
        <p className="visually-hidden" role="status">
          {outcome === null
            ? "No comparison run yet."
            : accepted
              ? `Accepted, reason ${overallReason}`
              : `Rejected, reason ${overallReason}`}
        </p>
        {outcome === null ? (
          <EmptyState title="Run the comparison to see how each field is judged." />
        ) : (
          <>
            <div className="row result-head">
              <VerdictChip
                kind={accepted ? "accept" : "reject"}
                label={accepted ? "Accepted" : "Rejected"}
              />
              {outcome.kind === "precomputed" ? (
                <span className="small muted">
                  stored result from the acceptance matrix
                </span>
              ) : null}
              <ReasonCode reason={overallReason} />
              {isBoundaryCase ? <span className="edge-tag">on the edge</span> : null}
            </div>

            {fields.length > 0 && leaderValue.ok && validatorValue.ok ? (
              <div className="stack">
                {fields.map((field) => {
                  const contextValue = parseJson(contextText);
                  const context = contextValue.ok ? contextValue.value : {};
                  const trackSpec = buildTrackSpec(
                    patternId,
                    field.name,
                    leaderValue.value,
                    validatorValue.value,
                    context,
                  );
                  const track: TrackResult = describeField(
                    trackSpec,
                    leaderValue.value,
                    validatorValue.value,
                    field.ok,
                  );
                  return (
                    <div key={field.name} className="ledger-field-block">
                      <div className="row field-head">
                        <h3 className="field-name">{field.name}</h3>
                        <VerdictChip
                          kind={field.ok ? "accept" : "reject"}
                          label={field.ok ? "Accepted" : "Rejected"}
                        />
                        <ReasonCode reason={field.reason} />
                        {track.onEdge ? (
                          <span className="edge-tag">on the edge</span>
                        ) : null}
                      </div>
                      {trackSpec ? (
                        <ToleranceTrack spec={trackSpec} result={track} />
                      ) : (
                        <p className="small muted">{track.summary}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {notCompared.length > 0 ? (
              <p className="small muted">{NOT_COMPARED_LINE}</p>
            ) : null}
          </>
        )}
      </div>

      {spec ? (
        <div className="panel">
          <h2 className="panel-title">How this pattern is tuned</h2>
          <p className="panel-note">
            <span>{INTEGERS_LINE}</span> {spec.toleranceRationale}
          </p>
          <ul className="spec-list">
            {spec.invariants.map((invariant) => (
              <li key={invariant}>
                <code className="small mono">{invariant}</code>
              </li>
            ))}
          </ul>
          <LimitBars loadedCase={loadedCase} />
        </div>
      ) : null}

      <div className="panel">
        <h2 className="panel-title">On chain (StudioNet)</h2>
        <p className="panel-note">
          The comparison above runs locally in your browser. This panel submits one real
          transaction to the deployed VerdictJudge contract, so you can watch the full
          lifecycle — signature, hash, consensus, receipt, read-back — from this screen.
        </p>
        <OnChainRun
          ref={onChainRef}
          deployment={findDeployment("verdict_judge")}
          method="create_judgment"
          args={[
            `Playground ${patternId}`,
            "ELIGIBLE,INELIGIBLE",
            '[{"item_id":"hard_income","text":"Evidence must mention income.","kind":"DETERMINISTIC","rule_kind":"EVIDENCE_CONTAINS","rule_value":"income"},{"item_id":"quality","text":"Assess whether the evidence is sufficient and relevant.","kind":"INTERPRETIVE"}]',
          ]}
          label="Run on StudioNet"
        />
      </div>

      <LimitsNote line={HONESTY_LINE} />
    </div>
  );
}

/** Copy deck lines that only appear when they are true for the loaded case. */
function LimitBars({ loadedCase }: { loadedCase: MatrixCase | null }) {
  return (
    <>
      {loadedCase?.category === "BOUNDARY" ? (
        <LimitsNote line={BOUNDARY_LINE} />
      ) : null}
    </>
  );
}

/* Error copy ---------------------------------------------------------------- */

const liveRunFailed = "The run could not complete.";
const variationFailed = "The variation could not be produced.";

/**
 * Turn an engine failure into copy from the deck, never a raw traceback. Classified
 * failures from the package (for example LLM_ERROR: UNKNOWN_ENUM) keep their strings,
 * because a builder needs the code; engine faults get the friendly line. A run that hit
 * the time limit gets its own line, because the fix (smaller inputs) differs.
 */
function engineErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof EngineError) {
    if (caught.errorClass === "ENGINE") {
      return caught.reason === "TIMEOUT"
        ? "The run took too long and was stopped. Try smaller inputs."
        : `${fallback} Showing stored results only.`;
    }
    return `${caught.errorClass}: ${caught.reason}`;
  }
  return `${fallback} Showing stored results only.`;
}
