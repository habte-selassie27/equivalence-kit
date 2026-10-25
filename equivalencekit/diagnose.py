"""Failure diagnosis: turn a classified error or a receipt into the matching fix.

This module is pure Python and has no GenLayer imports. It has two entry points:

* ``diagnose_text`` — scan any blob (a ``genlayer receipt ... --stdout --stderr``
  dump, a log, a test failure) for classified errors of the form ``PREFIX: REASON``
  and pair each with the anti-pattern that explains it.
* ``diagnose_receipt`` — take a parsed receipt (dict or JSON text) and classify the
  *kind* of failure (leader refusal, validator disagreement, timeout, rollback,
  source failure, parse failure, hallucination, invariant violation) before pairing
  reason codes with fixes.

The CLI (``ekit diagnose``) drives both.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Union

# Classified error shape produced by equivalencekit.errors.make_error: PREFIX: REASON.
ERROR_RE = re.compile(r"\b(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR):\s*([A-Z_]+)\b")

# Best-effort map from a reason code to the anti-pattern that explains it.
# Codes with no clear single entry fall back to the generic pointer below.
REASON_TO_ANTIPATTERN = {
    "UNKNOWN_ID": ("A3", "No id universe (hallucinated citations)",
                   "Add subset_of(cited_ids, provided_ids); reject any unknown id."),
    "UNKNOWN_ENUM": ("A4", "\"Closest label\" snapping",
                     "normalize_enum with an explicit alias table; reject unknowns."),
    "OUT_OF_RANGE": ("A19", "Limits declared but never enforced",
                     "Range-check in parse_with_spec; reject out-of-range values."),
    "MISSING_KEY": ("A5", "Extra keys silently ignored",
                    "Require every key; reject a missing key with MISSING_KEY."),
    "INCONSISTENT": ("A24", "strict_eq on model or web output",
                     "Add consistent_with against the deterministic results."),
    "SOURCE_UNREACHABLE": ("A6", "Treating UNAVAILABLE as false",
                           "Record UNAVAILABLE as its own state, never as false."),
    "SOURCE_EMPTY": ("A6", "Treating UNAVAILABLE as false",
                     "Record UNAVAILABLE as its own state, never as false."),
    "SOURCE_MALFORMED": ("A6", "Treating UNAVAILABLE as false",
                         "Record UNAVAILABLE as its own state, never as false."),
    "TOO_LARGE": ("A14", "Unbounded loops and unbounded inputs",
                  "Bound every list, string, and loop; reject over-limit input."),
    "BAD_JSON": ("A12", "Free-text error messages",
                 "strip_fences + extract_json_object + parse_with_spec; classify as LLM_ERROR."),
    "EMPTY_OUTPUT": ("A1", "Comparing digest prose",
                     "Compare decisions, never explanations; clip digests."),
    "OVER_LIMIT": ("A19", "Limits declared but never enforced",
                   "Enforce bounds with require_within; reject over-limit input."),
    "UNKNOWN_KEY": ("A5", "Extra keys silently ignored",
                    "Reject unknown keys in parse_with_spec."),
    "WRONG_TYPE": ("A5", "Extra keys silently ignored",
                   "Type-check every field in parse_with_spec."),
    "OUT_OF_RANGE": ("A19", "Limits declared but never enforced",
                     "Range-check in parse_with_spec; reject out-of-range values."),
    "NOT_AUTHORIZED": ("A22", "A griefable, unattributable round",
                       "Authorize submitters; record who submitted what."),
    "INVALID_STATE": ("A24", "strict_eq on model or web output",
                      "Enforce the state machine; reject out-of-order transitions."),
    "OVER_LIMIT": ("A19", "Limits declared but never enforced",
                   "Enforce bounds with require_within."),
}


class FailureClass(str, Enum):
    """The kind of failure a receipt represents."""

    NONE = "none"                      # finalized successfully
    LEADER_REFUSAL = "leader_refusal"  # leader's own VM refused the call
    VALIDATOR_DISAGREEMENT = "validator_disagreement"
    TIMEOUT = "timeout"
    ROLLBACK = "rollback"
    SOURCE_FAILURE = "source_failure"
    PARSE_FAILURE = "parse_failure"
    HALLUCINATION = "hallucination"
    INVARIANT_VIOLATION = "invariant_violation"
    UNKNOWN = "unknown"


# Remediation keyed by failure class.
FAILURE_CLASS_FIX = {
    FailureClass.NONE: "No action: the transaction finalized and the record was written.",
    FailureClass.LEADER_REFUSAL: "The leader's VM refused before consensus. Check the "
                                 "caller, the state, and the input bounds; this is a "
                                 "deterministic refusal, not model variance.",
    FailureClass.VALIDATOR_DISAGREEMENT: "Validators disagreed on the decision. The rule "
                                         "is too strict or the model is not unanimous: "
                                         "loosen the responsible parameter or add a "
                                         "perturbation that reproduces the disagreement.",
    FailureClass.TIMEOUT: "Upstream or rate limit. Retry with backoff; do not treat a "
                          "timeout as a negative finding.",
    FailureClass.ROLLBACK: "Finality is not persistence on this network. Re-read the "
                           "record after a settling window and treat the explorer receipt "
                           "as the authority.",
    FailureClass.SOURCE_FAILURE: "The external source was unreachable or malformed. Record "
                                 "UNAVAILABLE as its own state; never as a negative fact.",
    FailureClass.PARSE_FAILURE: "The model output was not usable JSON. Tighten the prompt, "
                                "add fence stripping, and classify as LLM_ERROR.",
    FailureClass.HALLUCINATION: "A model-supplied id or entity is outside the provided "
                                "universe. Add subset_of against the frozen universe.",
    FailureClass.INVARIANT_VIOLATION: "The verdict violates a deterministic rule. Run "
                                      "code-decided checks before the model and add "
                                      "consistent_with after.",
    FailureClass.UNKNOWN: "No classified error found. Inspect the receipt manually and "
                          "re-run with --from-file.",
}

# Failure class inferred from a reason code.
REASON_TO_FAILURE_CLASS = {
    "UNKNOWN_ID": FailureClass.HALLUCINATION,
    "UNKNOWN_ENUM": FailureClass.PARSE_FAILURE,
    "BAD_JSON": FailureClass.PARSE_FAILURE,
    "MISSING_KEY": FailureClass.PARSE_FAILURE,
    "WRONG_TYPE": FailureClass.PARSE_FAILURE,
    "EMPTY_OUTPUT": FailureClass.PARSE_FAILURE,
    "TOO_LARGE": FailureClass.PARSE_FAILURE,
    "OUT_OF_RANGE": FailureClass.PARSE_FAILURE,
    "INCONSISTENT": FailureClass.INVARIANT_VIOLATION,
    "SOURCE_UNREACHABLE": FailureClass.SOURCE_FAILURE,
    "SOURCE_EMPTY": FailureClass.SOURCE_FAILURE,
    "SOURCE_MALFORMED": FailureClass.SOURCE_FAILURE,
    "UPSTREAM_TIMEOUT": FailureClass.TIMEOUT,
    "RATE_LIMITED": FailureClass.TIMEOUT,
    "NOT_AUTHORIZED": FailureClass.LEADER_REFUSAL,
    "INVALID_STATE": FailureClass.LEADER_REFUSAL,
    "OVER_LIMIT": FailureClass.LEADER_REFUSAL,
    "NOT_FOUND": FailureClass.LEADER_REFUSAL,
}


@dataclass
class Diagnosis:
    code: str
    prefix: str
    reason: str
    anti_pattern: str
    title: str
    fix: str
    failure_class: str = "unknown"
    evidence: Optional[str] = None


def _normalize_receipt(receipt: Union[Dict[str, Any], str]) -> Dict[str, Any]:
    """Accept a dict or JSON text and return a parsed dict (best effort)."""
    if isinstance(receipt, dict):
        return receipt
    if isinstance(receipt, str):
        text = receipt.strip()
        if not text:
            return {}
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            # Try to find a JSON object inside the text.
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except (json.JSONDecodeError, ValueError):
                    pass
            return {"_text": text}
    return {}


def _status(receipt: Dict[str, Any]) -> str:
    for key in ("statusName", "status_name", "status"):
        value = receipt.get(key)
        if value is not None:
            return str(value).upper()
    return ""


def _consensus(receipt: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("consensus_data", "consensusData"):
        value = receipt.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _leader_receipts(receipt: Dict[str, Any]) -> List[Dict[str, Any]]:
    consensus = _consensus(receipt)
    for key in ("leader_receipt", "leaderReceipt"):
        value = consensus.get(key)
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict)]
    return []


def _leader_errored(receipt: Dict[str, Any]) -> bool:
    for lr in _leader_receipts(receipt):
        if str(lr.get("execution_result", "")).upper() == "ERROR":
            return True
        result = lr.get("result")
        if isinstance(result, dict) and str(result.get("status", "")).lower() == "rollback":
            return True
    return False


def _validator_votes(receipt: Dict[str, Any]) -> Dict[str, Any]:
    consensus = _consensus(receipt)
    for key in ("last_round", "lastRound"):
        value = consensus.get(key)
        if isinstance(value, dict):
            for vkey in ("validator_votes_name", "validatorVotesName", "votes"):
                vv = value.get(vkey)
                if isinstance(vv, dict):
                    return vv
    # Fallback to consensus_data.votes
    votes = consensus.get("votes")
    if isinstance(votes, dict):
        return votes
    return {}


def _has_disagreement(receipt: Dict[str, Any]) -> bool:
    votes = _validator_votes(receipt)
    values = [str(v).lower() for v in votes.values()]
    if "disagree" in values:
        return True
    status = _status(receipt)
    if status in ("UNDETERMINED", "REJECTED"):
        return True
    return False


def _execution_result(receipt: Dict[str, Any]) -> str:
    for lr in _leader_receipts(receipt):
        value = lr.get("execution_result") or lr.get("executionResult")
        if value:
            return str(value).upper()
    # Fallback to top-level
    for key in ("execution_result", "executionResult"):
        value = receipt.get(key)
        if value:
            return str(value).upper()
    return ""


def classify_failure(receipt: Union[Dict[str, Any], str]) -> FailureClass:
    """Classify a parsed receipt into a FailureClass."""
    r = _normalize_receipt(receipt)

    # Plain text fallback: scan for classified errors.
    if "_text" in r:
        codes = ERROR_RE.findall(r["_text"])
        if not codes:
            return FailureClass.UNKNOWN
        # Pick the most severe prefix present.
        prefixes = {c[0] for c in codes}
        if "LLM_ERROR" in prefixes:
            reasons = {c[1] for c in codes}
            if reasons & {"UNKNOWN_ID"}:
                return FailureClass.HALLUCINATION
            return FailureClass.PARSE_FAILURE
        if "EXTERNAL" in prefixes:
            return FailureClass.SOURCE_FAILURE
        if "TRANSIENT" in prefixes:
            return FailureClass.TIMEOUT
        if "EXPECTED" in prefixes:
            reasons = {c[1] for c in codes}
            if reasons & {"INCONSISTENT"}:
                return FailureClass.INVARIANT_VIOLATION
            return FailureClass.LEADER_REFUSAL
        return FailureClass.UNKNOWN

    # Classified errors embedded in the receipt take precedence over the status,
    # because a receipt can be "finalized" while carrying an LLM_ERROR string.
    text = json.dumps(r)
    codes = ERROR_RE.findall(text)
    if codes:
        reasons = {c[1] for c in codes}
        prefixes = {c[0] for c in codes}
        if reasons & {"UNKNOWN_ID"}:
            return FailureClass.HALLUCINATION
        if reasons & {"INCONSISTENT"}:
            return FailureClass.INVARIANT_VIOLATION
        if "LLM_ERROR" in prefixes:
            return FailureClass.PARSE_FAILURE
        if "EXTERNAL" in prefixes:
            return FailureClass.SOURCE_FAILURE
        if "TRANSIENT" in prefixes:
            return FailureClass.TIMEOUT
        if "EXPECTED" in prefixes:
            return FailureClass.LEADER_REFUSAL

    status = _status(r)
    if status in ("FINALIZED", "ACCEPTED", "FINISHED") or status.startswith("FINAL"):
        er = _execution_result(r)
        if er in ("FINISHED_WITH_RETURN", "FINISHED", ""):
            if not _leader_errored(r) and not _has_disagreement(r):
                return FailureClass.NONE

    if _leader_errored(r):
        result = None
        for lr in _leader_receipts(r):
            result = lr.get("result")
        if isinstance(result, dict) and str(result.get("status", "")).lower() == "rollback":
            return FailureClass.ROLLBACK
        return FailureClass.LEADER_REFUSAL

    if _has_disagreement(r):
        return FailureClass.VALIDATOR_DISAGREEMENT

    er = _execution_result(r)
    if "TIMEOUT" in er or "TIME" in status:
        return FailureClass.TIMEOUT

    if status in ("", "UNKNOWN"):
        return FailureClass.UNKNOWN
    return FailureClass.UNKNOWN


def diagnose_text(text: str) -> List[Diagnosis]:
    """Extract every classified error in ``text`` and pair it with a fix hint."""
    seen: set = set()
    out: List[Diagnosis] = []
    fc = classify_failure(text)
    fc_value = fc.value if isinstance(fc, FailureClass) else str(fc)
    for prefix, reason in ERROR_RE.findall(text):
        code = f"{prefix}: {reason}"
        if code in seen:
            continue
        seen.add(code)
        ap, title, fix = REASON_TO_ANTIPATTERN.get(
            reason, ("docs/anti-patterns.md", "see the anti-pattern gallery",
                    "Match the reason code to an entry in docs/anti-patterns.md and apply its fix."))
        out.append(Diagnosis(code=code, prefix=prefix, reason=reason,
                             anti_pattern=ap, title=title, fix=fix,
                             failure_class=fc_value,
                             evidence=f"classified as {fc_value}"))
    if not out:
        # No classified error; still report the failure class if we can infer one.
        if fc_value not in ("none", "unknown"):
            out.append(Diagnosis(
                code=f"FAILURE: {fc_value.upper()}",
                prefix="EXPECTED",
                reason=fc_value.upper(),
                anti_pattern="docs/anti-patterns.md",
                title="inferred failure class",
                fix=FAILURE_CLASS_FIX.get(fc, FAILURE_CLASS_FIX[FailureClass.UNKNOWN]),
                failure_class=fc_value,
                evidence="no classified error code; class inferred from receipt shape",
            ))
    return out


def diagnose_receipt(receipt: Union[Dict[str, Any], str]) -> List[Diagnosis]:
    """Diagnose a parsed receipt: classify the failure, then extract reason codes."""
    r = _normalize_receipt(receipt)
    fc = classify_failure(r)
    fc_value = fc.value if isinstance(fc, FailureClass) else str(fc)

    text = r.get("_text") if isinstance(r, dict) else None
    if text is None:
        try:
            text = json.dumps(r)
        except (TypeError, ValueError):
            text = str(r)

    diagnoses = diagnose_text(text)
    # Attach the inferred failure class to every diagnosis (override the text-based one).
    for d in diagnoses:
        d.failure_class = fc_value
        d.evidence = _evidence_summary(r, fc)

    if not diagnoses:
        diagnoses = [Diagnosis(
            code=f"FAILURE: {fc_value.upper()}",
            prefix="EXPECTED",
            reason=fc_value.upper(),
            anti_pattern="docs/anti-patterns.md",
            title="inferred failure class",
            fix=FAILURE_CLASS_FIX.get(fc, FAILURE_CLASS_FIX[FailureClass.UNKNOWN]),
            failure_class=fc_value,
            evidence=_evidence_summary(r, fc),
        )]
    # Prepend a class-level diagnosis when the receipt failed.
    if fc not in (FailureClass.NONE,):
        diagnoses.insert(0, Diagnosis(
            code=f"CLASS: {fc_value.upper()}",
            prefix="EXPECTED",
            reason=fc_value.upper(),
            anti_pattern="docs/failure-diagnosis.md",
            title=fc_value.replace("_", " "),
            fix=FAILURE_CLASS_FIX.get(fc, FAILURE_CLASS_FIX[FailureClass.UNKNOWN]),
            failure_class=fc_value,
            evidence=_evidence_summary(r, fc),
        ))
    return diagnoses


def _evidence_summary(receipt: Dict[str, Any], fc: FailureClass) -> str:
    parts = []
    status = _status(receipt) if not isinstance(receipt, str) else ""
    if status:
        parts.append(f"status={status}")
    er = _execution_result(receipt) if not isinstance(receipt, str) else ""
    if er:
        parts.append(f"execution={er}")
    votes = _validator_votes(receipt) if not isinstance(receipt, str) else {}
    if votes:
        parts.append(f"votes={votes}")
    if _leader_errored(receipt) if not isinstance(receipt, str) else False:
        parts.append("leader_errored=true")
    if not parts:
        parts.append(f"failure_class={fc.value}")
    return "; ".join(parts)


def fetch_receipt(tx_hash: str, runner=subprocess.run) -> str:
    """Run ``genlayer receipt <txHash> --stdout --stderr`` and return combined text."""
    if shutil.which("genlayer") is None:
        raise RuntimeError("genlayer CLI not found on PATH; install it or pass --from-file")
    result = runner(
        ["genlayer", "receipt", tx_hash, "--stdout", "--stderr"],
        capture_output=True, text=True,
    )
    return (result.stdout or "") + "\n" + (result.stderr or "")


def format_text(diagnoses: List[Diagnosis], source: Optional[str] = None) -> str:
    if not diagnoses:
        lines = ["No classified error (EXPECTED/EXTERNAL/TRANSIENT/LLM_ERROR) found."]
        if source:
            lines.append(f"Source: {source}")
        lines.append("If the transaction failed, inspect the receipt manually or re-run with --from-file.")
        return "\n".join(lines)

    lines = []
    if source:
        lines.append(f"Source: {source}")
    lines.append(f"Found {len(diagnoses)} diagnosis entry/entries:")
    for d in diagnoses:
        lines.append(f"\n  {d.code}")
        lines.append(f"    class: {d.failure_class}")
        if d.evidence:
            lines.append(f"    evidence: {d.evidence}")
        lines.append(f"    anti-pattern: {d.anti_pattern} — {d.title}")
        lines.append(f"    fix: {d.fix}")
    lines.append("\nSee docs/failure-diagnosis.md and docs/anti-patterns.md for the full gallery.")
    return "\n".join(lines)
