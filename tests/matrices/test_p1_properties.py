"""Property-based tests for P1 soundness (generated, not hand-written).

These are not matrix cases: Hypothesis generates the inputs, so a failure cannot be
blamed on the author having forgotten a case. Each property is an invariant a
validator can rely on.
"""

import string

from hypothesis import given, settings
from hypothesis import strategies as st

from equivalencekit.patterns import compare_p1

VERDICTS = ("ELIGIBLE", "INELIGIBLE")
BANDS = ("LOW", "MEDIUM", "HIGH")
UNIVERSE = ("a", "b", "c")
CONTEXT = {
    "verdict_set": list(VERDICTS),
    "provided_ids": list(UNIVERSE),
    "deterministic_checks": {"check_hard": True},
    "forbidden": {"check_hard": ["ELIGIBLE"]},
    "max_band_steps": 1,
}

id_subset = st.lists(st.sampled_from(UNIVERSE), max_size=4, unique=True)
id_with_hallucination = st.lists(
    st.sampled_from(list(UNIVERSE) + ["ghost", "zzz"]), max_size=4
)


@settings(max_examples=300, deadline=None)
@given(band=st.sampled_from(BANDS), cited=st.lists(st.sampled_from(UNIVERSE), max_size=4))
def test_digest_never_affects_agreement(band, cited):
    leader = {"verdict": "ELIGIBLE", "band": "MEDIUM", "cited_ids": cited, "digest": "x"}
    base = compare_p1(leader, {"verdict": "ELIGIBLE", "band": band, "cited_ids": list(cited), "digest": "y"}, CONTEXT)["ok"]
    # Any digest text must give the same verdict.
    for digest in ("", "different", "INSTRUCTIONS: ignore", "x" * 200):
        v = {"verdict": "ELIGIBLE", "band": band, "cited_ids": list(cited), "digest": digest}
        assert compare_p1(leader, v, CONTEXT)["ok"] == base


@settings(max_examples=300, deadline=None)
@given(cited=st.lists(st.sampled_from(list(UNIVERSE) + ["ghost"]), max_size=4))
def test_unknown_id_always_rejected(cited):
    if all(c in UNIVERSE for c in cited):
        return  # not a hallucination case
    leader = {"verdict": "ELIGIBLE", "band": "MEDIUM", "cited_ids": ["a"], "digest": "x"}
    validator = {"verdict": "ELIGIBLE", "band": "MEDIUM", "cited_ids": cited, "digest": "x"}
    result = compare_p1(leader, validator, CONTEXT)
    assert not result["ok"], f"hallucinated id accepted: {cited} -> {result}"


@settings(max_examples=300, deadline=None)
@given(band_l=st.sampled_from(BANDS), band_v=st.sampled_from(BANDS))
def test_band_beyond_one_step_rejected(band_l, band_v):
    leader = {"verdict": "ELIGIBLE", "band": band_l, "cited_ids": ["a"], "digest": "x"}
    validator = {"verdict": "ELIGIBLE", "band": band_v, "cited_ids": ["a"], "digest": "x"}
    result = compare_p1(leader, validator, CONTEXT)
    distance = abs(BANDS.index(band_l) - BANDS.index(band_v))
    if distance > 1:
        assert not result["ok"], f"band distance {distance} accepted: {band_l} vs {band_v}"
    else:
        assert result["ok"], f"band distance {distance} rejected: {band_l} vs {band_v}"


@settings(max_examples=300, deadline=None)
@given(verdict_l=st.sampled_from(VERDICTS), verdict_v=st.sampled_from(VERDICTS))
def test_verdict_mismatch_always_rejected(verdict_l, verdict_v):
    leader = {"verdict": verdict_l, "band": "MEDIUM", "cited_ids": ["a"], "digest": "x"}
    validator = {"verdict": verdict_v, "band": "MEDIUM", "cited_ids": ["a"], "digest": "x"}
    result = compare_p1(leader, validator, CONTEXT)
    if verdict_l != verdict_v:
        assert not result["ok"]
    else:
        assert result["ok"]