# UI.md — EquivalenceKit Playground (Optional Docs Companion)

> Companion to AGENTS.md. AGENTS.md wins on any conflict about contracts or primitives.
> Audience: any coding agent building the EquivalenceKit playground site.
> Status: OPTIONAL. The submission is the contracts, primitives, tests, and docs. This UI is
> a static companion that makes the tightness evidence explorable. It is not a dApp.
> Rule zero: the UI runs the REAL primitives and reads REAL fixtures. It never re-implements
> comparison logic in JavaScript.

---

## 1. PURPOSE, SCOPE, AND SUBMISSION BOUNDARY

### 1.1 Why a UI at all
Equivalence rules are hard to understand from prose. A builder learns fastest by editing a
leader output and a validator output and seeing, field by field, whether a rule accepts or
rejects and why. The playground does exactly that, using the same primitives and
acceptance matrices the tests use.

### 1.2 Boundary (read this first)
- The Intelligent Contracts category rejects full apps and wants standalone contracts. The
  playground is therefore a static docs site, built from repo data, with no required chain
  access.
- Do not submit the playground as the contract deliverable. If the user later wants it
  judged on its own, it belongs under Projects; say so rather than silently changing scope.
- No wallet, no transactions, no accounts in the core site.

### 1.3 In scope
- Four screens: Patterns, Playground, Tightness report, Decision guide
- A small shared component set built around one signature visual (the tolerance track)
- Static data generated from the repo (single source of truth)
- The real `equivalencekit` package running in the browser (section 13)

### 1.4 Out of scope
- Extra screens, user accounts, saved profiles, analytics dashboards
- Re-implemented comparators, or any "approximate" demo logic
- LLM calls from the browser (the playground compares outputs; it never generates them)
- Writes to any chain
- Optional stretch (section 11): a read-only "Deployed contracts" panel, only after M-UI-8

---

## 2. UI INVARIANTS (TIED TO THE KIT)

1. Single source of truth: pattern specs, acceptance matrices, and perturbation reports are
   generated from the repo by a script. The UI never hand-copies them.
2. Real logic: every accept or reject shown comes from the actual primitives package. If the
   package cannot run, the UI says so and falls back to precomputed results labeled as such.
3. Reason codes always visible: every verdict shows the stable reason code from the registry.
4. The UI never claims truth verification. It shows agreement rules, not whether content is
   correct. Known limits are displayed beside every pattern.
5. Accept, reject, and boundary are distinct states with distinct icons, words, and colors.
6. Boundary cases (exactly on a tolerance edge, or one unit beyond) are highlighted, because
   they are where rules actually differ.
7. Integer math is shown as integer math. Never display a tolerance as a rounded float that
   hides the real comparison.
8. Bounded inputs: editors cap input size; runs have a time limit; results are deterministic.
9. Explanations (digests, free text) are shown as "not compared" so users learn what
   consensus ignores.
10. Nothing is persisted server-side. Shareable state lives in the URL hash only.

---

## 3. DESIGN PLAN

### 3.1 Subject, audience, job
- Subject: how validators agree. Tolerance, boundaries, and invariants.
- Audience: GenLayer builders writing contracts, plus reviewers judging whether a rule is
  well tuned.
- Primary job: let someone see exactly what a rule accepts, what it rejects, and where the
  edge is, in under a minute.

### 3.2 Concept
A measuring instrument. Every comparison is drawn as a track with a leader mark, a
validator mark, and a shaded tolerance region. Agreement is where the marks sit inside the
region. The tolerance track is the memorable element; everything around it is calm,
plain, and slightly clinical.

### 3.3 Color (named, with roles)
| Name | Hex | Role |
|---|---|---|
| Bench | #EEF2F0 | Page background (cool green-grey, not cream) |
| Sheet | #FFFFFF | Panels and editors |
| Graphite | #1B2A2F | Text (deep slate-teal, not pure black) |
| Calibre | #4A3FBF | Primary action, focus, links (indigo-violet) |
| Accept | #1E7A68 | Accepted |
| Reject | #BE3455 | Rejected |
| Edge | #B9820F | Boundary and on-the-edge cases |
| Rule | #C6D0CC | Grid lines, tracks, dividers |

