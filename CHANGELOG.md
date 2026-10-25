# Changelog

All notable changes to EquivalenceKit are recorded here. Format follows Keep a Changelog.

## [Unreleased]

### Fixed — the engine now survives a slow or flaky first download

The deployed playground could show `Engine failed to start — ENGINE: Failed to fetch
dynamically imported module: .../pyodide.asm.js` and disable the audit box. The runtime
was reachable; the boot budget was the bug. A fixed 60-second limit treated a working
13 MB download on a slow connection as a hung engine, and a dropped connection had no
retry.

- **Heartbeat watchdog** (`frontend/src/worker/engine.ts`): the worker reports every boot
  phase (`import`, `runtime`, `package`, `python`) and sends a heartbeat every five
  seconds inside a phase. The main thread now treats 120 seconds without a heartbeat as a
  stall, with a 15-minute absolute ceiling. A measured first boot at 150 KB/s completed
  in 89.5 seconds; the old watchdog failed it at 60.
- **Automatic retry** (`frontend/src/worker/bootRetry.ts`): three attempts with backoff
  for browser network failures (`Failed to fetch`, `ERR_NETWORK_CHANGED`, failed dynamic
  imports). A dropped `pyodide.asm.js` request was re-requested and the engine reached
  ready in 14.6 seconds. Deterministic failures (missing package file, Python import
  error) are not retried.
- **Actionable errors** (`frontend/src/lib/engineMessages.ts`): the page says the engine
  files could not be downloaded and offers Retry, instead of printing a browser import
  error. The raw code (`ENGINE: BOOT_NETWORK`, `ENGINE: TIMEOUT`) stays visible in small
  text for debugging.
- **Caching** (`vercel.json`): `/pyodide/*` is cached for seven days, Vite's hashed
  `/assets/*` for a year, and `/pkg/*` revalidates. The first visit still downloads about
  13 MB; repeat visits no longer re-download it.
- **Tests**: 13 new frontend tests (boot stall and ceiling, heartbeat reset, run budget,
  retry classification, friendly messages); frontend suite 119 passing, 1 live-RPC test
  skipped.

### Added — the toolchain loop: write a rule, prove it tight, audit it, ship it

The kit stops being reference-only and becomes something a builder runs on their own
work. Everything below is delivered with tests and wired into CI and the README.

- **`ekit tighten`** (`equivalencekit/tighten.py`): the harmless/harmful report for
  user-supplied rules. Point `--rules` at a module with
  `compare(leader, validator, context)` and `--fixtures` at a file in the same case
  shape as the acceptance matrices; `--pattern P1..P6` also sends the kit's perturbation
  generators through the user's rule; `--check` exits non-zero unless the rule is tight
  (CI gate); `--init` writes a worked starter pair. A crash and a reasonless reject are
  reported as rule bugs, never as decisions. 13 tests.
- **Browser audit box** (`frontend/src/screens/Audit/`): paste a contract, run the same
  `audit_source` the CI gate runs, inside the Pyodide worker (new `audit` request kind
  in the worker protocol). Findings carry rule ids, lines, and links to
  `docs/anti-patterns.md`; a share link (hash `?state=`) rebuilds the exact audit;
  verified against the real engine — the sample trips A18 and A13 identically to the
  CLI. 8 screen tests.
- **SARIF output for `ekit audit`** (`equivalencekit/sarif.py`): stable SARIF 2.1.0
  serialization (`--sarif [FILE]`), so findings land in GitHub code scanning on every
  PR. `audit.yml` now uploads it while staying a merge gate. 6 tests.
- **Audit rule A24** — `strict_eq` on model or web output: the most expensive too-strict
  failure (a resolution that can never finalize) had no scanner rule. The rule was added
  after auditing real public contracts: pm-kit's `crypto_prediction_market.py` and
  `stock_prediction_market.py` (MIT, pinned `208ca03`) both wrap a live-price prompt in
  `gl.eq_principle.strict_eq` and store a model-chosen winner without checking it is one
  of the two allowed sides. `tests/primitives/test_audit.py` pins the pm-kit shape and
  the `# ekit: ignore A24` escape hatch for legit code-decided uses.
- **Real-world case study** (`docs/case-study.md`): four public contract files audited
  with repro commands and pinned SHAs, findings analyzed one by one — including the
  honest negatives (one heuristic near-false-positive explained) and the gap the scan
  found in itself (A24, fixed the same day). A friendly issue draft for pm-kit is
  included; posting it is deliberately left to the project owner.
- **Property tests** (`tests/primitives/test_properties.py`): ten Hypothesis properties
  over bounded random input — normalizer idempotence, id-list order/duplicate
  insensitivity, `int_within_bps` equals the documented cross-multiplication rule,
  bucket monotonicity with inclusive edges, ordinal distance never exceeds the declared
  steps, set/subset comparators never raise. `hypothesis` added to `requirements.txt`
  and CI.
