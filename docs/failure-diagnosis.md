# Failure Diagnosis

When a GenLayer transaction fails, the failure is usually not an exception: the
receipt comes back `FINALIZED` or `UNDETERMINED` with a classified error string and a
validator vote map. Reading that by hand is slow and error-prone. EquivalenceKit ships
a failure-diagnosis layer that turns a receipt into a classified failure class, the
reason codes found, and a concrete fix.

This is the Failure Diagnosis track of the kit: `equivalencekit/diagnose.py`,
`ekit diagnose`, and the classified-error registry in `equivalencekit/errors.py`.

## The failure classes

| Class | Meaning | Typical trigger |
|---|---|---|
| `none` | Finalized successfully, no error. | — |
| `leader_refusal` | The leader's own VM refused the call before consensus. | Bad caller, bad state, out-of-bounds input, unauthorized. |
| `validator_disagreement` | Validators disagreed on the leader's result. | Rule too strict, or a non-unanimous model. |
| `timeout` | Upstream timeout or rate limit. | Transient infrastructure failure. |
| `rollback` | Finality is not persistence; state rolled back. | StudioNet state rollback (see CHANGELOG). |
| `source_failure` | An external source was unreachable or malformed. | Network, DNS, or page change. |
| `parse_failure` | Model output was not usable JSON. | Bad prompt, fence, or schema. |
| `hallucination` | A model-supplied id/entity is outside the provided universe. | Missing `subset_of`. |
| `invariant_violation` | Verdict violates a deterministic rule. | Missing `consistent_with`. |
| `unknown` | No classified error and no recognizable shape. | Inspect manually. |

## The decision tree

```
receipt
  ├─ classified error present?
  │   ├─ LLM_ERROR: UNKNOWN_ID          -> hallucination   (A3)
  │   ├─ LLM_ERROR: INCONSISTENT        -> invariant       (A24)
  │   ├─ LLM_ERROR: *                   -> parse_failure   (A1, A4, A5, A12, A14, A19)
  │   ├─ EXTERNAL: *                    -> source_failure  (A6)
  │   ├─ TRANSIENT: *                   -> timeout         (A18)
  │   └─ EXPECTED: *                    -> leader_refusal  (A19, A22, A24)
  ├─ leader execution_result == ERROR?
  │   ├─ result.status == rollback      -> rollback
  │   └─ otherwise                      -> leader_refusal
  ├─ validator votes contain "disagree" or status UNDETERMINED?
  │   └─ yes                            -> validator_disagreement
  └─ status FINALIZED with FINISHED_WITH_RETURN and no error?
      └─ yes                            -> none (success)
```

## Reason code → anti-pattern map

| Reason code | Anti-pattern | Fix |
|---|---|---|
| `UNKNOWN_ID` | A3 | `subset_of(cited_ids, provided_ids)`; reject any unknown id. |
| `UNKNOWN_ENUM` | A4 | `normalize_enum` with an explicit alias table; reject unknowns. |
| `OUT_OF_RANGE` | A19 | Range-check in `parse_with_spec`. |
| `MISSING_KEY` / `UNKNOWN_KEY` / `WRONG_TYPE` | A5 | Require and type-check every key. |
| `INCONSISTENT` | A24 | `consistent_with` against deterministic results. |
| `SOURCE_UNREACHABLE` / `SOURCE_EMPTY` / `SOURCE_MALFORMED` | A6 | Record `UNAVAILABLE` as its own state. |
| `TOO_LARGE` / `OVER_LIMIT` | A14, A19 | Bound every list, string, and loop. |
| `BAD_JSON` | A12 | Fence strip + guarded parse + `parse_with_spec`. |
| `EMPTY_OUTPUT` | A1 | Compare decisions, never explanations. |
| `NOT_AUTHORIZED` / `INVALID_STATE` | A22, A24 | Authorize submitters; enforce the state machine. |
| `UPSTREAM_TIMEOUT` / `RATE_LIMITED` | A18 | Retry with backoff; never a negative finding. |

## CLI usage

```bash
# From a transaction hash (requires the genlayer CLI on PATH)
ekit diagnose 0xabc... --json

# From a saved receipt (CI-friendly, no network)
ekit diagnose --from-file receipt.txt
ekit diagnose --from-file receipt.json --json
```

The `--json` output is a list of diagnosis objects with `code`, `prefix`, `reason`,
`anti_pattern`, `title`, `fix`, `failure_class`, and `evidence`. It is stable and
diffable, so it can be asserted on in CI.

## Worked example: a hallucinated citation

Receipt (JSON form):

```json
{
  "status": "FINALIZED",
  "consensus_data": {
    "leader_receipt": [
      {"execution_result": "FINISHED_WITH_RETURN",
       "result": {"status": "ok", "error": "LLM_ERROR: UNKNOWN_ID"}}
    ],
    "last_round": {"validator_votes_name": {"v1": "AGREE", "v2": "AGREE"}}
  }
}
```

`ekit diagnose --from-file receipt.json` reports:

```
Found 2 diagnosis entry/entries:

  CLASS: HALLUCINATION
    class: hallucination
    evidence: status=FINALIZED; execution=FINISHED_WITH_RETURN; votes={'v1': 'AGREE', 'v2': 'AGREE'}; leader_errored=false
    anti-pattern: docs/failure-diagnosis.md — hallucination
    fix: A model-supplied id or entity is outside the provided universe. Add subset_of against the frozen universe.

  LLM_ERROR: UNKNOWN_ID
    class: hallucination
    evidence: status=FINALIZED; execution=FINISHED_WITH_RETURN; votes={'v1': 'AGREE', 'v2': 'AGREE'}; leader_errored=false
    anti-pattern: A3 — No id universe (hallucinated citations)
    fix: Add subset_of(cited_ids, provided_ids); reject any unknown id.
```

Note that validators *agreed* (`AGREE`/`AGREE`) on a hallucinated id — this is the
silent failure the kit exists to prevent. The diagnosis points at A3 and the fix.

## Worked example: a too-strict rule

A receipt whose validator votes are `AGREE`/`DISAGREE` with status `UNDETERMINED` is
classified as `validator_disagreement`. The fix is to loosen the responsible parameter
(one step at a time) and update the acceptance matrix. See `docs/tightness-testing.md`.

## What this cannot do

Failure diagnosis reads the receipt; it does not re-run the transaction. It cannot tell
you whether the source content was true, and it cannot recover a rolled-back record.
See `docs/threat-model.md`.

## In the test suite

`tests/primitives/test_diagnose.py` (text path) and
`tests/primitives/test_diagnose_receipts.py` (receipt path) pin the classification
and the reason-code mapping against fixture receipts in
`tests/fixtures/receipts/`.