Rules
- State is never color alone: icon shape and a word accompany every state.
- Tolerance regions use a light tint of Calibre with a hatch pattern so they read in grayscale.
- Contrast: text 4.5:1 or better on Bench and Sheet; marks and edges 3:1 or better.
- Dark theme is optional; if added, redefine every token and recheck contrast.

### 3.4 Typography
| Role | Face | Notes |
|---|---|---|
| Interface, headings, body | Schibsted Grotesk | Weight and size contrast carry hierarchy; sentence case |
| JSON editors, reason codes, field names | IBM Plex Mono | Used only where content is literally code or identifiers |

- Load via Google Fonts with real fallbacks (system-ui; ui-monospace).
- Scale (1.2 ratio): 12 / 14 / 16 / 19 / 23 / 28 / 34. Body 16, line length under 80.
- No all-caps labels, no tracked-out eyebrows, no monospace for decorative small labels.

### 3.5 Layout concept (desktop, 1280 max width, left aligned)
```
+-------------------------------------------------------------------+
| EquivalenceKit      Patterns  Playground  Tightness  Decision guide|
+-------------------------------------------------------------------+
| Playground                                                        |
| Pattern [ P1 Verdict plus band v ]   Load case [ choose... v ]    |
|-------------------------------+-----------------------------------|
| Leader output (JSON)          | Validator output (JSON)           |
| { "verdict": "ELIGIBLE", ...} | { "verdict": "ELIGIBLE", ...}     |
|-------------------------------+-----------------------------------|
| Context (provided ids, deterministic results)                     |
|-------------------------------------------------------------------|
| [Run comparison]   [Apply harmless variation]  [Apply harmful]    |
|-------------------------------------------------------------------|
| Result: accepted                                                  |
| verdict   --(L)------(V)--   exact                 ok             |
| band      LOW [MED(L)][HIGH(V)]  within 1 step     ok             |
| cited ids {a,b} / {b,a}  subset of provided        ok             |
| invariant consistent_with(verdict, checks)         ok             |
+-------------------------------------------------------------------+
```
- Two-column editors on wide screens, stacked on narrow.
- Result rows are a ledger, not identical cards. Radius is deliberate: 2px on fields and
  editors, 6px on dialogs, none on tracks. One border weight; one subtle elevation for
  dialogs only.

### 3.6 Principles
- One bold element: the tolerance track.
- Show the rule next to the result: parameters (steps, bps, buckets) are always visible.
- Plain language first; code identifiers second.
- Honest about limits: each pattern lists what it cannot catch.

### 3.7 Review against generic defaults (done; keep it that way)
Rejected on purpose: warm cream plus terracotta, near-black plus acid green, broadsheet
hairline columns, identical rounded cards with gradient washes, all-caps eyebrow labels,
middle-dot meta strings, arrows appended to buttons, monospace on every small label. If a
change reintroduces any of these, revert it.

---

## 4. STACK AND STRUCTURE

Recommended (adjust if the repo dictates otherwise)
- Static site: Vite, React, TypeScript, React Router (hash routing for static hosting)
- Pyodide in a Web Worker to run the real `equivalencekit` package (section 13)
- Plain CSS with variables for tokens
- Vitest and React Testing Library; Playwright for a few flows
- Hosting: any static host

```
playground/
  index.html
  package.json
  public/
    pkg/                        # built wheel or source of equivalencekit (generated)
  src/
    main.tsx
    app/ (App, routes, shell)
    data/                       # GENERATED by tools/export_site_data.py, committed or built
      patterns.json
      matrices/*.json
      report.json
    worker/
      pyodideWorker.ts          # loads Pyodide, imports the package, exposes run()
      protocol.ts               # typed request and response messages
    screens/
      Patterns/
      Playground/
      Tightness/
      DecisionGuide/
    components/
      ToleranceTrack, VerdictChip, ReasonCode, JsonEditor, FieldLedger,
      MatrixTable, PerturbationBar, SpecSheet, LimitsNote, EmptyState, ErrorNotice
    lib/
      format.ts, urlState.ts, limits.ts
    styles/ (tokens.css, base.css)
  tests/
  .env.example
```
Generation script (lives in the main repo): `tools/export_site_data.py` reads
`equivalencekit/patterns.py` and `tests/matrices/` and writes the JSON the UI consumes. The
build fails if the generated data is stale or missing.