- **Mutation harness** (`tests/matrices/test_mutation.py`): five deterministic mutants
  of `compare.py` — boundary drifts in `int_within_bps`/`int_within_abs`/`ordinal_within`,
  a dropped `subset_of` check, an `enum_equal` polarity flip — each compiled and grafted
  over the patterns, every acceptance-matrix case re-run; a surviving mutant fails the
  suite. The matrices are thereby proven to catch the bug classes they claim to.
- **Demo GIF** (`docs/assets/demo.gif`, recorded on the real app): the playground
  accepting reordered citations and the audit box flagging a pasted contract.
- **One-page decision tree** at the top of `docs/decision-guide.md`.
- **GitHub issue templates** (bug report, rule proposal) with a contact link to the
  official Equivalence Principle docs.

### Changed

- Repository renamed to [`habte-selassie27/equivalence-kit`](https://github.com/habte-selassie27/equivalence-kit)
  (old URLs redirect); every link, clone URL, and badge updated.
- CI now also runs `tests/site` + site-data freshness check and a full frontend job
  (typecheck, unit tests, package sync, production build).
- README: counts refreshed (319 local tests, 106 frontend tests), kit table now covers
  the whole CLI (`tighten`, `scaffold`, `matrix`, `diagnose`) and the mutation harness,
  and the docs table gains the case study. Wheel build verified: `python -m build`
  produces a wheel with the `ekit` entry point and the new modules shipped
  (a PyPI upload still needs a maintainer token — deliberately not automated).

### Fixed — the receipt the SDK returns is snake_case, and the Live screen read camelCase

Verifying the wallet write against StudioNet caught a bug the mocked tests could not: the
SDK's TypeScript declarations describe camelCase receipt fields (`statusName`,
`numOfRounds`, `lastRound.validatorVotesName`), but the RPC returns snake_case
(`status_name`, `num_of_rounds`, `last_round.validator_votes_name`). The Finality panel
read the declared names, so a real finalized transaction would have shown "Execution
result: unknown" and no vote chips — exactly the guess-the-API failure this repo exists
to prevent, and the mocks encoded the same wrong guess.

- `frontend/src/lib/genlayer.ts::summarizeReceipt` now decodes the measured shape (and
  falls back to the camelCase spelling and to `consensus_data.votes` when the round block
  is absent). Consensus (`MAJORITY_AGREE`) and execution (`FINISHED_WITH_RETURN` /
  `FINISHED_WITH_ERROR`, from the leader receipt) are reported as two separate facts.
- `frontend/src/lib/receipt.test.ts` (5 tests) pins the decoder to a fixture transcribed
  from a real finalized receipt, not from the type declarations.
- `frontend/src/lib/genlayer.live.test.ts`: a gated live test that drives the **real**
  `connectWallet` and `submitRecordWrite` against StudioNet. Everything is real — SDK,
  RPC, deployed contract, consensus round, receipt, read-back — except the wallet UI,
  which is replaced by the smallest EIP-1193 provider (a local key that forwards plain
  RPC reads and asks the SDK to broadcast). Skipped unless `RUN_LIVE=1`, because it
  writes to a live network and waits out a real round.
- Evidence (StudioNet, gasless, 0 GEN):
  - `0x3b29a0c6a013d457fc60f819d8dc9a2c017f9f01e7f8c170de5831cdf5c01891` —
    `create_judgment` submitted directly to the contract address, ACCEPTED → FINALIZED,
    MAJORITY_AGREE, and the record (`judgment 1`, title "Live screen write check") is
    still in the committed state.
  - `0x4d9d4e74ddc9750c174b1b08e19903d552335d3bf3febc7ab002fbf015af679a` — the same
    call through the wallet path, FINALIZED / MAJORITY_AGREE, record read back
    correctly straight after finality, then absent from committed state (see the next
    entry). It self-documents as "Live screen wallet-path check" in the explorer.

### Found — StudioNet rolls committed state back after finality

Verifying the wallet write surfaced something the UI must never paper over: **finality is
not persistence on StudioNet**, and the contract's own counter can move backwards.

Measured on 2026-10-23 on the deployed VerdictJudge (`0xC4B6…`), gasless, 0 GEN:

- Three `create_judgment` writes — one submitted directly to the contract address, two
  through the wallet path (`eth_sendTransaction` via an EIP-1193 provider, which the SDK
  wraps in an EVM call to the rollup contract `0x6cC47A13…`) — all finalized
  `MAJORITY_AGREE` with correct calldata and `FINISHED_WITH_RETURN`, and each read its
  new record back successfully straight after finality.
- Later in the same session, two of those records were gone: `get_judgment(2)` and
  `get_judgment(3)` both fail with `execution failed`, at every `stateStatus` (`latest`,
  `accepted`, `final`), and `judgments_created` had moved **backwards** from 3 to 2. A
  monotonic counter going backwards is unambiguous evidence of a state rollback, not of
  a failed write. The record written at 14:51 UTC survived; the later ones did not.

So: the write path — connect, sign, submit, consensus, receipt decoding, read-back — is
verified working end to end, and nothing in this repo is at fault. What the finding
changes is what the UI is allowed to claim:

