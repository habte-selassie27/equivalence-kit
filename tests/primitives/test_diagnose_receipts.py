"""Receipt-level failure diagnosis (Failure Diagnosis track)."""

import json
from pathlib import Path

import pytest

from equivalencekit.diagnose import FailureClass, classify_failure, diagnose_receipt

FIXTURES = Path(__file__).parents[2] / "tests" / "fixtures" / "receipts"


def _load(name):
    return json.loads((FIXTURES / name).read_text())


@pytest.mark.parametrize("fixture,expected", [
    ("success.json", FailureClass.NONE),
    ("leader_refusal.json", FailureClass.LEADER_REFUSAL),
    ("validator_disagreement.json", FailureClass.VALIDATOR_DISAGREEMENT),
    ("hallucination.json", FailureClass.HALLUCINATION),
    ("source_failure.json", FailureClass.SOURCE_FAILURE),
    ("rollback.json", FailureClass.ROLLBACK),
])
def test_classify_failure(fixture, expected):
    receipt = _load(fixture)
    assert classify_failure(receipt) == expected


def test_diagnose_receipt_success_has_no_class_entry():
    receipt = _load("success.json")
    diagnoses = diagnose_receipt(receipt)
    # Success: no CLASS: entry should be prepended.
    assert all(not d.code.startswith("CLASS:") for d in diagnoses)


def test_diagnose_receipt_leader_refusal_prepends_class():
    receipt = _load("leader_refusal.json")
    diagnoses = diagnose_receipt(receipt)
    assert any(d.code.startswith("CLASS: LEADER_REFUSAL") for d in diagnoses)
    assert any(d.failure_class == "leader_refusal" for d in diagnoses)


def test_diagnose_receipt_disagreement_evidence_includes_votes():
    receipt = _load("validator_disagreement.json")
    diagnoses = diagnose_receipt(receipt)
    joined = " ".join(d.evidence or "" for d in diagnoses)
    assert "DISAGREE" in joined or "UNDETERMINED" in joined


def test_diagnose_receipt_hallucination_maps_to_a3():
    receipt = _load("hallucination.json")
    diagnoses = diagnose_receipt(receipt)
    assert any(d.anti_pattern == "A3" for d in diagnoses)


def test_diagnose_receipt_source_failure_maps_to_a6():
    receipt = _load("source_failure.json")
    diagnoses = diagnose_receipt(receipt)
    assert any(d.anti_pattern == "A6" for d in diagnoses)


def test_diagnose_receipt_from_json_text():
    text = (FIXTURES / "rollback.json").read_text()
    diagnoses = diagnose_receipt(text)
    assert any(d.failure_class == "rollback" for d in diagnoses)


def test_classify_failure_text_fallback():
    # Plain text with no JSON: falls back to scanning classified errors.
    assert classify_failure("EXTERNAL: SOURCE_UNREACHABLE") == FailureClass.SOURCE_FAILURE
    assert classify_failure("LLM_ERROR: UNKNOWN_ID") == FailureClass.HALLUCINATION
    assert classify_failure("nothing here") == FailureClass.UNKNOWN