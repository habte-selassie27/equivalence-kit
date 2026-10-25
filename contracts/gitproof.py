# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""GitProof: bind a wallet to a GitHub account with a public gist.

A wallet writes one line, ``gitproof:<wallet address>``, into a public gist. This
contract fetches that gist and the GitHub profile live, checks the proof in code, and
stores the agreed identity plus a bucketed developer tier.

Consensus only ever compares a tiny canonical value:
``{"ok": true, "github": "<lowercase>", "tier": "<TIER>"}`` or
``{"ok": false, "reason": "<CODE>"}``. No raw JSON, counts, timestamps or bodies are
compared. State is written only after ``strict_eq`` returns.
"""

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from genlayer import *

# Stable reason codes: the only values returned to a caller.
BAD_USERNAME = "BAD_USERNAME"
BAD_GIST_ID = "BAD_GIST_ID"
ALREADY_CLAIMED = "ALREADY_CLAIMED"
GIST_NOT_FOUND = "GIST_NOT_FOUND"
GIST_NOT_PUBLIC = "GIST_NOT_PUBLIC"
GIST_WRONG_OWNER = "GIST_WRONG_OWNER"
GIST_MISSING_PROOF = "GIST_MISSING_PROOF"
PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"

REASONS = (
    BAD_USERNAME,
    BAD_GIST_ID,
    ALREADY_CLAIMED,
    GIST_NOT_FOUND,
    GIST_NOT_PUBLIC,
    GIST_WRONG_OWNER,
    GIST_MISSING_PROOF,
    PROFILE_NOT_FOUND,
    SOURCE_UNAVAILABLE,
)

NEWCOMER = "NEWCOMER"
BUILDER = "BUILDER"
VETERAN = "VETERAN"
TIERS = (NEWCOMER, BUILDER, VETERAN)

USERNAME_RE = r"^[A-Za-z0-9-]{1,39}$"
GIST_ID_RE = r"^[A-Za-z0-9]{1,40}$"

API_GISTS = "https://api.github.com/gists/"
API_USERS = "https://api.github.com/users/"


@allow_storage
@dataclass
class ProfileRecord:
    github: str
    tier: str
    verified_at: u256


def _fail(reason: str) -> str:
    """The canonical failure value compared by strict_eq."""
    return json.dumps({"ok": False, "reason": reason}, sort_keys=True)


def _ok(github: str, tier: str) -> str:
    """The canonical success value compared by strict_eq."""
    return json.dumps(
        {"ok": True, "github": github, "tier": tier}, sort_keys=True
    )


def _valid_username(value: str) -> bool:
    return isinstance(value, str) and re.fullmatch(USERNAME_RE, value) is not None


def _valid_gist_id(value: str) -> bool:
    return isinstance(value, str) and re.fullmatch(GIST_ID_RE, value) is not None


def _account_age_years(created_at: str) -> int:
    """Whole years between GitHub's created_at and the deterministic tx timestamp."""
    if not isinstance(created_at, str) or len(created_at) < 10:
        raise ValueError("created_at")
    text = created_at.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    created = datetime.fromisoformat(text)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    days = (now - created).days
    if days < 0:
        return 0
    return days // 365


def _tier(profile: dict) -> str:
    """Bucket a GitHub profile in code. Never compares raw profile fields."""
    repos = profile.get("public_repos")
    followers = profile.get("followers")
    created_at = profile.get("created_at")
    if isinstance(repos, bool) or not isinstance(repos, int) or repos < 0:
        raise ValueError("public_repos")
    if isinstance(followers, bool) or not isinstance(followers, int) or followers < 0:
        raise ValueError("followers")
    age = _account_age_years(created_at)
    score = min(repos, 50) + min(followers, 100) // 2 + min(age, 5) * 5
    if score < 15:
        return NEWCOMER
    if score < 45:
        return BUILDER
    return VETERAN


