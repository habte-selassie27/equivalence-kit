"""Read-only StudioNet evidence for the GitProof deployment.

Run explicitly:

    /usr/bin/python3.12 -m pytest tests/deploy -q -s --network studionet
"""

import json

from tests.helpers import build_contract

ADDRESS = "0x779eC676925D2d884f42b6398e622600aBa92e2e"
WALLET = "0x5b3661c576c7001e6d6279c67f3779705d334c89"
USERNAME = "habte-selassie27"


def test_live_record_is_readable():
    contract = build_contract(ADDRESS)

    raw = contract.get_record(args=[WALLET]).call()
    print("get_record:", raw)
    record = json.loads(raw)
    assert record["wallet"] == WALLET
    assert record["github"] == USERNAME
    assert record["tier"] == "VETERAN"
    assert record["verified_at"] > 0

    wallet = contract.get_wallet(args=[USERNAME]).call()
    print("get_wallet:", wallet)
    assert wallet == WALLET
