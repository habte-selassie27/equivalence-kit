# Submission notes — EquivalenceKit (Developer Tools track)

## What it does

EquivalenceKit is a tested kit of equivalence and validator patterns for GenLayer
Intelligent Contracts. It ships:

- a pure-Python primitives package (`equivalencekit/`) with zero GenLayer imports:
  normalizers, comparators, parsers, a closed classified-error registry, bounds;
- six declarative patterns (P1 Verdict plus band … P6 Boolean attestation) with filled
  specs, acceptance matrices, and perturbation generators;
- three reference Intelligent Contracts with real state machines — VerdictJudge (P1),
  WebFactAttestor (P2), RankingJudge (P4);
- an in-repo CLI (`ekit audit`, `ekit matrix`, `ekit diagnose`) and a browser playground
  (`frontend/`) that runs the real package under Pyodide;
- a failure-diagnosis layer (`equivalencekit/diagnose.py`, `docs/failure-diagnosis.md`):
  classify a failed receipt into 10 failure classes, map each reason code to its
  anti-pattern and fix, JSON output for CI;
- a Live screen (`/live`) that calls the three deployed contracts through `genlayer-js`,
  including a real wallet write lifecycle.

Pattern coverage note: P3 (bounded number), P5 (entity set), and P6 (boolean attestation)
are implemented as primitives, specs, and matrices and are covered by the test suite, but
they do not ship a deployed reference contract.

## Problem it solves

The hardest part of a GenLayer contract is deciding what validators must agree on.
Rules that are too strict make honest validators disagree; rules that are too loose let a
validator agree with garbage. Builders reinvent normalizers, tolerance bands, and parsers,
and rarely test how tight their rules really are. EquivalenceKit gives them reusable
primitives, a decision guide, and a tightness-testing method (acceptance matrices +
perturbation generators) that reports harmless-acceptance and harmful-rejection rates.

## How to use

1. Run the primitive gates:
   `pytest tests/primitives tests/matrices tests/direct tests/site -v`
   (334 tests, no GenLayer needed).
2. Lint the contracts: `genvm-lint check contracts/<file>.py --json`.
3. Audit a contract against the anti-pattern gallery: `ekit audit contracts/ --json`
   (24 anti-patterns, A1–A24).
4. Run an acceptance matrix: `ekit matrix tests/matrices/P1.json` (or `--json`).
5. Diagnose a failed transaction: `ekit diagnose <txHash>` (or `--from-file`).
6. Deploy: `genlayer network set studionet`, then `genlayer deploy contracts/<file>.py`.
7. Optional playground: `cd frontend && npm install && npm run dev`
   (119 tests, including the Pyodide engine test; 1 live-RPC test skipped).
8. Live site: https://equivalence-kit.vercel.app — go to the Live screen.

## Tags

- Tag 1: Contract Testing
- Tag 2: Failure Diagnosis

## Networks

StudioNet (gasless, deployed — see `deployments/studionet.md`). Testnet (Bradbury/Asimov)
not deployed: claiming testnet GEN is a browser step.

## Ready-to-paste submission fields

Website: https://equivalence-kit.vercel.app
GitHub: https://github.com/habte-selassie27/equivalence-kit
Evidence: https://github.com/habte-selassie27/equivalence-kit

### One-liner

Tested equivalence patterns, an audit linter and tightness testing for GenLayer
contracts, with 3 deployed reference contracts and a live playground.

### Description

EquivalenceKit helps GenLayer builders decide what validators must agree on. Rules that
are too strict stop transactions finalizing; rules that are too loose finalize wrong
answers. Both fail silently. The kit ships pure-Python primitives (normalizers,
comparators, fail-closed parsing, closed error registry), six declarative patterns
(P1–P6), an `ekit audit` linter for 24 known anti-patterns, and a tightness-testing
method that measures whether a rule is too loose or too strict. Three reference contracts
with real state machines are deployed on StudioNet: VerdictJudge, WebFactAttestor and
RankingJudge. A browser playground runs the same primitives via Pyodide, and its Live
screen calls the deployed contracts through genlayer-js, following each transaction from
signature to final receipt. Built for anyone whose contract calls an LLM or the live web.
Limits are documented: it grades agreement, not truth. P3, P5 and P6 ship as primitives,
specs, and matrices without a deployed reference contract.

### How-to steps

1. Open https://equivalence-kit.vercel.app and go to the Live screen.
2. Connect a wallet on StudioNet (gasless, 0 GEN).
3. Pick VerdictJudge and run a read call. No wallet signature needed.
4. Submit a write (e.g. an evaluation) and sign it in your wallet.
5. Watch the status through consensus to the final receipt, then check the read-back
   of the new record.

### Expected verification outcome

The write moves through signature, tx hash and live consensus status to a finalized
receipt showing validator votes and execution result. A follow-up view call returns the
newly written record. The same tx appears on explorer-studio against the contract
address, with validators in agreement. StudioNet is gasless.

### Contract links (StudioNet)

- VerdictJudge: https://explorer-studio.genlayer.com/address/0x35aC9fC21e158121B7FC5a2FD0aEAbe62cF063ac
- WebFactAttestor: https://explorer-studio.genlayer.com/address/0x29aE058EdbDCECE5dB10a1a194d4a07e15594462
- RankingJudge: https://explorer-studio.genlayer.com/address/0x1c037a13C35E48c72694C6Dd061E908Bdf7f42Ce

## Demo video (not recorded yet)

Script: `docs/demo-script.md`. Record 60–90s against the Live screen and the tightness
report, then add the link here.

## Slot strategy

Submit EquivalenceKit as a Project. VerdictJudge can also be submitted separately as an
Intelligent Contract entry if the program allows a second slot that week.
