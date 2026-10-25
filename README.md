# EquivalenceKit

Reusable equivalence and validator patterns for GenLayer Intelligent Contracts.

The hardest part of building on GenLayer is deciding what validators must agree on. Rules
that are too strict make honest validators disagree, so transactions never finalize. Rules
that are too loose let validators agree on garbage, and a wrong answer is finalized
permanently. Both failures are silent: no exception, no revert, no log line.

EquivalenceKit is a tested kit for getting that decision right, and for *proving* you got it
right.

Live playground: https://equivalence-kit.vercel.app · Repository:
https://github.com/habte-selassie27/equivalence-kit

![The playground accepting reordered citations and the browser audit box flagging a zero
tolerance and a float coercion on a pasted contract](docs/assets/demo.gif)

## What it is

- **A pure-Python primitives package** (`equivalencekit/`) — normalizers, comparators,
  defensive parsing, a closed error registry, bounds, and a deterministic digest. No GenLayer
  imports, so it runs and tests anywhere.
- **Declarative pattern specs P1–P6** — verdict-plus-band, fact set, bounded number,
  ranking, entity set, boolean attestation. Each is data: fields, normalizers, comparators,
  invariants, tolerance rationale, failure behavior, known limits.
- **A tightness-testing method** — acceptance matrices plus perturbation generators that
  measure whether a rule is too loose or too strict, with a report you can read.
- **Three reference contracts** with real state machines, not demos: VerdictJudge (P1),
  WebFactAttestor (P2), RankingJudge (P4).
- **A browser playground, audit box, and Live client** (`frontend/`): runs the real package
  under Pyodide, and its Live screen calls the three deployed contracts through
  `genlayer-js`, including a real wallet write lifecycle (signature, hash, consensus,
  receipt, read-back). The Audit screen takes a pasted contract and runs the same
  anti-pattern gallery the CI gate runs — findings stay on the machine, shareable by link.
- **Failure diagnosis** (`equivalencekit/diagnose.py`, `ekit diagnose`): classify a failed
  receipt into leader refusal, validator disagreement, timeout, rollback, source failure,
  parse failure, hallucination, or invariant violation, and map each reason code to its
  anti-pattern and fix. JSON output for CI.

## What it is not

- Not a hello-world, a thin LLM wrapper, or a format-only validator.
- Not a substitute for reading the
  [Equivalence Principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle).

## Who this is for

Builders writing GenLayer contracts that call an LLM or fetch the live web — anyone who has
ever written a validator that compares raw model output and hoped for the best.

## Install

```bash
pip install -e .          # editable install exposes the `ekit` CLI
ekit audit contracts/     # lint a contract against the anti-pattern gallery
ekit tighten --init       # starter files to tightness-test YOUR OWN rule
```

## Quick start

```bash
# 1. Primitives (pure Python, no GenLayer needed)
python3.12 -m pytest tests/primitives -q

# 2. Acceptance matrices + vendored-equivalence gate
python3.12 -m pytest tests/matrices -q

# 3. Contracts with mocked web and LLM
python3.12 -m pytest tests/direct -q

# 4. Lint every contract
genvm-lint check contracts/verdict_judge.py --json
genvm-lint check contracts/web_fact_attestor.py --json

# 5. Real consensus on StudioNet (gasless)
python3.12 -m pytest tests/integration -v -s --network studionet
```

Current status: **334 local tests passing** (primitives, matrices, direct, site) and **119
frontend tests passing** (1 skipped without a live RPC); all three reference contracts and
the consensus-probe fixture lint clean; 106 acceptance-matrix cases; perturbations 60/60
harmless accepted and 60/60 harmful rejected.

## What is in the kit

