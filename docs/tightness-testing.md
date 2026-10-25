# Tightness Testing

Equivalence rules are the most dangerous part of a GenLayer contract because their failure
modes are silent:

- A rule that is **too loose** lets validators agree on garbage. Consensus succeeds, and the
  wrong answer is finalized permanently.
- A rule that is **too strict** makes honest validators disagree. The transaction never
  finalizes, or rotates leaders until it fails.

Both failures look like "the system works" from the outside: no exception, no revert. The
only way to know which one you have is to test the rule directly.

**Tightness testing** is that test. It proves what a rule accepts and rejects, so you can
tune it deliberately instead of guessing.

## 1. Acceptance matrices

Every pattern ships a fixture in `tests/matrices/<PATTERN>.json`. Each case is a tuple of
`(leader_output, validator_output, expected, reason_code)` in three categories:

| Category | What it covers | Required rate |
|---|---|---|
| `MUST_ACCEPT` | Honest variation: reordered ids, casing, whitespace, adjacent buckets, one-step band shift, differing digest prose | 100% accepted |
| `MUST_REJECT` | Decision flips, unknown ids, out-of-range values, source-status mismatch, invariant violations | 100% rejected |
| `BOUNDARY` | Values exactly on every tolerance edge and one unit beyond | 100% as specified |

The same matrix runs against three targets, so the deployed rule cannot drift from the
documented one:

1. the pure primitives (`equivalencekit/`),
2. the **vendored** copy inlined into the contract (`tests/matrices/test_vendored.py`),
3. the contract adapter in direct mode (`tests/direct/`).

## 2. Perturbation generators (mutation testing for equivalence)

A hand-written matrix can miss cases. `equivalencekit/perturb.py` generates variants
systematically: take a valid output, perturb it, and require the rule to react correctly.

**Harmless perturbations** (the rule must still accept — 100% acceptance required):

| Perturbation | Generator |
|---|---|
| Reorder ids | `harmless_variation` |
| Change casing / whitespace | `harmless_variation` |
| Swap bool for a bool token (`true` → `"yes"`) | `harmless_variation` |
| Move a value within tolerance | `harmless_variation` |
| Reorder facts / entities | `harmless_variation` |
| Change digest prose | `harmless_variation` |
| Add a duplicate entity | `harmless_variation` |

**Harmful perturbations** (the rule must reject — 100% rejection required):

| Perturbation | Generator |
|---|---|
| Flip an enum or boolean | `harmful_variation` |
| Push a value far past tolerance | `harmful_variation`, `push_value_beyond` |
| Cite an id that was never provided | `hallucinate_id` |
| Add a hallucinated fact | `harmful_variation` |
| Inject instructions into the output | `inject_instruction` |

Any miss is a bug in the rule or in the test.

## 3. The report

```bash
python3.12 tools/tightness.py
```

Real output from this repository (2026-10-22):

```text
EquivalenceKit tightness report
===============================
P1: cases=16 (accept=6, reject=6, boundary=4)
    harmless accepted 10/10; harmful rejected 10/10
P2: cases=18 (accept=6, reject=6, boundary=6)
    harmless accepted 10/10; harmful rejected 10/10
P3: cases=18 (accept=6, reject=6, boundary=6)
    harmless accepted 10/10; harmful rejected 10/10
P4: cases=18 (accept=6, reject=6, boundary=6)
    harmless accepted 10/10; harmful rejected 10/10
P5: cases=18 (accept=6, reject=6, boundary=6)
    harmless accepted 10/10; harmful rejected 10/10
P6: cases=18 (accept=6, reject=6, boundary=6)
    harmless accepted 10/10; harmful rejected 10/10
Matrix cases: 106
Perturbation acceptance: 60/60 harmless variants
Perturbation rejection: 60/60 harmful variants
```

**Harmless acceptance: 60/60 (100%). Harmful rejection: 60/60 (100%).** Both must hold for
every pattern. A single miss is a defect, not a tuning knob.

## 4. Reading the numbers

| Observation | Diagnosis | Action |
|---|---|---|
| Harmless acceptance < 100% | Rule is **too strict** | Honest validators would disagree. Loosen the one responsible parameter and update the matrix. |
| Harmful rejection < 100% | Rule is **too loose** | Validators would agree on garbage. Tighten the rule; do not touch the matrix to make it pass. |
| Both 100% but a real run disagrees | The perturbations do not model reality | Add a perturbation that reproduces the real disagreement. |

## 5. Real runs: a live model is not unanimous

The matrix and the perturbation harness measure the rule. They cannot measure the *model*.
Real consensus runs add a second, separate source of disagreement, and it is worth naming
precisely.

**What was observed on StudioNet (2026-10-22).** Both of these happened with the rules
unchanged, and both are the rules working correctly:

- A P1 round where one validator returned `ELIGIBLE` and another `INELIGIBLE`. P1 compares
  the verdict exactly, so the round was refused, the state was left unchanged, and the
  caller could try again.