- The Live screen no longer hides a missing read-back. Finality with no record now
  renders an explicit notice: finality is not proof that state persisted, re-read the
  record, and treat the explorer receipt as the authority.
- The live test gained a persistence re-check that waits 90 s after finality, prints
  `PERSISTED` / `NOT PERSISTED` loudly, and fails only with `LIVE_REQUIRE_PERSISTENCE=1`,
  so the measurement is repeatable without making the default run flaky.
- Worth stating in any demo: StudioNet is a development network. Do not treat state
  written there as durable, and do not build flows that assume a record survives.

- Also measured: `client.connect` asks the wallet for `wallet_getSnaps` /
  `wallet_requestSnaps` and needs an object back (a null crashes inside the SDK), and
  the StudioNet RPC's `eth_chainId` is `0xf22f`. Both are recorded in the live test.

### Added — the Live screen: the frontend now calls the deployed contracts

`/live` is the first screen that touches the chain. It uses the official `genlayer-js`
SDK (installed as `frontend` dependency `genlayer-js@1.1.8`) and the three StudioNet
addresses recorded in `deployments/studionet.md`.

- **Reads need no wallet.** A view-method picker per contract (`get_config`,
  `get_judgment`, `get_attestations`, `get_ranking`, …) calls the deployed contract and
  renders exactly the JSON that came back — the same strings the Python tests assert on.
  The config read runs on arrival, so the screen proves its own call path.
- **Writes are signed in the wallet and followed end to end.** The full lifecycle is
  rendered step by step: signature, transaction hash (linked to the explorer), the live
  consensus status while validators vote, the final receipt with the validator votes and
  the execution result — reported separately from finality, because a transaction can
  finalize with a failed execution — and finally a view call that reads the new record
  back so the write is proven to have landed. The new id comes from the `get_config()`
  counter read before the write, the same way the deployment tests find it.
- The create methods are prefilled with the values that already reached consensus on
  StudioNet, so the first run is a known-good transaction; JSON arguments are validated
  in the browser before they can be sent.
- The SDK is loaded with a dynamic import, so it costs nothing until the screen is used
  and the rest of the site keeps working if it never loads. The StudioNet RPC reflects
  the page origin (`access-control-allow-origin`), verified before this shipped.
- `frontend/src/lib/genlayer.ts` is the only module that touches the SDK; everything
  else talks to its small structural API, so the screen's tests drive the lifecycle with
  the bridge mocked. 9 new frontend tests (91 total).
- `tests/site/test_site_data.py`: two new gates — every address and contract file in the
  Live registry must appear in `deployments/studionet.md`, and every contract file must
  exist on disk. A deployment that moves can no longer drift from the screen silently.

### Fixed — the two documented `ekit --json` output paths

Both machine-readable modes advertised in the README and shown on the Developer's guide
screen were broken; neither had a test, and CI only exercised the text path.

- **`ekit audit <path> --json` crashed** with `NameError: name 'json' is not defined`
  (`equivalencekit/audit.py` never imported `json`), so the "JSON output for CI" the
  README and changelog promise did not exist.
- **`ekit matrix <path> --json` was not parseable**: the human `TOTAL:` / `PERTURBATIONS:`
  summary was printed after the JSON document. The totals already live inside the payload,
  so those lines are now text-mode only and JSON mode emits exactly one document.
- `tests/primitives/test_cli.py` (6 tests) shells the real `cli.main` entry point and
  parses the full stdout with `json.loads`, covering clean and finding-bearing audits,
  text mode, matrix `--json`, and `--json --check`.

### Fixed — M14 security audit of the three reference contracts

A senior audit of `verdict_judge`, `web_fact_attestor`, and `ranking_judge` found one
HIGH and five MEDIUM issues, plus a set of design and maintainability items. All P0, P1,
and P2 findings are fixed; the P3 items are fixed where they were free.

- **HIGH — `ranking_judge` discarded submitted evidence.** The reference text was
  validated and then dropped; the model received only identifiers (`ev0-0`) as its data,
  so the contract performed non-deterministic evaluation with no evidence. The evidence is
  now stored as a record and rendered into the prompt, and a sentinel-prompt test proves
  it reaches the model.
- **MEDIUM — `ranking_judge` declared round and history caps it never enforced.** Now
  enforced on the round count; `get_config()` reports only limits that are enforced.
- **MEDIUM — `ranking_judge` permitted a vacuous equivalence rule.** `min_overlap_pct = 0`
  accepted two completely disjoint rankings; there is now a floor of 1 percent.
- **MEDIUM — `web_fact_attestor` accepted any URL.** HTTPS is now required and literal
  loopback, link-local, and private hosts are rejected, so a spec creator cannot aim the
  validators at their own network or at cloud instance metadata.
- **MEDIUM — `web_fact_attestor` stored a leader-supplied, unverified digest under a name
  that overstated it.** Renamed to `leader_snapshot_digest` and documented as the leader's
  own fingerprint, never compared.
