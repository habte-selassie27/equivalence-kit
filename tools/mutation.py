"""Mutation testing for equivalence rules.

A 100% pass rate on a matrix you wrote yourself is not evidence unless the matrix
can *kill* a broken rule. This tool takes a pattern's matrix and a set of named
mutants (each a deliberately broken version of the comparator) and reports, for
each mutant, whether at least one matrix case disagrees with it. A mutant that
survives (no case disagrees) means the matrix is too weak to catch that defect.

Usage:
    python3.12 tools/mutation.py            # P1 by default
    python3.12 tools/mutation.py --pattern P1 --json
    python3.12 tools/mutation.py --check    # exit 1 if any mutant survives

The mutants are defined here, in code, and are deliberately the mistakes builders
actually make: dropping the id-universe check, comparing only the verdict, widening
the tolerance, dropping the invariant, and over-tightening the tolerance.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path
from typing import Callable, Dict, List

import equivalencekit.patterns as patterns
from equivalencekit.compare import Comparison, OK
from equivalencekit.normalize import normalize_enum

REPO_ROOT = Path(__file__).resolve().parents[1]
MATRIX_DIR = REPO_ROOT / "tests" / "matrices"


def _load_cases(pattern_id: str) -> list:
    import json as _json
    data = _json.loads((MATRIX_DIR / f"{pattern_id}.json").read_text())
    return data["cases"]


def _ok(result) -> bool:
    return bool(result.get("ok"))


# ---------------------------------------------------------------------------
# Mutants: each is a context manager that patches patterns.* for one defect.
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def mutant_no_subset():
    """Drop the id-universe check: cited ids are never validated."""
    original = patterns.subset_of
    patterns.subset_of = lambda *a, **k: OK
    try:
        yield "no_subset (drops subset_of)"
    finally:
        patterns.subset_of = original


@contextlib.contextmanager
def mutant_verdict_only():
    """Compare only the verdict: band, ids, and invariants are ignored."""
    originals = {
        "ordinal_within": patterns.ordinal_within,
        "subset_of": patterns.subset_of,
        "consistent_with": patterns.consistent_with,
    }
    patterns.ordinal_within = lambda *a, **k: OK
    patterns.subset_of = lambda *a, **k: OK
    patterns.consistent_with = lambda *a, **k: OK
    try:
        yield "verdict_only (ignores band, ids, invariants)"
    finally:
        for name, fn in originals.items():
            setattr(patterns, name, fn)


@contextlib.contextmanager
def mutant_band_tolerance_2():
    """Widen band tolerance to 2 steps: LOW vs HIGH becomes acceptable."""
    original = patterns.ordinal_within
    def widened(a, b, levels, steps=1, **k):
        return original(a, b, levels, 2)
    patterns.ordinal_within = widened
    try:
        yield "band_tolerance_2 (LOW vs HIGH accepted)"
    finally:
        patterns.ordinal_within = original


@contextlib.contextmanager
def mutant_no_invariant():
    """Drop the deterministic-rule invariant: forbidden verdicts pass."""
    original = patterns.consistent_with
    patterns.consistent_with = lambda *a, **k: OK
    try:
        yield "no_invariant (forbidden verdicts pass)"
    finally:
        patterns.consistent_with = original


@contextlib.contextmanager
def mutant_strict_band():
    """Over-tighten: band must be byte-identical (0 steps)."""
    original = patterns.ordinal_within
    def strict(a, b, levels, steps=1, **k):
        return original(a, b, levels, 0)
    patterns.ordinal_within = strict
    try:
        yield "strict_band (0 steps, rejects honest one-step shift)"
    finally:
        patterns.ordinal_within = original


@contextlib.contextmanager
def mutant_no_normalization():
    """Skip normalization: casing and whitespace differences fail."""
    import equivalencekit.compare as compare_mod
    orig_patterns = patterns.normalize_enum
    orig_compare = compare_mod.normalize_enum
    identity = lambda value, *a, **k: value
    patterns.normalize_enum = identity
    compare_mod.normalize_enum = identity
    try:
        yield "no_normalization (casing/whitespace differences fail)"
    finally:
        patterns.normalize_enum = orig_patterns
        compare_mod.normalize_enum = orig_compare


MUTANTS = [
    mutant_no_subset,
    mutant_verdict_only,
    mutant_band_tolerance_2,
    mutant_no_invariant,
    mutant_strict_band,
    mutant_no_normalization,
]


def run_mutation(pattern_id: str) -> dict:
    cases = _load_cases(pattern_id)
    results = []
    for mutant_factory in MUTANTS:
        with mutant_factory() as name:
            killed_by = []
            survived = 0
            for case in cases:
                expected_ok = case["expected"] == "ACCEPT"
                try:
                    got = patterns.compare_pattern(pattern_id, case["leader"], case["validator"], case["context"])
                    got_ok = _ok(got)
                except Exception as exc:  # a mutant that raises is still "killed" by that case
                    got_ok = not expected_ok
                if got_ok != expected_ok:
                    killed_by.append(case["id"])
                else:
                    survived += 1
            results.append({
                "mutant": name,
                "killed": len(killed_by) > 0,
                "killed_by": killed_by,
                "survived_cases": survived,
                "total_cases": len(cases),
            })
    total = len(results)
    killed = sum(1 for r in results if r["killed"])
    return {
        "pattern": pattern_id,
        "mutants": results,
        "mutants_total": total,
        "mutants_killed": killed,
        "kill_rate": (killed / total) if total else 1.0,
        "all_killed": killed == total,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Mutation testing for equivalence rules")
    parser.add_argument("--pattern", default="P1", help="pattern id (default P1)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--check", action="store_true", help="exit 1 if any mutant survives")
    args = parser.parse_args()

    report = run_mutation(args.pattern)

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"EquivalenceKit mutation report — {report['pattern']}")
        print("=" * 50)
        for m in report["mutants"]:
            status = "KILLED" if m["killed"] else "SURVIVED"
            print(f"  {status:<9} {m['mutant']}")
            if m["killed"]:
                print(f"            killed by: {', '.join(m['killed_by'][:3])}"
                      + (" ..." if len(m["killed_by"]) > 3 else ""))
            else:
                print(f"            survived all {m['total_cases']} cases — matrix is too weak")
        print()
        print(f"Mutants: {report['mutants_killed']}/{report['mutants_total']} killed "
              f"({report['kill_rate'] * 100:.0f}%)")
    if args.check and not report["all_killed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())