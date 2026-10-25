"""Direct-mode tests for GitProof. Web calls are mocked; no network is used."""

import json

import pytest

from tests.direct.conftest import to_hex


def _proof(address) -> str:
    return "gitproof:" + to_hex(address).lower()


def _gist(owner="alice", public=True, content=None, files=None):
    if files is None:
        files = {"proof.txt": {"filename": "proof.txt", "content": content or ""}}
    return {
        "id": "abc123",
        "public": public,
        "owner": {"login": owner},
        "files": files,
    }


def _profile(login="alice", repos=10, followers=20, created_at="2026-10-01T00:00:00Z"):
    return {
        "login": login,
        "public_repos": repos,
        "followers": followers,
        "created_at": created_at,
    }


def _mock_gist(direct_vm, payload):
    direct_vm.mock_web(r".*api\.github\.com/gists/.*", {"status": 200, "body": json.dumps(payload)})


def _mock_profile(direct_vm, payload):
    direct_vm.mock_web(r".*api\.github\.com/users/.*", {"status": 200, "body": json.dumps(payload)})


def _mock_status(direct_vm, route, status, body=""):
    direct_vm.mock_web(rf".*api\.github\.com/{route}/.*", {"status": status, "body": body})


def test_happy_path_stores_the_agreed_record(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    # Mixed case in both the username and the proof line: both are normalized.
    _mock_gist(
        direct_vm,
        _gist(owner="Alice", public=True, content="# my proof\n" + _proof(direct_alice).upper() + "\n"),
    )
    _mock_profile(
        direct_vm,
        _profile(login="Alice", repos=168, followers=52, created_at="2022-06-11T10:05:08Z"),
    )

    contract.verify("Alice", "abc123")

    record = json.loads(contract.get_record(alice))
    assert record["wallet"] == alice
    assert record["github"] == "alice"
    assert record["tier"] == "VETERAN"
    assert record["verified_at"] > 0
    assert contract.get_wallet("ALICE") == alice
    assert contract.get_wallet("alice") == alice
    assert json.loads(contract.get_record("0xdeadbeef")) == {}


def test_gist_owned_by_someone_else_is_rejected(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="mallory", public=True, content=_proof(direct_alice)))
    _mock_profile(direct_vm, _profile(login="alice"))

    with direct_vm.expect_revert("GIST_WRONG_OWNER"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}
    assert contract.get_wallet("alice") == ""


def test_gist_missing_the_callers_proof_is_rejected(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(
        direct_vm,
        _gist(owner="alice", public=True, content="gitproof:0x0000000000000000000000000000000000000000"),
    )
    _mock_profile(direct_vm, _profile(login="alice"))

    with direct_vm.expect_revert("GIST_MISSING_PROOF"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_private_gist_is_rejected(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=False, content=_proof(direct_alice)))
    _mock_profile(direct_vm, _profile(login="alice"))

    with direct_vm.expect_revert("GIST_NOT_PUBLIC"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_username_claimed_by_another_wallet_is_rejected(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/gitproof.py")

    direct_vm.sender = direct_alice
    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_profile(direct_vm, _profile(login="alice"))
    contract.verify("alice", "abc123")
    alice = to_hex(direct_alice).lower()

    direct_vm.sender = direct_bob
    direct_vm.clear_mocks()  # a web call here would fail: the claim check must come first
    with direct_vm.expect_revert("ALREADY_CLAIMED"):
        contract.verify("ALICE", "abc123")

    # Alice's record is untouched.
    assert json.loads(contract.get_record(alice))["github"] == "alice"
    assert contract.get_wallet("alice") == alice


@pytest.mark.parametrize("status", [500, 503])
def test_gist_server_error_is_source_unavailable(
    direct_vm, direct_deploy, direct_alice, status
):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_status(direct_vm, "gists", status)

    with direct_vm.expect_revert("SOURCE_UNAVAILABLE"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_gist_404_is_gist_not_found(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_status(direct_vm, "gists", 404)

    with direct_vm.expect_revert("GIST_NOT_FOUND"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_profile_server_error_is_source_unavailable(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_status(direct_vm, "users", 500)

    with direct_vm.expect_revert("SOURCE_UNAVAILABLE"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_profile_404_is_profile_not_found(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_status(direct_vm, "users", 404)

    with direct_vm.expect_revert("PROFILE_NOT_FOUND"):
        contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice)) == {}


def test_bad_inputs_are_rejected_before_any_web_call(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    direct_vm.clear_mocks()  # any fetch would raise a missing-mock error instead

    for username in ("", "a" * 40, "bad_name", "bad/name", " bad", "bad "):
        with direct_vm.expect_revert("BAD_USERNAME"):
            contract.verify(username, "abc123")

    for gist_id in ("", "a" * 41, "../etc/passwd", "abc-def", "abc/def", "abc.def"):
        with direct_vm.expect_revert("BAD_GIST_ID"):
            contract.verify("alice", gist_id)


def test_tier_boundaries_just_below_and_at_each_threshold(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))

    cases = [
        (14, "NEWCOMER"),  # score 14, just below 15
        (15, "BUILDER"),  # score 15, on the first threshold
        (44, "BUILDER"),  # score 44, just below 45
        (45, "VETERAN"),  # score 45, on the second threshold
    ]
    for repos, expected in cases:
        direct_vm.clear_mocks()
        _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
        _mock_profile(
            direct_vm,
            _profile(login="alice", repos=repos, followers=0, created_at="2026-10-01T00:00:00Z"),
        )
        contract.verify("alice", "abc123")
        assert json.loads(contract.get_record(alice))["tier"] == expected


def test_age_and_caps_contribute_to_the_score(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_profile(
        direct_vm,
        _profile(login="alice", repos=0, followers=0, created_at="2016-01-01T00:00:00Z"),
    )

    contract.verify("alice", "abc123")

    # 10 whole years are capped at 5: 5 * 5 = 25, so BUILDER despite zero repos.
    assert json.loads(contract.get_record(alice))["tier"] == "BUILDER"


def test_reverification_by_the_same_wallet_updates_the_record(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/gitproof.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice).lower()

    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_profile(direct_vm, _profile(login="alice", repos=15, followers=0))
    contract.verify("alice", "abc123")
    assert json.loads(contract.get_record(alice))["tier"] == "BUILDER"

    direct_vm.clear_mocks()
    _mock_gist(direct_vm, _gist(owner="alice", public=True, content=_proof(direct_alice)))
    _mock_profile(direct_vm, _profile(login="alice", repos=0, followers=0))
    contract.verify("alice", "abc123")

    assert json.loads(contract.get_record(alice))["tier"] == "NEWCOMER"
    assert contract.get_wallet("alice") == alice
