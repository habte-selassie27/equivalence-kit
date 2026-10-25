# GitProof

Prove control of a GitHub account with a public gist and get an on-chain developer tier.
No OAuth, no backend, no trusted server.

## How it works

1. Create a **public** gist containing one line: `gitproof:<your wallet address>`.
2. Open the app, connect a wallet, enter your GitHub username and the gist ID.
3. The Intelligent Contract fetches the gist and the GitHub profile live. Every validator
   runs the same code and must agree on one tiny normalized result.
4. The contract stores `{github, tier, verified_at}` for the wallet and maps the username
   to that wallet. Anyone can look up either one.

## Use it

Live app: **https://gitproof-delta.vercel.app**

1. Go to https://gist.github.com and create a **public** gist (for example
   `gitproof.txt`) containing exactly one line:
   `gitproof:<your wallet address>`.
2. Copy the gist ID from the URL (the last path segment).
3. Open the app, connect your wallet on StudioNet, enter the GitHub username and the gist
   ID, and click **Verify**. Approve the transaction.
4. Use **Look up** with the wallet address or the GitHub username to read the record.

The **Copy proof line** button fills in the exact line for the connected wallet.

## Deployed contract

- Network: **StudioNet** (gasless)
- Address: `0x779eC676925D2d884f42b6398e622600aBa92e2e`
- Explorer: https://explorer-studio.genlayer.com/address/0x779eC676925D2d884f42b6398e622600aBa92e2e
- Deploy tx: `0xe28201ca9ec6be1523e6c2a37bc2cd936c8bf1dcfc1f44aeea8d55190a5af83e`
- Real `verify` tx: `0x417b112761c6d4d490161c399ded3430eba8a017ea36297c27fc9be162043061`
- Full evidence and a read-back: [`deployments.md`](deployments.md)

Contract source: [`contracts/gitproof.py`](contracts/gitproof.py)

## Tier

Computed in code from the live profile after consensus:

```
account_age_years = floor((transaction_time - created_at) / 365 days)
score = min(public_repos, 50) + min(followers, 100) // 2 + min(account_age_years, 5) * 5
tier = "NEWCOMER" if score < 15 else "BUILDER" if score < 45 else "VETERAN"
```

The only value validators compare is the canonical string for
`{"ok": true, "github": "<lowercase>", "tier": "<TIER>"}` or
`{"ok": false, "reason": "<CODE>"}`. Counts, dates, raw GitHub JSON and response bodies
are never compared.

The transaction timestamp is deterministic on GenLayer, so the age component does not
break consensus. The tier is a snapshot; it is not recomputed after verification.

## Reason codes

| Code | Meaning |
|---|---|
| `BAD_USERNAME` | Not 1–39 letters, numbers or hyphens. |
| `BAD_GIST_ID` | Not a 1–40 character alphanumeric gist ID. |
| `ALREADY_CLAIMED` | Another wallet already owns that username. |
| `GIST_NOT_FOUND` | GitHub returned 404 for the gist. |
| `GIST_NOT_PUBLIC` | The gist is secret. |
| `GIST_WRONG_OWNER` | The gist belongs to a different GitHub account. |
| `GIST_MISSING_PROOF` | No file line exactly matches the caller's proof. |
| `PROFILE_NOT_FOUND` | GitHub returned 404 for the username. |
| `SOURCE_UNAVAILABLE` | GitHub was unreachable, rate-limited or returned an unexpected shape. |

Every failure is fail-closed: no record is written. The frontend maps each code to a
plain-English message.

## Develop

Contract and mocked-web tests:

```shell
/usr/bin/python3.12 -m pytest tests/direct -q
genvm-lint check contracts/gitproof.py --json
```

The direct tests cover the happy path, wrong owner, missing proof, secret gist, duplicate
claim, GitHub 5xx/404 with no state written, bad inputs before any web call, and both tier
boundaries. No network is used.

StudioNet read evidence (the deployed address is in the test):

```shell
/usr/bin/python3.12 -m pytest tests/deploy -q -s --network studionet
```

Frontend:

```shell
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build
```

The contract address and network live in one place: `frontend/src/config.ts`.

## Limitations

- Proves control of a GitHub account at verification time and a **snapshot** activity
  tier. It does not prove the person is trustworthy.
- GitHub's unauthenticated API is limited to 60 requests/hour per IP. If validators hit
  the limit, the transaction fails with `SOURCE_UNAVAILABLE`; retrying later works.
- StudioNet only. No Bradbury deployment.
- One wallet per GitHub username. The same wallet may re-verify and update its record.
- The GitHub profile can change after verification. The stored tier is a snapshot, not a
  live ranking.

## Layout

```
contracts/gitproof.py        Intelligent Contract
tests/direct/                direct-mode tests with mocked GitHub
tests/deploy/                StudioNet read evidence
frontend/                    one-page Vite + React app
docs/api-notes.md            verified API ledger and remaining open items
docs/demo-script.md          60–90 second recording script
docs/submission-notes.md     portal-ready fields
deployments.md               address, transactions, read-back
```

## Notes

- The GenLayer CLI types a `0x…` argument as an address, so `get_record` must be read
  through the frontend or the Python client, not `genlayer call --args 0x…`.
- The views return JSON strings so the frontend and the tests read exactly the same value.
- The project was built on StudioNet; the deploy and writes cost 0 GEN.
