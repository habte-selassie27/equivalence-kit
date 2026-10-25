"""Mutation testing: every matrix must kill a broken rule.

A 100% pass rate on a matrix you wrote yourself is not evidence unless the
matrix can kill a deliberately broken version of the rule. This test runs the
mutants in tools/mutation.py against the P1 matrix and asserts that every mutant
is killed by at least one case. A surviving mutant means the matrix is too weak
to catch that defect and must be strengthened.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tools.mutation import run_mutation


def test_all_p1_mutants_are_killed():
    report = run_mutation("P1")
    survivors = [m["mutant"] for m in report["mutants"] if not m["killed"]]
    assert report["all_killed"], f"surviving mutants: {survivors}"
    assert report["kill_rate"] == 1.0