Routes (hash router)
- `#/` Patterns, `#/playground`, `#/tightness`, `#/guide`

---

## 5. DATA CONTRACTS (CONCEPTUAL; GENERATED, NEVER HAND-EDITED)

```ts
interface FieldSpec {
  name: string;
  normalizer: string;           // function name in the package
  comparator: string;           // function name in the package
  params: Record<string, number | string | string[]>;  // integers and strings only
  explanation: string;          // plain-language rule
  compared: boolean;            // false for digests and free text
}
interface PatternSpec {
  id: "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  name: string; useWhen: string;
  fields: FieldSpec[]; invariants: string[];
  toleranceRationale: string; failureBehavior: string;
  knownLimits: string[]; whyNotStrictEq: string;
}
interface MatrixCase {
  id: string; category: "MUST_ACCEPT" | "MUST_REJECT" | "BOUNDARY";
  title: string; leader: unknown; validator: unknown; context?: unknown;
  expected: "ACCEPT" | "REJECT"; reasonCode: string;
}
interface PatternReport {
  patternId: string; harmlessAccepted: number; harmlessTotal: number;
  harmfulRejected: number; harmfulTotal: number;
  boundaryCases: number; params: Record<string, unknown>;
}
```
Rules
- Params are integers and strings. No floats appear anywhere in generated data.
- Unknown enum values from newer data render neutral ("Unknown") and never crash a screen.
- The UI reads the package version from the data and shows it in the footer.

---

## 6. APP SHELL

- Top bar: product name and four nav links. Nothing else.
- Footer: package version, link to the repo, link to the official Equivalence Principle
  docs, and the line "These rules show how validators agree. They do not check whether
  content is true."
- Skip link to main content; visible Calibre focus ring on every control.
- A small status line shows the engine state: "Engine ready", the current boot phase
  while loading, or "Engine unavailable" with Retry. Screens that fall back to stored
  results say so themselves (section 13.4).

---

## 7. SCREEN 1: PATTERNS

### 7.1 Purpose
Browse P1 to P6, read each spec, see its acceptance examples, jump into the playground
with the pattern preselected.

### 7.2 Wireframe
```
Patterns
| P1  Verdict plus band          Use when a judgment comes with confidence
| P2  Fact set                   Use when extracting structured facts from a page
| P3  Bounded number             ...
-----------------------------------------------------------------
P1 Verdict plus band
Leader produces     verdict, band, cited ids, digest (not compared)
Field rules         [table: field, normalizer, comparator, parameters, compared?]
Invariants          verdict must be consistent with code-decided checks
Why not strict_eq   Confidence wording varies between runs...
Known limits        Cannot detect a wrong verdict that every validator shares
Examples            [3 must-accept] [3 must-reject] [2 boundary]   [Try in playground]
```