| Piece | Path | What it does |
|---|---|---|
| Normalizers | `equivalencekit/normalize.py` | Idempotent text/enum/bool/int/id/url normalization, heading extraction, volatile-field stripping |
| Comparators | `equivalencekit/compare.py` | `enum_equal`, `ordinal_within`, `int_within_bps`, `bucket_adjacent`, `set_equal`, `subset_of`, `topk_overlap`, `facts_match`, `validate_facts`, `normalize_facts`, `consistent_with`, `all_of` |
| Defensive parsing | `equivalencekit/parsing.py` | `parse_with_spec` — schema-validated, fail-closed JSON from model output |
| Error registry | `equivalencekit/errors.py` | Closed set of stable `PREFIX: REASON` strings, identical on every validator |
| Bounds | `equivalencekit/bounds.py` | Every limit in one place; `OVER_LIMIT` rejects oversize input |
| Digest | `equivalencekit/digest.py` | Bounded, deterministic, **non-cryptographic** snapshot digest |
| Patterns | `equivalencekit/patterns.py` | P1–P6 specs and comparators, driven by the same data as the tests |
| Perturbation | `equivalencekit/perturb.py` | Harmless and harmful mutation generators for tightness testing |
| Tightness report | `tools/tightness.py` | Prints per-pattern acceptance/rejection rates |
| Mutation testing | `tools/mutation.py` | Kills deliberately broken rules against the matrices; proves discriminating power |
| Vendor | `tools/vendor.py` | Inlines primitives into a single-file contract |
| Audit linter | `equivalencekit/audit.py`, `ekit audit` | Static checks for all 24 anti-patterns (A1–A24), JSON for CI, SARIF for GitHub code scanning |
| Tightness for your rules | `ekit tighten` | Runs a user-supplied `compare(leader, validator, context)` through a fixtures file: harmless/harmful rates, case-by-case misses, `--check` for CI, `--init` for a starter pair |
| Scaffold | `ekit scaffold --pattern P2` | Generates a contract skeleton plus its acceptance matrix from a pattern spec |
| Matrix runner | `ekit matrix tests/matrices --check` | Runs any matrix JSON (kit-shaped or yours) through the pattern rules |
| Receipt doctor | `ekit diagnose` | Reads a failed transaction receipt and reports what consensus stage failed |
| Mutation harness | `tests/matrices/test_mutation.py` | Five comparator mutants; every one must be distinguished by the matrices |

## Reference contracts

### `VerdictJudge` (`contracts/verdict_judge.py`)

A reusable judgment primitive. A creator freezes a verdict set and a rubric of criteria,
evidence references are appended, and the contract produces an append-only P1 assessment
history.

State machine: `OPEN → EVALUATED → CHALLENGED → EVALUATED (round + 1) → … → CLOSED`.

Deterministic rubric items are decided **in code before any model call**. If they leave
exactly one allowed verdict, the contract writes the assessment without calling the model at
all. Otherwise it asks the model, and `consistent_with` re-checks the result so a forbidden
verdict can never be accepted. The digest is stored but never compared.

### `WebFactAttestor` (`contracts/web_fact_attestor.py`)

Attests a small, fixed set of facts about a web page at a point in time, with P2 consensus.

Only `ENUM_FROM_LIST` facts consult a model; headings, phrases, and word-count buckets are
extracted **in code**, so prompt injection in the page cannot change them. Validators re-fetch
the page independently and compare fact-by-fact. `UNAVAILABLE` is a first-class state with an
empty fact set — a failed fetch is never recorded as a negative finding.

### `RankingJudge` (`contracts/ranking_judge.py`)

A reusable ranking primitive (P4). A creator freezes a candidate universe, a rubric, and
ranking parameters (top-k, overlap threshold, optional rank-distance cap). Participants
append evidence references, and the contract produces an append-only ranking history. State
machine: `OPEN -> RANKED -> CHALLENGED -> RANKED (round + 1) -> ... -> CLOSED`.

**Pattern coverage note.** The three contracts exercise P1, P2, and P4. P3 (bounded number),
P5 (entity set), and P6 (boolean attestation) are implemented as primitives, specs, and
matrices and are covered by the test suite, but they do not ship a deployed reference
contract.

## Documentation

| File | What it covers |
|---|---|
| [`docs/pattern-catalog.md`](docs/pattern-catalog.md) | P1–P6 filled specs, reason codes, acceptance matrices |
| [`docs/decision-guide.md`](docs/decision-guide.md) | Eight questions to answer before writing non-deterministic logic |
| [`docs/tightness-testing.md`](docs/tightness-testing.md) | Acceptance matrices, perturbation generators, the report |
| [`docs/anti-patterns.md`](docs/anti-patterns.md) | 24 broken rules, the input that exposes each, and its fix |
| [`docs/failure-diagnosis.md`](docs/failure-diagnosis.md) | Failure classes, reason-code map, worked examples, `ekit diagnose` usage |
| [`docs/case-study.md`](docs/case-study.md) | `ekit audit` on four real public GenLayer contracts, with outputs and an honest miss analysis |
| [`docs/threat-model.md`](docs/threat-model.md) | Threats, defenses, and — explicitly — what this kit cannot defend against |
| [`docs/contracts.md`](docs/contracts.md) | Contract design and the verified GenLayer API ledger |

## The tightness claim

```bash
python3.12 tools/tightness.py
```

```text
Matrix cases: 106
Perturbation acceptance: 60/60 harmless variants
Perturbation rejection: 60/60 harmful variants
```

The two counts are different sets: the 106 are hand-written matrix cases (P1–P6); the
60+60 are generated perturbations (10 harmless and 10 harmful per pattern). Both are
required to be 100%.

Every pattern accepts 100% of harmless perturbations (reordered ids, casing, adjacent
buckets, one-step band shifts, differing digests) and rejects 100% of harmful ones (flipped
enums, hallucinated ids, out-of-range values, injected instructions). Both rates are
requirements, not aspirations: a single miss is a bug in the rule.

