# Demo script — EquivalenceKit (60–90 seconds)

Record the screen while narrating. StudioNet is gasless, so every write costs 0 GEN.

## 0:00–0:10 — The problem

Screen: README top ("Both failures are silent: no exception, no revert, no log line").

Narration:
"Every GenLayer builder hits the same wall: how strict should the equivalence rule be?
Too strict and honest validators disagree, so nothing finalizes. Too loose and validators
agree on garbage, permanently. Both fail silently."

## 0:10–0:25 — The kit

Screen: terminal running `python3.12 tools/tightness.py`, zoomed on the report.

Narration:
"EquivalenceKit is a tested kit of equivalence patterns. Six patterns, a closed error
registry, defensive parsing, and a tightness report that measures whether a rule is too
loose or too strict."

## 0:25–0:40 — Before/after

Screen: `tests/matrices/test_naive_vs_kit.py` or the before/after table in
`docs/tightness-testing.md`.

Narration:
"A naive strict-equality rule rejects honest variation, so nothing finalizes. A naive
verdict-only rule accepts a hallucinated id. The kit's P1 rule does both right:
accepts honest noise, rejects the hallucination."

## 0:40–0:60 — The Live screen

Screen: https://equivalence-kit.vercel.app → Live. Connect wallet. Run a VerdictJudge read.

Narration:
"The Live screen calls the deployed contracts. Reads need no wallet. Here's a read
returning the frozen rubric."

## 0:60–0:80 — A write

Screen: submit an evaluation, sign in wallet, watch status go to FINALIZED, read back
the new record.

Narration:
"A write is signed in the wallet, then followed through the whole lifecycle: signature,
hash, live consensus status, the final receipt with validator votes and execution result,
and a view call that reads the new record back. StudioNet is gasless."

## 0:80–0:90 — Limits and close

Screen: README Limitations section.

Narration:
"The kit grades agreement, not truth — that's stated up front. Three reference
contracts, 334 local tests, 119 frontend tests, lint-clean, deployed, with explorer
links. EquivalenceKit."

## Recording notes

- Keep the cursor still; zoom to 125%.
- Show the explorer receipt for one tx at the end (validator votes visible).
- Do not claim Bradbury deployment; StudioNet only.
- Add the final video link to `docs/submission-notes.md` under "Demo video".