class GitProof(gl.Contract):
    records: TreeMap[str, ProfileRecord]
    owners: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def verify(self, github_username: str, gist_id: str) -> None:
        """Prove control of a GitHub account and store the tier for the caller."""
        if not _valid_username(github_username):
            raise gl.vm.UserError(BAD_USERNAME)
        if not _valid_gist_id(gist_id):
            raise gl.vm.UserError(BAD_GIST_ID)

        github = github_username.lower()
        sender = gl.message.sender_address.as_hex.lower()
        proof = "gitproof:" + sender

        if github in self.owners and self.owners[github].lower() != sender:
            raise gl.vm.UserError(ALREADY_CLAIMED)

        def classify() -> str:
            # Gist: owner, visibility and the caller's proof line.
            try:
                response = gl.nondet.web.get(API_GISTS + gist_id)
                if response.status == 404:
                    return _fail(GIST_NOT_FOUND)
                if response.status != 200 or not response.body:
                    return _fail(SOURCE_UNAVAILABLE)
                gist = json.loads(response.body.decode("utf-8"))
            except Exception:
                return _fail(SOURCE_UNAVAILABLE)

            try:
                if not isinstance(gist, dict):
                    return _fail(SOURCE_UNAVAILABLE)
                owner = gist.get("owner")
                login = owner.get("login") if isinstance(owner, dict) else None
                if not isinstance(login, str) or login.lower() != github:
                    return _fail(GIST_WRONG_OWNER)
                if gist.get("public") is not True:
                    return _fail(GIST_NOT_PUBLIC)
                files = gist.get("files")
                if not isinstance(files, dict):
                    return _fail(SOURCE_UNAVAILABLE)
                found = False
                for entry in files.values():
                    if not isinstance(entry, dict):
                        continue
                    content = entry.get("content")
                    if not isinstance(content, str):
                        continue
                    for line in content.splitlines():
                        if line.strip().lower() == proof:
                            found = True
                            break
                    if found:
                        break
                if not found:
                    return _fail(GIST_MISSING_PROOF)
            except Exception:
                return _fail(SOURCE_UNAVAILABLE)

            # Profile: fetch only after the proof is valid.
            try:
                response = gl.nondet.web.get(API_USERS + github)
                if response.status == 404:
                    return _fail(PROFILE_NOT_FOUND)
                if response.status != 200 or not response.body:
                    return _fail(SOURCE_UNAVAILABLE)
                profile = json.loads(response.body.decode("utf-8"))
                if not isinstance(profile, dict):
                    return _fail(SOURCE_UNAVAILABLE)
                tier = _tier(profile)
            except Exception:
                return _fail(SOURCE_UNAVAILABLE)

            return _ok(github, tier)

        agreed = gl.eq_principle.strict_eq(classify)

        try:
            result = json.loads(agreed) if isinstance(agreed, str) else agreed
        except Exception:
            raise gl.vm.UserError(SOURCE_UNAVAILABLE)
        if not isinstance(result, dict):
            raise gl.vm.UserError(SOURCE_UNAVAILABLE)

        if result.get("ok") is not True:
            reason = result.get("reason")
            raise gl.vm.UserError(reason if reason in REASONS else SOURCE_UNAVAILABLE)

        # Defense in depth: the agreed value must be the one this call asked for.
        if result.get("github") != github or result.get("tier") not in TIERS:
            raise gl.vm.UserError(SOURCE_UNAVAILABLE)

        self.records[sender] = ProfileRecord(
            github=github,
            tier=result["tier"],
            verified_at=u256(int(datetime.now(timezone.utc).timestamp())),
        )
        self.owners[github] = sender

    @gl.public.view
    def get_record(self, wallet: str) -> str:
        """Return one wallet's record as JSON, or ``{}`` when it has none."""
        key = wallet.strip().lower() if isinstance(wallet, str) else ""
        if key not in self.records:
            return "{}"
        record = self.records[key]
        return json.dumps(
            {
                "wallet": key,
                "github": record.github,
                "tier": record.tier,
                "verified_at": int(record.verified_at),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_wallet(self, github_username: str) -> str:
        """Return the wallet that claimed a username, or ``""``."""
        if not _valid_username(github_username):
            return ""
        return self.owners.get(github_username.lower(), "")