- A P4 round where two validators' top-2 sets shared only one candidate. With top-k 2 over
  three candidates and a 66 percent threshold, that is 50 percent and the round was refused.

**What it means.** A rule that no honest run can satisfy is a rule that never finalizes.
The P4 parameters in the first case — top-k 2 over three candidates, threshold 66 — demand
that two independent runs pick the *same pair* in the same order. That is not a tolerance
band, it is a demand for identical output, and it fails against a live model.

**What to do about it — in this order.**

1. **Fix the rubric first.** The P1 failure was a rubric that left both verdicts plausible
   ("assess whether the evidence is sufficient"). Stating the decision rule outright in the
   rubric removed the ambiguity. A vague rubric is the most common cause of a P1 refusal.
2. **Then check the parameters.** The P4 failure was a threshold no honest run could meet.
   Top-k 2 over four candidates with a 50 percent threshold asks the top-2 to share at least
   one candidate, which a model can actually do.
3. **Only then retry.** A refused round leaves the state unchanged, so the caller may try
   again — but a retry is a symptom, not a fix. Two failures in a row means the rule or the
   rubric is wrong.

**Do not** loosen a rule until a live run agrees. That is A16 in
`docs/anti-patterns.md`: it converts a real defect into a documented "feature", and the
tolerance silently drifts.

**In the test suite**, a live-network test may retry inside the contract's own semantics
(`tests/helpers.py::transact_until_agreed`) so that a single unlucky draw does not fail the
run. Each attempt is bounded to one rotation: a refusal under the network's default rotation
count can spend many minutes re-running the model before it gives up, which turns a refused
round into a hung test. The retry never changes the rule, and the final failure still raises
with the last receipt, so a genuine regression is not masked.

## 6. Rules

- **Never weaken a matrix to make a test pass.** If a case fails, the rule is wrong (or the
  case is documenting a real bug). Investigate, then change one of them deliberately.
- A tolerance change without a matrix update is a rejected change.
- A comparator without reject tests is not shippable.
- Keep the perturbation generators deterministic (seeded `random.Random`), so a failure
  reproduces exactly.

## 7. Mutation testing: does the matrix actually bite?

A 100% pass rate on a matrix you wrote yourself is not evidence unless the matrix
can kill a broken rule. `tools/mutation.py` takes the P1 matrix and six deliberately
broken versions of the comparator (drop the id-universe check, compare only the
verdict, widen the band tolerance to 2 steps, drop the invariant, over-tighten the
band to 0 steps, skip normalization) and reports whether at least one matrix case
disagrees with each mutant.

Real output:

```text
EquivalenceKit mutation report — P1
==================================================
  KILLED    no_subset (drops subset_of)
  KILLED    verdict_only (ignores band, ids, invariants)
  KILLED    band_tolerance_2 (LOW vs HIGH accepted)
  KILLED    no_invariant (forbidden verdicts pass)
  KILLED    strict_band (0 steps, rejects honest one-step shift)
  KILLED    no_normalization (casing/whitespace differences fail)

Mutants: 6/6 killed (100%)
```

A surviving mutant means the matrix is too weak to catch that defect and must be
strengthened. The check is enforced in CI and in
`tests/matrices/test_mutation.py`.

## 8. Property-based tests: cases the author did not write

`tests/matrices/test_p1_properties.py` uses Hypothesis to generate inputs (verdicts,
bands, cited-id lists, digests) and asserts soundness invariants for every generated
case: digest text never flips agreement; any unknown id is rejected; band shifts
beyond one step are rejected; verdict mismatches are rejected. These are not
hand-written cases, so a failure cannot be blamed on the author having forgotten one.

## 9. Before/after: a naive rule vs. the kit

A reviewer can reasonably ask how the kit is better than what they would write first. The
answer is in `tests/matrices/test_naive_vs_kit.py`, which runs the same two inputs through
a naive rule and through the kit's P1 rule:

```text
NAIVE VS KIT (P1)
  input                 naive_strict_equal  naive_verdict_only  kit P1
  honest variation      False                True                True
  hallucinated id       False                True                False
```

* **Naive strict equality** rejects the honest variation (reordered ids, one-step band
  shift, rewritten digest): too strict — honest validators would never agree, so nothing
  finalizes.
* **Naive verdict-only** accepts the hallucinated id: too loose — validators finalize a
  wrong answer.
* **Kit P1** accepts the honest variation and rejects the hallucination, because it
  compares the decision, tolerates harmless noise, and enforces `subset_of` on cited ids.

That is the whole point of the kit: the naive rules each fail one of the two bars
(agreement and garbage rejection), and P1 passes both.

## 10. What this cannot prove

Tightness testing proves the rule behaves as specified on the cases you generate. It cannot
prove that the specification itself is correct, and it cannot catch a wrong answer that
*every* validator shares. That is a property of the underlying model and data, not of the
comparison — see `docs/threat-model.md`.