- **MEDIUM — `web_fact_attestor` rounds were griefable and unattributable.** Only the spec
  creator or the previous requester may open a later round.
- **MEDIUM — `verdict_judge.evaluate` also accepted a CHALLENGED judgment**, making
  `re_evaluate` redundant. `evaluate` now requires OPEN.
- **MEDIUM — `ranking_judge.challenge` was creator-only** while `submit_evidence` was
  permissionless. Evidence submitters may now challenge, matching `verdict_judge`.
- **LOW — `verdict_judge.submit_evidence` relied on the SDK's write-through behaviour**
  for a nested `DynArray`. It now uses `copy_to_memory` plus an explicit write-back, like
  every other method.
- **LOW — `ranking_judge` duplicated its consensus block** in `rank` and `re_rank`. Both
  now call one `_rank(ranking_id, require_challenged)` helper.
- **LOW — the post-consensus fact check compared the agreed facts with themselves.** A
  dedicated `validate_facts(facts, rules)` primitive now expresses the intent.
- **LOW — `verdict_judge` spent a consensus round when every verdict was forbidden.** It
  now fails with `EXPECTED: INVALID_STATE` before asking the model.
- **HIGH — `ranking_judge` passed its human-facing digest into the P4 schema check.** The
  pattern's field set is `("ranking",)`, so every validator failed with `UNEXPECTED_FIELD`
  before the overlap rule ran and a ranking round could never finalize. Direct tests missed
  it because direct mode executes the leader only; the live StudioNet round exposed it. The
  digest is now stripped at the call site, and a validator-level direct test covers it
  (anti-pattern A23).

New in this pass:
- `equivalencekit/compare.py::validate_facts`: shape and range validation of one fact set,
  which never claims to compare two sets. Covered by the vendored-equivalence gate.
- `tests/integration/test_ranking_judge_consensus.py`: RankingJudge under real consensus.
- `tests/deploy/test_studionet_deployment.py` now also deploys RankingJudge.
- `docs/anti-patterns.md`: six new entries (A17–A22) for the audit findings.
- `docs/threat-model.md`: seven new threats (T16–T22) and four new residual risks.

### Changed — a bucket fact holds the raw measurement

A `BUCKET_WORD_COUNT` fact now stores the **raw word count**, not the bucket index. The
comparator buckets both sides under the rule's edges, which is what lets two fetches that
differ by a few words still agree — and it keeps the stored fact informative. Previously the
contract stored the index while `bucket_adjacent` (which buckets both sides) expected a
measurement, so the two disagreed about what a bucket fact meant.

Stored facts are now canonical in general: a boolean is `True`/`False`, an enum is the
canonical label, a bucket is the raw integer measurement. The model may return `"yes"` or
`"pro"`; what reaches storage is the normalized value, so a consumer never has to handle
two shapes. `equivalencekit/compare.py::normalize_facts` does the work and
`validate_facts` is the non-throwing wrapper.

### Changed — StudioNet tests no longer need a local node

`gltest`'s `ContractFactory.deploy` asks the *local* node to synthesize a schema from the
contract source, and `gen_getContractSchemaForCode` is a localnet-only capability. The
StudioNet tests now deploy the transaction and fetch the schema of the deployed address
from the hosted API (`gen_getContractSchema`), so they no longer depend on a local node
running. See `tests/helpers.py::deploy_contract`.

### Added — M1 research and verified API ledger
- `docs/contracts.md`: verified GenLayer API ledger (header format, storage classes,
  non-determinism API, web access, LLM calls) with the single-file import-strategy finding.

### Added — M2 normalizers, bounds, errors
- `equivalencekit/normalize.py`: `normalize_text`, `normalize_enum`, `normalize_bool`,
  `normalize_int`, `normalize_ratio_bps`, `normalize_id_list`, `normalize_url`,
  `strip_volatile`, `bucketize`, `extract_headings`, `normalize_ws_lines`. All idempotent,
  bounded, and float-free.
- `equivalencekit/bounds.py`: centralized limits and `require_within`.
- `equivalencekit/errors.py`: closed error registry (`EXPECTED` / `EXTERNAL` / `TRANSIENT` /
  `LLM_ERROR`) producing stable, byte-identical strings.

### Added — M3 comparators
- `equivalencekit/compare.py`: `enum_equal`, `ordinal_within`, `int_within_abs`,
  `int_within_bps`, `bucket_adjacent`, `set_equal`, `subset_of`, `overlap_at_least`,
  `topk_overlap`, `facts_match`, `consistent_with`, `all_of`. Each returns a stable reason
  code; accept, reject, and boundary tests for every one.

### Added — M4 defensive parsing
- `equivalencekit/parsing.py`: `parse_with_spec` with fail-closed schema validation —
  size cap, fence stripping, guarded JSON, required keys, type checks, enum/range checks,
  id-universe checks. Hostile-input tests included.

