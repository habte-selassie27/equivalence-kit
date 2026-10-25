# GitProof — submission notes

Copy-paste fields for the GenLayer Portal (Identity / Reputation).

## Links

- **Website:** https://gitproof-delta.vercel.app
- **GitHub:** https://github.com/habte-selassie27/equivalence-kit
- **Contract (StudioNet):** https://explorer-studio.genlayer.com/address/0x779eC676925D2d884f42b6398e622600aBa92e2e
- **Deploy tx:** https://explorer-studio.genlayer.com/tx/0xe28201ca9ec6be1523e6c2a37bc2cd936c8bf1dcfc1f44aeea8d55190a5af83e
- **Real verify tx:** https://explorer-studio.genlayer.com/tx/0x417b112761c6d4d490161c399ded3430eba8a017ea36297c27fc9be162043061
- **Evidence:** repository link plus [`deployments.md`](../deployments.md)
- **Demo video:** **TODO — record it with [`demo-script.md`](demo-script.md) and paste the YouTube/X URL here.**

## Tags

- **Primary:** Identity / Reputation
- **Secondary:** pick the closest two the form offers. Suggested: *Developer Tooling* and
  *Social / Identity*. The project is also a live example of *Consensus / Equivalence*
  (the only compared value is a normalized `{ok, github, tier}` string).

## One-liner (max 180 characters)

```text
Prove a GitHub account with a public gist and get an on-chain developer tier on GenLayer — no OAuth, no backend, no trusted server.
```

## Description (max 1000 characters)

```text
GitProof lets a wallet prove it controls a GitHub account without OAuth or a backend. The user creates a public gist containing gitproof:<wallet address>, then submits the GitHub username and gist ID to a GenLayer Intelligent Contract. Validators independently fetch the gist and the GitHub profile live, check ownership, visibility and the exact proof line, and compute a developer tier in code. Consensus compares only a tiny normalized value — the username and the tier — never raw web text or follower counts. The contract stores the verified identity and tier for the wallet and maps the username to that wallet. Anyone can look up the record by wallet or username. Failures are fail-closed with stable reason codes such as GIST_WRONG_OWNER or SOURCE_UNAVAILABLE. Deployed on gasless StudioNet; direct-mode tests mock both GitHub endpoints and cover the happy path, every rejection path, and the tier boundaries.
```

Counts on 2026-10-25: 131 characters and 917 characters.

## 350-character blurb (if the form asks for exactly 350)

```text
GitProof lets a wallet prove it controls a GitHub account without OAuth or a backend. Post a public gist with gitproof:<wallet>, and a GenLayer Intelligent Contract fetches the gist and profile live, verifies ownership, and stores a developer reputation tier onchain. Anyone can now look up the verified identity by wallet address or GitHub username.
```

The line inside the code block is 350 characters exactly (counted on 2026-10-25).

## How to use it (portal how-to)

1. Connect a wallet on **StudioNet** at https://gitproof-delta.vercel.app.
2. Click **Copy proof line**. Create a **public** gist at https://gist.github.com with
   that one line.
3. Copy the gist ID from the gist URL.
4. Enter the GitHub username and gist ID in **Verify**, click **Verify**, and approve the
   wallet transaction.
5. Watch the signature, transaction hash, consensus status and final result. Then use
   **Look up** with the wallet address or the GitHub username.

## Expected verification outcome

The transaction reaches **ACCEPTED / FINALIZED** and the lookup shows:

```
@habte-selassie27 · VETERAN · verified 10/25/2026
wallet 0x5b36…4c89
```

The recorded on-chain record is:

```json
{"github": "habte-selassie27", "tier": "VETERAN", "verified_at": 1792939254, "wallet": "0x5b3661c576c7001e6d6279c67f3779705d334c89"}
```

> The existing `habte-selassie27` record is owned by
> `0x5b3661c576c7001e6d6279c67f3779705d334c89`. If the demo uses a different wallet,
> create a new gist with **that** wallet's address and use a GitHub account that has not
> been claimed, or the contract will correctly reject it with `ALREADY_CLAIMED`. See
> [`demo-script.md`](demo-script.md) for the pre-flight checklist.

## Evidence to cite

- `contracts/gitproof.py` — the Intelligent Contract.
- `tests/direct/test_gitproof.py` — 14 direct-mode tests with mocked GitHub; all pass.
- `tests/deploy/test_gitproof_studionet.py` — reads the live record from StudioNet.
- `deployments.md` — addresses, transactions, votes and read-back.
- `docs/api-notes.md` — every API used, with the two live `TODO(verify)` items resolved.

## Limitations to state honestly

- Proves control of a GitHub account and a snapshot activity tier, not that the person is
  trustworthy.
- GitHub's unauthenticated rate limit can make a transaction fail with
  `SOURCE_UNAVAILABLE`; retrying later works.
- StudioNet only.
