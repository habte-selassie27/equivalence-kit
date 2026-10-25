"""Helpers for StudioNet reads.

`gltest`'s contract factory builds methods by asking a *local* node to synthesize a
schema from source; the hosted network can return the schema of a deployed address
directly. This builds a callable contract without a local node.
"""


def build_contract(address, account=None):
    from gltest.clients import get_gl_client
    from gltest.contracts.contract import Contract

    client = get_gl_client()
    response = client.provider.make_request(
        method="gen_getContractSchema",
        params=[address],
    )
    return Contract.new(address=address, schema=response["result"], account=account)