### Added — M5 patterns, matrices, perturbation
- `equivalencekit/patterns.py`: declarative specs and comparators for P1–P6.
- `tests/matrices/P1.json` … `P6.json` and `canonical.json`.
- `equivalencekit/perturb.py`: seeded harmless and harmful perturbation generators, plus
  `inject_instruction`, `push_value_beyond`, `hallucinate_id`.
- `tools/tightness.py`: per-pattern tightness report.
- Evidence: 106 matrix cases, harmless acceptance 60/60, harmful rejection 60/60.

### Added — M6 VerdictJudge
- `contracts/verdict_judge.py`: P1 consensus with frozen rubrics, deterministic rubric
  checks decided in code before any model call, append-only assessment history, and the
  `OPEN → EVALUATED → CHALLENGED → … → CLOSED` state machine.
- `tools/vendor.py`: AST-based inlining of the pure primitives into a single contract file,
  with a `--check` freshness mode.
- `tests/matrices/test_vendored.py`: proves the vendored copy behaves identically to the
  package on a broad input sample.

### Added — M7 WebFactAttestor
- `contracts/web_fact_attestor.py`: P2 consensus over a frozen fact spec. Headings, phrases,
  and word-count buckets are extracted in code; only `ENUM_FROM_LIST` consults a model.
  `UNAVAILABLE` is a first-class state that is never recorded as a negative finding.
- `equivalencekit/digest.py`: bounded, deterministic, **non-cryptographic** FNV-1a snapshot
  digest, stored for audit and never compared.

### Added — M8 integration tests
- `tests/integration/`: StudioNet tests for both reference contracts — deterministic
  code-decided consensus, real-LLM consensus, challenge and re-evaluation, live page fetch,
  `UNAVAILABLE` on a missing page.
- `contracts/fixtures/consensus_probe.py`: test-only contract proving under real consensus
  that the P1 rule accepts honest one-step band noise and rejects a wrong verdict.
- `tests/helpers.py`: consensus assertions built on validator votes.

### Fixed — M7/M8
- `WebFactAttestor` used `response.status_code` from prose documentation; the pinned SDK
  defines `Response(status, headers, body)`. The contract recorded `UNAVAILABLE` for every
  fetch until direct tests caught it. Recorded in `docs/contracts.md`.
- `gltest.assertions.tx_execution_succeeded` inspects only the *leader* receipt, so it
  returned `True` for a transaction where every validator voted `disagree`. All integration
  and deployment tests now assert on validator votes and on whether the state write
  persisted.
- `tests/conftest.py` skips the live-network test directories unless `--network` names a
  live network, so a plain `pytest tests/` run stays green.

### Added — M9 StudioNet deployment
- `tests/deploy/test_studionet_deployment.py`: deploys both reference contracts, exercises
  each with real reads and real consensus writes, saves `genlayer schema` output, and writes
  `deployments/studionet.md`.
- `deployments/studionet.md`: VerdictJudge `0x34c97Ca059b36C967A11C4c4DE9bEE096e017A4a`,
  WebFactAttestor `0xAeA5d7626807B1821837313cED685d97F73eA80D`. StudioNet is gasless: 0 GEN.
- `tools/export_site_data.py`: generates the playground's data from the repo (pattern specs,
  matrices, canonical examples, tightness report) with a `--check` staleness gate.

### Fixed — M9
- The `genlayer` CLI cannot pass a JSON-string parameter that looks like an array: its
  `--args` parser runs `JSON.parse` and encodes the result as a contract array instead of a
  string. Recorded in `docs/contracts.md`; the deployment uses the genlayer-test client,
  which encodes strings correctly.

### Added — M-UI playground (optional companion)
- `tools/export_site_data.py`: generates the playground's data from the repo (pattern specs,
  acceptance matrices, canonical examples, tightness report) with a `--check` staleness gate.
- `tools/copy_pkg.mjs`: copies the real `equivalencekit` package into `playground/public/pkg/`
  so the browser runs the same primitives the contracts run.
- `playground/`: static Vite + React + TypeScript site with four screens (Patterns,
  Playground, Tightness, Decision guide) and a Pyodide worker. 41 tests pass, including a
  Pyodide engine test that runs every matrix case in the browser's wasm Python and proves
  the precomputed results match the package.
- `playground/src/data/*`: generated site data (9 files), committed and staleness-checked.
- `tests/site/` (planned) left as a TODO; the staleness check runs via
  `tools/export_site_data.py --check`.

### Changed — M-UI visual polish pass
- Same token palette (UI.md 3.3), same restraint rules — radius 2/6, one border weight,
  elevation reserved — but sharper execution everywhere: hairline internal rules
  (`--rule-soft`), hatched perturbation-bar remainder, uppercase table kickers, row-hover
  states, focus rings on every control, text-wrap balance for headings.
- Motion, all disabled under `prefers-reduced-motion`: one screen entrance per navigation,
  loading-dot pulse, toast and bar-fill transitions, pattern-list and guide-option hover
  feedback, rotating boundary-disclosure caret.