## Limitations

Stated plainly:

- **Equivalence rules grade agreement, not truth.** If every validator is fooled the same
  way, consensus finalizes a wrong answer and nothing here detects it.
- **Source truth is not verified.** `WebFactAttestor` proves validators read the same page,
  not that the page is honest.
- **The digest is not cryptographic.** It is FNV-1a, chosen because no hashing module is
  verified in GenVM. It is evidence metadata for audits, never a consensus input.
- **A colluding validator majority and a shared model-provider bias are out of scope** —
  those are protocol-level assumptions, not comparison-layer ones.

See [`docs/threat-model.md`](docs/threat-model.md) for the full list.

## Layout

```
equivalencekit/     pure primitives — no GenLayer imports
contracts/          VerdictJudge, WebFactAttestor, RankingJudge, and the consensus probe fixture
tools/              vendor.py (single-file inlining), tightness.py (report)
docs/               pattern catalog, decision guide, threat model, anti-patterns
tests/primitives/   pure tests, no GenLayer
tests/matrices/     acceptance matrices P1–P6, canonical fixtures, vendored equivalence
tests/direct/       contracts with mocked web and LLM
tests/integration/  real consensus on StudioNet
```

## Live deployments (StudioNet)

StudioNet is gasless (0 GEN). All three reference contracts are deployed there; the full
record — addresses, transaction hashes, saved schemas, and per-step validator votes — is in
[`deployments/studionet.md`](deployments/studionet.md).

| Contract | Address | Explorer |
|---|---|---|
| VerdictJudge | `0x35aC9fC21e158121B7FC5a2FD0aEAbe62cF063ac` | [view](https://explorer-studio.genlayer.com/address/0x35aC9fC21e158121B7FC5a2FD0aEAbe62cF063ac) |
| WebFactAttestor | `0x29aE058EdbDCECE5dB10a1a194d4a07e15594462` | [view](https://explorer-studio.genlayer.com/address/0x29aE058EdbDCECE5dB10a1a194d4a07e15594462) |
| RankingJudge | `0x1c037a13C35E48c72694C6Dd061E908Bdf7f42Ce` | [view](https://explorer-studio.genlayer.com/address/0x1c037a13C35E48c72694C6Dd061E908Bdf7f42Ce) |

A VerdictJudge evaluation reached agreement on a real LLM round with the digest stored but
never compared. A WebFactAttestor attestation fetched the live `example.com` page under P2
consensus; the word-count fact holds the raw count and the bucket rule decides agreement. A
RankingJudge round ranked four candidates under P4 consensus, with the submitted evidence
rendered into the prompt.

Bradbury / Asimov deployment is out of scope for this submission: StudioNet is the target and
is gasless. Deploying to Bradbury needs a funded account, and claiming testnet GEN at the
faucet is a browser step.

## The playground and the Live screen

The playground is a static site in `frontend/`. It runs the real `equivalencekit` package
in the browser through Pyodide, so every accept or reject it shows comes from the same
primitives the contracts run.

```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173
npm run test         # 119 tests, including the Pyodide engine test
npm run build        # writes dist/
```

The first visit downloads about 13 MB of Pyodide assets; they are cached afterwards. On a
slow connection the status line shows the boot phase, and transient network failures are
retried automatically.

The site data is generated from the repo, never hand-edited:

```bash
cd ..
python3.12 tools/export_site_data.py         # regenerate
python3.12 tools/export_site_data.py --check # fails if stale
```

Most of the playground compares outputs and shows the rules in the browser. The **Live**
screen (`/live`) is the part that touches the chain: it calls the three contracts deployed
on StudioNet through the official `genlayer-js` SDK. Reads need no wallet. A write is signed
in your wallet and followed through the whole transaction lifecycle: signature, hash, live
consensus status, the final receipt with the validator votes and execution result, and a view
call that reads the new record back. StudioNet is gasless, so a write costs 0 GEN.

Live site: https://equivalence-kit.vercel.app (GitHub Pages mirror:
https://habte-selassie27.github.io/equivalence-kit/).

## Credits and prior art

Built on the GenLayer builder program and informed by:

- **GenLayer Gym** (https://gym.genlayer.foundation/) — web-access source and benchmark patterns
- **Intelligent Oracle** (https://www.intelligentoracle.com/) — real-world consensus checks
- **Prediction Market Kit** (https://github.com/courtofinternet/pm-kit) — outcome-resolution patterns this kit extracts primitives from
- **GenLayer Project Boilerplate** (https://github.com/genlayerlabs/genlayer-project-boilerplate) — contract project structure
- The [Equivalence Principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle) — the primary reference for this entire project