### 7.3 Behavior
- List on the left (stacked on mobile), selected spec on the right.
- Field table shows parameters in plain terms ("band: within 1 step", "numbers: within 50
  bps", "ids: must be a subset of the provided ids") and the exact function names.
- Each example is a small ToleranceTrack preview with the verdict chip and reason code.
- "Try in playground" opens the playground with the pattern and that example loaded.
- Known limits are always expanded, never hidden behind a disclosure.

### 7.4 States
- Loading: skeleton list and spec.
- Error (data missing): ErrorNotice with "The pattern data could not be loaded. Rebuild the
  site data and reload."

---

## 8. SCREEN 2: PLAYGROUND (THE CORE)

### 8.1 Purpose
Edit a leader output and a validator output, run the real comparison, and see per-field
results with the tolerance track.

### 8.2 Controls
- Pattern selector (P1 to P6).
- Load case: dropdown grouped by Must accept, Must reject, Boundary; selecting one fills
  the editors.
- JSON editors: Leader output, Validator output, Context (provided ids, deterministic
  results, candidate universe). Monospace, line numbers, JSON validity indicator, size
  counter against the limit.
- Actions: "Run comparison", "Apply harmless variation", "Apply harmful variation",
  "Reset", "Copy as test case", "Copy share link".

### 8.3 Run behavior
1. Parse editors (guarded). Invalid JSON shows an inline error and does not run.
2. Send normalized request to the worker; show "Running" with a time limit.
3. Render the result: overall verdict chip, then the FieldLedger.
4. Each ledger row shows: field name, normalized leader value, normalized validator value,
   comparator name and parameters, ToleranceTrack, result chip, reason code.
5. Invariant rows (for example consistent_with, subset_of) appear below field rows with
   the rule and the reason code.
6. Fields that are not compared (digest) appear in a muted section titled "Not compared".
7. If parsing the leader output fails the way a contract would fail it (bad enum, unknown
   id), show the classified error string, for example `LLM_ERROR: UNKNOWN_ENUM`, in place
   of a comparison, so users see the failure path too.

### 8.4 Variation tools
- Harmless variation applies a generator from the package (shuffle ids, change case, add
  whitespace, change digest, shift a value within tolerance) to the leader output and
  places the result in the validator editor. Expected outcome: accepted.
- Harmful variation applies a generator (flip enum, add unknown id, push beyond tolerance,
  drop a key, forbidden verdict). Expected outcome: rejected.
- After applying, the UI shows what changed (a small diff list) and whether the result
  matched the expected outcome. A mismatch is shown as "Unexpected result: this is a
  rule gap" with a link to the anti-pattern guidance.

### 8.5 Copy as test case
- Produces a JSON object matching `MatrixCase` (leader, validator, context, expected,
  reasonCode) so a builder can paste it into their own fixtures.
- Includes the package version and pattern id.

### 8.6 Share link
- State (pattern, editors) is encoded in the URL hash with a hard size cap. Over the cap,
  the UI says "This case is too large to share as a link. Use Copy as test case instead."

### 8.7 States
- Engine loading: editors usable, Run disabled with "Loading the engine".
- Engine failed: banner "The engine could not start. Showing precomputed matrix results
  only." Free-form running is disabled; matrix cases still display stored results labeled
  "precomputed".
- Timeout: "The run took too long and was stopped. Try smaller inputs."
- Over limit: "Input is larger than the allowed size (N bytes)." with the counter.

---

## 9. SCREEN 3: TIGHTNESS REPORT

### 9.1 Purpose
Show, per pattern, how well the rules separate honest variation from harmful variation,
and exactly which boundary cases are covered.

### 9.2 Wireframe
```
Tightness report                                   Package v0.1.0
| Pattern         Harmless accepted   Harmful rejected   Boundaries
| P1 Verdict      [########] 24/24    [########] 18/18       6
| P2 Fact set     [########] 20/20    [######- ] 16/18       8   <- 2 gaps
...
P2 detail
 Parameters: word buckets 0-300, 301-1000, 1001+ ; headings matched by alias table
 Gaps: [harmful case title]  expected reject, got accept   [Open in playground]
 Cases: [table of every case with category and result]
```

### 9.3 Behavior
- Summary table, one row per pattern, with two paired bars and counts. Bars carry numbers
  and icons so they work without color.
- 100 percent on both bars is the target. Any shortfall is labeled "gap" in Edge color
  with the failing cases listed and linked to the playground.
- Detail panel per pattern: parameters, the full case table (filter by category), and the
  boundary cases highlighted.
- Parameters are shown as stored integers with their unit (steps, bps, bucket edges).
- A "How to read this" panel explains harmless versus harmful in two sentences.

### 9.4 States
- Loading skeleton; missing data error as in 7.4; a pattern with zero cases shows
  "No cases yet. A pattern without cases is not ready."

---

## 10. SCREEN 4: DECISION GUIDE

### 10.1 Purpose
Walk a builder through choosing an equivalence strategy and pattern, using the same eight
questions as docs/decision-guide.md.

### 10.2 Behavior
- This is a real sequence, so a numbered stepper is appropriate: one question per step,
  two to four answers, a running summary on the side.
- Answers map to recommendations (strict_eq acceptable, P1 to P6, extra invariants, how to
  handle unavailable sources, how to tighten tolerance) defined in generated data.
- Final step: a recommendation card with the chosen pattern, the invariants to add, the
  tolerance parameters to start with, and links to the pattern page and a playground
  preset.
- Back and forward work; answers persist in the URL hash.
- A line states the limit: "This guide suggests a starting point. Confirm it with an
  acceptance matrix."

---

## 11. OPTIONAL STRETCH: DEPLOYED CONTRACTS PANEL (READ-ONLY)

Only after M-UI-8. Do not build it earlier.
- Shows the addresses, networks, and explorer links of the deployed reference contracts,
  and read-only views (latest assessments or attestations).
- Uses genlayer-js read calls only. Consult the GenLayerJS docs; never guess method names;
  save the deployed schema first. All chain access lives in `src/lib/chain/` behind
  app-level read functions.
- No writes, no wallet. If the network is unreachable, show the stored deployment record
  from the repo with a "stored record" label.
- Never present an accepted result as final; show finality wording per AGENTS.md rules.

---

## 12. SHARED COMPONENTS

| Component | Responsibility | Key rules |
|---|---|---|
| ToleranceTrack | The signature visual per field | Variants below; text alternative always present |
| VerdictChip | Accept, reject, boundary chip | Icon + word + color |
| ReasonCode | Stable reason string | Monospace chip with copy action |
| JsonEditor | Bounded JSON input | Size counter, validity indicator, no autosave |
| FieldLedger | Result rows | Not identical cards; compared vs not compared sections |
| MatrixTable | Case list with filters | Category filter, boundary highlight |
| PerturbationBar | Harmless/harmful counts | Number and icon on every bar |
| SpecSheet | Pattern spec view | Known limits always expanded |
| LimitsNote | Standing honesty lines | Fixed copy from the copy deck |
| EmptyState / ErrorNotice | Guidance | One action each |

### 12.1 ToleranceTrack variants
- Enum: two labeled marks on a two-position track; accept only when positions match.
- Ordinal (for example LOW, MEDIUM, HIGH): ticks for each level, filled mark for leader,
  ring mark for validator, hatched region spanning the allowed steps.
- Bounded number: axis with the leader value marked and a hatched region for the allowed
  band; the band edges are labeled with their integer values; the validator mark falls
  inside or outside.
- Bucket: segmented track with boundary labels; leader and validator marks sit in segments;
  adjacency region hatched.
- Set (ids, entities): two aligned chip rows with matching chips connected and unmatched
  chips marked; for subset checks, chips outside the universe are marked "not provided".
- Ranking: two ordered rows with connectors; chips crossing the top-k cutoff are marked.
- Boolean: two marks on a yes/no track; UNAVAILABLE shown as its own third position.

Rules for every variant
- Provide an accessible name: "Leader MEDIUM, validator HIGH, allowed distance 1 step,
  accepted." Never rely on the drawing alone.
- Boundary cases get an Edge-colored notch at the edge and the words "on the edge".
- Draw to scale for numeric tracks; show integer labels, never rounded floats.
- Animate nothing by default (section 15).

---

## 13. PYODIDE INTEGRATION RULES

### 13.1 Hard rules
1. Confirm Pyodide can import the package: it must be pure Python and use only standard
   library modules available in Pyodide (for example unicodedata for text normalization).
   Verify before committing to this approach; if blocked, use the fallback in 13.4.
2. Run Pyodide in a Web Worker. The main thread never blocks.
3. The worker exposes one typed function, `run(request)`, with a closed set of request
   kinds: compare, normalize, parse, perturb, listCases.
4. Cap request size; enforce a run time limit by terminating and restarting the worker.
5. The package is loaded from `public/pkg/` (built from the repo), pinned to a version
   recorded in the data.
6. No network calls from the worker besides loading Pyodide and the package. No LLM calls.

### 13.2 Message protocol (conceptual)
```ts
type Request =
  | { kind: "compare"; patternId: string; leader: unknown; validator: unknown; context?: unknown }
  | { kind: "perturb"; patternId: string; leader: unknown; mode: "harmless" | "harmful"; seed: number }
  | { kind: "normalize"; fn: string; value: unknown }
  | { kind: "listCases"; patternId: string };
type Response =
  | { ok: true; result: unknown; packageVersion: string }
  | { ok: false; errorClass: "EXPECTED" | "EXTERNAL" | "TRANSIENT" | "LLM_ERROR" | "ENGINE"; reason: string };
```
- Seeds are explicit integers so perturbations are reproducible and shareable.
- Responses contain reason codes and structured results, never raw tracebacks.

### 13.3 Loading UX
- Show "Loading the engine" with the engine status line; the first screen is usable while
  it loads. Cache the engine for the session.

### 13.4 Fallback (precomputed mode)
- If Pyodide fails or is disabled, the UI loads `matrices/*.json` results and the
  Playground becomes read-only: you can browse stored cases and their results, labeled
  "precomputed". The status line says so. Free-form runs are disabled with an explanation.
- A test asserts that the precomputed results match what the package produced at build time.

---

## 14. ERRORS, EMPTY STATES, AND COPY

### 14.1 Messages
| Situation | Message |
|---|---|
| Invalid JSON in an editor | "This isn't valid JSON. Check the highlighted line." |
| Input over the size limit | "Input is larger than the allowed size. Shorten it to continue." |
| Unknown pattern in a link | "That pattern doesn't exist. Choose one from the list." |
| Engine failed to start | "The engine couldn't start. Showing stored results only." |
| Run timed out | "The run took too long and was stopped. Try smaller inputs." |
| Unexpected harmless result | "Unexpected result: a harmless change was rejected. This is a rule gap." |
| Unexpected harmful result | "Unexpected result: a harmful change was accepted. This is a rule gap." |
| Data missing | "The site data couldn't be loaded. Rebuild the data and reload." |

### 14.2 Standing lines
- Honesty: "These rules show how validators agree. They do not check whether content is true."
- Not compared: "Digests and free text are stored for people to read. Consensus ignores them."
- Integers: "Tolerances use whole numbers so every validator computes the same comparison."
- Boundary: "On the edge: this case sits exactly at the tolerance limit."

### 14.3 Actions (keep names consistent everywhere)
Run comparison, Apply harmless variation, Apply harmful variation, Copy as test case,
Copy share link, Try in playground, Reset. Success toasts echo the action name: "Copied
as test case", "Link copied".

### 14.4 Empty states (one action each)
- No case loaded: "Load a case or paste outputs to compare them."
- No results yet: "Run the comparison to see how each field is judged."
- No gaps: "No gaps found. Harmless variations are accepted and harmful ones are rejected."

---

## 15. ACCESSIBILITY, RESPONSIVE, MOTION

Accessibility floor
- Semantic landmarks, one h1 per screen, ordered headings.
- All controls keyboard reachable with a visible focus ring; dialogs trap focus.
- Results announce via a polite live region ("Accepted" or "Rejected, reason UNKNOWN_ID").
- Tracks have text alternatives; tables have headers and captions; editors have labels and
  describe validity through `aria-describedby`.
- State never relies on color alone; hatch and icon patterns carry meaning in grayscale.
- Contrast 4.5:1 for text, 3:1 for graphical marks and focus indicators.

Responsive
- Mobile first. Editors stack below 900px; ledger rows stack as field, values, result.
- Wide tracks scroll inside their own container; no horizontal page scroll.
- Touch targets at least 44px.

Motion
- The only non-user-triggered motion: on first load of a result, tolerance regions draw in
  once over about 400ms. Reduced motion shows the final state immediately.
- Action-driven motion allowed: result reveal after Run, dialog open and close.

---

## 16. TEST PLAN

Component and screen tests (mock worker)
- [ ] ToleranceTrack renders each variant with correct marks, region, and text alternative
- [ ] Boundary cases show the edge notch and "on the edge" text
- [ ] FieldLedger separates compared fields from "Not compared"
- [ ] Accept, reject, boundary states differ by icon, word, and color
- [ ] JsonEditor enforces the size limit and shows validity
- [ ] Playground: invalid JSON blocks the run; classified failure strings display for bad input
- [ ] Variation tools: expected outcome vs actual shown; a mismatch shows the rule-gap message
- [ ] Copy as test case output matches the `MatrixCase` shape and includes version
- [ ] Share link encode and decode round trip; over-cap message
- [ ] Tightness report: counts, bars with numbers, gap listing, links to playground
- [ ] Decision guide: every path reaches a recommendation; answers persist in the hash
- [ ] Unknown enum values render neutral without crashing
- [ ] Precomputed mode disables free-form runs and labels results

Engine tests (real Pyodide in CI or a Node-compatible runner)
- [ ] package imports; every request kind returns the documented shape
- [ ] results for every matrix case equal the stored precomputed results
- [ ] timeout terminates and restarts the worker cleanly

Accessibility
- [ ] axe checks on each screen state with no serious violations
- [ ] keyboard-only run through all four screens
- [ ] reduced-motion disables the region draw-in

Build gates
```
python tools/export_site_data.py && npm run typecheck && npm run lint && npm run test && npm run build
```
The build fails if generated data is missing or stale relative to the package.

---

## 17. DEMO SCRIPT AND EVIDENCE CAPTURE

Two-minute walkthrough
1. Patterns: open P1. Read the field rules and the known limits.
2. Playground: load a must-accept case (band one step apart) and run it; point at the
   hatched tolerance region and the reason code.
3. Load a must-reject case (unknown cited id); show the `subset_of` rejection.
4. Apply a harmless variation; show it still accepts.
5. Apply a harmful variation; show it rejects.
6. Tightness report: show 100 percent on both bars, then point at the boundary cases.
7. Decision guide: answer the questions for a web-fact use case and land on P2.

Evidence to capture: screenshots of each screen and the tolerance track in each variant,
a short screen recording, the live URL, the package version, and the test and build
output. Add a README section "Using the playground" mirroring the steps.

---

## 18. ANTI-PATTERNS

NEVER:
1. Re-implement comparators or normalizers in JavaScript.
2. Hand-edit generated data, or ship stale generated data.
3. Show floats for tolerances, or hide integer comparisons behind rounded numbers.
4. Imply the playground verifies truth, or call an accepted comparison "correct".
5. Convey state by color alone.
6. Call an LLM or any external service from the browser.
7. Run user input without a size limit and a time limit.
8. Add screens, accounts, analytics, or chain writes.
9. Present the playground as the contract submission.
10. Guess genlayer-js method names (only relevant to the optional stretch panel).
11. Reintroduce the rejected defaults: cream plus terracotta, near-black plus acid green,
    identical gradient cards, all-caps eyebrow labels, arrow-suffixed buttons.
12. Add motion beyond the single region draw-in and action-driven transitions.

---

## 19. MILESTONES AND FINAL CHECKLIST

| # | Milestone | Evidence |
|---|---|---|
| M-UI-1 | `tools/export_site_data.py`; generated data with a staleness check | script output |
| M-UI-2 | Tokens, fonts, shell, routing, status line | screenshots |
| M-UI-3 | ToleranceTrack variants, VerdictChip, ReasonCode with tests | test output |
| M-UI-4 | Worker and Pyodide integration; protocol; precomputed fallback | engine test output |
| M-UI-5 | Playground screen end to end | recording |
| M-UI-6 | Patterns and Tightness report screens | screenshots, tests |
| M-UI-7 | Decision guide, accessibility and responsive passes | axe output |
| M-UI-8 | Deployed static site, README section, demo recording | live URL |
| M-UI-9 | Stretch: read-only deployed contracts panel | explorer links |

Final checklist
- [ ] Four screens only (fifth only if the stretch milestone is reached)
- [ ] All data generated from the repo; build fails on stale data
- [ ] Real primitives run in a worker; precomputed fallback labeled and tested
- [ ] Every verdict shows its reason code, parameters, and a text alternative
- [ ] Accept, reject, and boundary distinct; boundary cases highlighted
- [ ] Integers shown as integers; digests labeled "not compared"
- [ ] Honesty line visible; known limits expanded on every pattern
- [ ] Inputs and runs bounded; share links size-capped
- [ ] Accessibility, responsive, and reduced-motion checks pass
- [ ] Typecheck, lint, tests, and build pass; engine tests pass
- [ ] Screenshots, recording, live URL, and package version recorded
- [ ] Clearly documented as an optional companion, separate from the contract submission

---

End of UI.md. When in doubt: run the real rule, show the edge, and never claim the content is true.