- Optional dark scheme now ships with a manual override: one dark token block on
  `[data-theme="dark"]` (no duplicated media-query copy to drift out of step), stamped
  before first paint by an inline bootstrap, plus a header cycle control
  (Auto → Light → Dark) with `localStorage` persistence and OS-preference following
  while in Auto. A tokens test pins that the dark block covers every theme-dependent
  token and never invents one. `color-scheme` and `theme-color` are kept in step at
  runtime. Contrast for all text roles re-checked against the dark surfaces.
- Shell: translucent sticky header with blur, tighter toolbar selects that size to
  content, inline SVG favicon echoing the two track markers.
- Playground: 58 tests green, typecheck and production build clean after the pass.

### Fixed — M-UI playground conformance pass
- Engine boot: the Pyodide worker wrote package files to URL-shaped filesystem paths and
  returned raw JSON strings to the main thread. Package files now mount under a clean
  `/lib` path and every response is parsed to a structured result; the engine reaches
  "Engine ready" and live per-field ledgers render.
- Status honesty: a failed engine reply during warm-up now moves the status line to
  "Using precomputed results" instead of sitting on "Loading the engine" forever, with a
  Retry affordance. Free-form runs are disabled while failed (stored results still shown).
- Tracebacks never leak: worker error classification strips frames and keeps only the
  final exception line; playground error notices use the copy deck (classified codes,
  timeout line, engine-failed line).
- Parameters: `export_site_data.py` now emits the canonical context plus structured
  per-case variance instead of pipe-joined dumps; SpecSheet and the tightness report
  phrase parameters in plain terms ("within 100 or 10000 basis points"), with exercised
  variance shown per case.
- Patterns screen: list-and-spec layout with URL-persisted selection, a field-rule
  column, and the matrix provably beside the spec.
- Playground: case dropdown grouped must-accept/must-reject/boundary; editable context
  editor (universes, tolerances, code-decided results); bounded seed input; editor size
  shown against the cap; screen-reader result announcements; richer "copy as test case"
  payload (expected, reason, context, pattern).
- Tightness report: harmful bars now read "rejected/accepted" correctly (they could say a
  harmful variation was accepted); per-pattern parameter summaries; boundary cases link
  "Try in playground"; "How to read this" panel.
- Decision guide: rebuilt as a real stepper — one question per step, 2–4 answers, a
  running summary, hash-persisted state, and a recommendation card that links to the
  recommended pattern with the canonical example preloaded.
- Tests: 58 playground tests green (12 new), typecheck and production build clean.
- Housekeeping: regenerated vendored primitive blocks after `validate_facts` joined
  `compare.py` (the vendored-equivalence gate requires the blocks to stay fresh).

### Added — M11 documentation
- `docs/pattern-catalog.md`, `docs/decision-guide.md`, `docs/tightness-testing.md`,
  `docs/anti-patterns.md`, `docs/threat-model.md`, `README.md`, `CHANGELOG.md`.

### Added — M12 RankingJudge (stretch)
- `contracts/ranking_judge.py`: P4 consensus with frozen candidate universe, rubric, and
  ranking parameters (top-k, overlap threshold, optional rank-distance cap). State machine:
  `OPEN -> RANKED -> CHALLENGED -> RANKED (round + 1) -> ... -> CLOSED`. Append-only
  ranking history. 11 direct tests.
- Design decisions for the open questions in AGENTS.md section 15: tie handling via
  deduplication preserving first occurrence; candidate universe frozen at creation;
  rank-distance cap optional (0 = no cap).
- `docs/contracts.md`: RankingJudge section with methods, limits, and design decisions.
- `README.md`: RankingJudge summary.

## Milestone status

| # | Milestone | Status |
|---|---|---|
| M1 | Research note and verified API ledger | done |
| M2 | Normalizers, bounds, errors | done |
| M3 | Comparators | done |
| M4 | Defensive parsing | done |
| M5 | Pattern specs, matrices, perturbation | done |
| M6 | VerdictJudge + vendoring + direct tests | done |
| M7 | WebFactAttestor + direct tests | done |
| M8 | Integration tests under real consensus | done |
| M9 | StudioNet deployment with saved schemas | done |
| M10 | Testnet deployment (requires funded account) | blocked on user |
| M11 | Documentation | done |
| M12 | RankingJudge stretch | done |

## 2026-10-23 — pass 15 (developer tooling)

- Added MIT `LICENSE`, `pyproject.toml` (PEP 621, `ekit` console script), `CONTRIBUTING.md`,
  `.pre-commit-hooks.yaml`, `.github/workflows/audit.yml`.
- Added `equivalencekit/audit.py` + `equivalencekit/cli.py`: `ekit audit <path> [--json]`
  runs deterministic AST checks mapped to anti-patterns A1, A3, A6, A13, A14, A15, A18, A19,
  A23, with ignore directives and vendored-block awareness. `ekit --version`.
- Added `tests/primitives/test_audit.py` (8 tests). Own code audits clean.
- README: install + audit quick start, three-contract wording, audit linter row.

