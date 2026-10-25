# GitProof — StudioNet deployment

StudioNet is gasless: this deploy and write cost **0 GEN**. No private key is stored in
this repository.

- Network: `studionet`
- RPC: `https://studio.genlayer.com/api`
- Explorer: `https://explorer-studio.genlayer.com`
- Deployed: 2026-10-25

## Contract

| Field | Value |
|---|---|
| Contract file | `contracts/gitproof.py` |
| Address | `0x779eC676925D2d884f42b6398e622600aBa92e2e` |
| Explorer | https://explorer-studio.genlayer.com/address/0x779eC676925D2d884f42b6398e622600aBa92e2e |
| Deploy tx | `0xe28201ca9ec6be1523e6c2a37bc2cd936c8bf1dcfc1f44aeea8d55190a5af83e` |
| Deploy explorer | https://explorer-studio.genlayer.com/tx/0xe28201ca9ec6be1523e6c2a37bc2cd936c8bf1dcfc1f44aeea8d55190a5af83e |
| Deploy result | `ACCEPTED` at deploy time, votes `AGREE, IDLE, AGREE, IDLE, AGREE` |

## Real verification

- GitHub username: `habte-selassie27`
- Wallet: `0x5b3661c576c7001e6d6279c67f3779705d334c89`
- Public gist: https://gist.github.com/habte-selassie27/f73e0e3eb9ddf87d5c9625d46cdc745c
- Gist ID: `f73e0e3eb9ddf87d5c9625d46cdc745c`
- Proof line: `gitproof:0x5b3661c576c7001e6d6279c67f3779705d334c89`
- `verify` tx: `0x417b112761c6d4d490161c399ded3430eba8a017ea36297c27fc9be162043061`
- Verify explorer: https://explorer-studio.genlayer.com/tx/0x417b112761c6d4d490161c399ded3430eba8a017ea36297c27fc9be162043061
- Verify result: `ACCEPTED` at write time (now `FINALIZED`), `MAJORITY_AGREE`, votes
  `IDLE, AGREE, IDLE, AGREE, AGREE`

Read back with the Python client (`get_record` must receive a real `str`, not the CLI's
address-typed argument):

```json
{"github": "habte-selassie27", "tier": "VETERAN", "verified_at": 1792939254, "wallet": "0x5b3661c576c7001e6d6279c67f3779705d334c89"}
```

`get_wallet("habte-selassie27")` returns
`0x5b3661c576c7001e6d6279c67f3779705d334c89`.

## Frontend

- Production: https://gitproof-delta.vercel.app
- Vercel project: `habteselassies-projects/gitproof`
- Build: `cd frontend && npm run build` (Vite + React, output `dist`)
- The unique `gitproof.vercel.app` host belongs to an unrelated site; the project alias is
  `gitproof-delta.vercel.app`.

## Fail-closed evidence

A deliberately invalid gist ID (`bad/id`) was rejected before any web call. The transaction
was accepted (validators agreed) with an **ERROR** execution and the payload
`BAD_GIST_ID`, and no record was written:

- tx: `0x513cd290aaf807ee63ad0d101a34baf02f40e0ccde6e543037f30a7552e97e02`
- explorer: https://explorer-studio.genlayer.com/tx/0x513cd290aaf807ee63ad0d101a34baf02f40e0ccde6e543037f30a7552e97e02
- `leader_receipt[0].result = {status: "rollback", payload: "BAD_GIST_ID"}`

## Reproduce the read

```shell
/usr/bin/python3.12 -m pytest tests/deploy -q -s --network studionet
```

## Gas

StudioNet writes are gasless, so no GEN is required. The deployer account is the local
GenLayer CLI account active at deployment time; only its public address is recorded here.