## 2026-10-23 — pass 16 (M-UI-8 playground hosting + site-data gate)

- Hosted the playground on GitHub Pages: `gh-pages` branch served from `playground/dist`
  (vite `base "./"` makes the bundle path-agnostic), Pages already enabled on
  `gh-pages`/`:root` from the deploy session. Live at
  https://habte-selassie27.github.io/equivalence-kit/ — probes verified HTTP 200 on
  the root, the hashed CSS bundle, and the Pyodide runtime copy; record in
  deployments/pages.md.
- Added `tools/deploy_playground_site.sh`: idempotent refresh (fresh build → orphan
  `gh-pages` via a throwaway worktree → force push), so the hosted site never drifts
  from `dist`.
- Added `tests/site/test_export_is_fresh.py`: the documented
  `python3.12 tools/export_site_data.py --check` invocation is now a pytest gate under
  the pinned interpreter, closing the manual-gate loop (item M-UI-5 of the todo).


## 2026-10-23 — pass 18 (CLI commands, site guard, hosting config)

- `ekit scaffold --pattern P1..P6 --name X --out path`: copies the matching reference
  contract, renames the class, writes a matrix stub. Output passes genvm-lint and
  ekit audit.
- `ekit matrix <file-or-dir> [--json] [--check]`: runs acceptance cases and (when a
  canonical.json is present) perturbation generators, prints the tightness report.
- `tests/site/test_site_data.py`: wraps `export_site_data.py --check` as a pytest test.
- `.github/workflows/pages.yml`: builds and deploys the playground to GitHub Pages.

## 2026-10-23 — pass 19 (home + developer's guide screens, site-gate consolidation)

- Added `HomeScreen` at `/`: problem statement, kit contents (primitives, three reference
  contracts, `ekit` tooling), the six patterns with links into their specs, a computed
  tightness figures line, and the documented cannot-do limits. All numbers come from the
  generated site data; no literals.
- Added `DevelopersGuideScreen` at `/developing`: install, pattern choice, primitive
  usage, contract-recipe walk-through (reference contracts linked), vendoring with the
  pinned-interpreter rationale, and the verification-gate command list. Every command
  mirrors shipped code (`audit`/`scaffold`/`matrix` CLI, `tools/vendor.py`, lint/test
  gates).
- Navigation rework: Patterns moved from `/` to `/patterns`; the brand links home;
  nav gains "Developer's guide". Builder routes (in-flight lane) untouched.
- Screen tests added (6; playground suite now 80) and `tests/site` consolidated to one
  staleness gate (`test_site_data.py`) pinned to `/usr/bin/python3.12`; the duplicate
  `test_export_is_fresh.py` from pass 16 is removed.

## 2026-10-23 — pass 23 (engine boot honesty: watchdog and staged hint)

- A boot that never answers used to sit at "Loading the engine" forever while a broken
  engine could be mislabeled "Engine idle" by the 15 s warm-up timeout. Now every
  request sent while the engine is still loading gets a 60 s boot budget
  (`BOOT_TIMEOUT_MS`), and a request timeout declares the engine failed — the shell
  shows "Using precomputed results" with a Retry, never a hanging loader.
- Both status lines explain long boots: after 12 s loading, the header and the
  playground hint say the first visit fetches about 5 MB from the CDN
  (pyodide.asm.wasm 2.9 MB + python_stdlib.zip 2.2 MB, measured) and it is cached
  afterwards. `useSlowBoot` keeps the escalation honest — it never claims failure.
- Context for the report that prompted this: the user's dev server predated the
  `playground/` → `frontend/` rename, so its worker package fetches had no source to
  serve; a fresh `npm run dev` from `frontend/` binds :5173 and serves `/pkg/` 200
  (verified).

## 2026-10-23 — pass 22 (UI moved to frontend/)

- The playground's Vite project moved from `playground/` to `frontend/` (git mv;
  history preserved). All path consumers updated: `tools/copy_pkg.mjs` sync target,
  `tools/deploy_playground_site.sh` build/copy paths and its missing-dist error string,
  `tools/export_site_data.py` DATA_DIR + docstring, `.github/workflows/pages.yml`
  working directories and the artifact path, `.gitignore` entries, the README quick
  start, `deployments/pages.md`, and the engine test that reads the matrices
  (`playground/` → `frontend/`).
- In-tree mentions of "playground" that name the PRODUCT and the `#/playground` route
  are unchanged, as are historical changelog entries.
- Gates after the move: typecheck OK, 82/82 tests (incl. the real-Pyodide engine
  equivalence run), build clean, `export_site_data.py --check` fresh, vendor blocks
  fresh.

## 2026-10-23 — pass 21 (Decision guide visual pass)

- Rebuilt the Decision guide flow: the question progress is an interactive stepper
  (numbered dots, done/current/todo states, jump by click), the answer rail is a sticky
  side column with an answered meter (n/8) and change-jump rows, option cards keep the
  selected tint and check glyph, and arrow keys move focus through the options like real
  radios.
- The finished recommendation reads like a result card: pattern chip + title, invariant
  checklist with checked glyphs, a tolerance starting-point callout, and the actions
  row. The spec link now points at `/patterns?pattern=<P#>` — the old `/?pattern=…`
  destination silently landed on home after the route rework.
- The honesty footnote moved inside the guide panel so it stops floating between
  panels; copy unchanged (`LimitsNote`).
- Guide tests extended to 9 (stepper/rail jumps, pattern-spec route), suite 82.

## 2026-10-23 — pass 20 (site plumbing fixes, both deploy pipelines working)

- Fixed `tools/deploy_playground_site.sh` on repeat refreshes: the local `gh-pages`
  branch is disposable and is deleted before `checkout --orphan`, pushes are forced.
  The pass-16 script worked exactly once, then refused itself with "branch already
  exists".
- Fixed `.github/workflows/pages.yml`: the `node tools/copy_pkg.mjs` step resolved a
  wrong path inside `playground/` and is redundant anyway — `npm run build` runs the
  `prebuild` (`sync:pkg`) hook, so the step was removed; the workflow's build job
  completed 26 s later.
- Added `main` to the `github-pages` environment deployment-branch allow-list (it
  permitted only `gh-pages`, rejecting the Actions deploy outright); deploy rerun
  then succeeded.
- Serving continues from the legacy `gh-pages` pipeline; both are documented in
  deployments/pages.md with the resolution to converge on one later.



## 2026-10-23 — pass 19 (Pattern Builder playground screen)

- New `/builder` route: compose a canonical output and context, run the real primitives in
  the browser (identity case, 10 harmless + 10 harmful perturbations), see the rates, and
  export the spec JSON and a contract skeleton.
- App.tsx: nav link + route wired; typecheck clean; 74 tests still pass; build succeeds.

## 2026-10-23 — playground variation clarity

- Playground: applying a harmless or harmful variation now immediately runs the
  comparison, states the expected outcome, and shows an explicit rule-gap message when
  the result does not match. A status line names the variation in the validator box and
  says that another click replaces it and nothing is saved.
- Builder: new "What Run tightness checks" panel explains the identity case, the ten
  harmless generators, and the ten harmful generators per pattern, and that runs are
  in-memory only.

## 2026-10-23 — pattern list selection no longer shifts

- Removed the hover/active `translateX` on pattern list buttons: a clicked (and therefore
  still hovered) item used to sit 2px right of the rest of the list.
- The selected state now uses an inset ring in addition to the tint and border, with no
  size or position change.
- Set `scrollbar-gutter: stable` on the root so switching patterns cannot shift the page
  horizontally when the vertical scrollbar appears or disappears.

## 2026-10-23 — remove pattern list jump on selection

- The pattern list was `position: sticky` inside `.patterns-grid`. Because each spec has a
  different height, switching to a shorter pattern shrank the grid and pushed the sticky
  list up by up to ~170px (and could clamp the page scroll). The list now stays in normal
  flow, so no element moves when a pattern is selected at any scroll position.
- Verified in a browser at 1487×1031: clicking P1–P6 leaves every list item and the panel
  top fixed; clicking while scrolled 0–500 moves neither the list nor the scroll position.

## 2026-10-23 — self-host Pyodide and show engine boot failures

- The Pyodide runtime was loaded from `cdn.jsdelivr.net`. It is now copied from the npm
  dependency into `frontend/public/pyodide/` by `npm run sync:pkg` and served from the
  site itself, so the engine boots on networks that block third-party CDNs. The directory
  is generated (gitignored) and rebuilt by `predev`/`prebuild`.
- `loadEngine()` now shares one boot promise. The shell and the active screen both warm
  the engine, and StrictMode doubles effects in development; previously each call started
  its own download and Pyodide instance (several copies of the 13 MB runtime).
- The Playground and Builder banners now include the real failure reason
  (`ENGINE: ...`) instead of a generic "couldn't start", and the header status shows it
  on hover. The copy no longer blames the user's input for a boot failure.
- Engine copy updated from "about 5 MB from the CDN" to about 13 MB from this site.

## 2026-10-23 — smooth spec and matrix swap on Patterns

- Selecting P1–P6 used to replace a long spec and a tall acceptance matrix in a single
  frame, so the text snapped and the matrix jumped to a new vertical position. The
  Patterns screen now wraps the state update in the View Transition API
  (`document.startViewTransition`), naming `.pattern-detail` and `.matrix-panel`. The
  browser fades the old spec out, brings the new one in, and moves the matrix to its new
  position. The old root snapshot is hidden immediately so the selected list card never
  lags behind the spec.
- The transition is skipped when the reader asks for reduced motion or the browser has no
  View Transition support; the selection still works in both cases.
- The matrix filter resets to “All cases” on a pattern change (the table is keyed by
  pattern), so a filter chosen for P1 cannot silently hide P2's cases.
- Test: `screens.test.tsx` clicks P2 after choosing the Boundary filter and asserts the
  new spec heading and the reset filter.
