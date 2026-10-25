# AGENTS.md — GitProof

Build this in **a few hours**. Smallest thing that works end to end. If unsure whether something
is needed, leave it out and tell the human.

## 1. What we are building

**GitProof**: a wallet proves it controls a GitHub account (no OAuth, no backend) and gets an
on-chain **developer reputation tier** computed from live GitHub data.

Flow:
1. User creates a **public gist** containing one line: `gitproof:<their wallet address>`.
2. User opens the web app, connects wallet, enters GitHub username + gist ID, clicks **Verify**.
3. The Intelligent Contract fetches the gist and the GitHub profile **live**, checks that the
   gist is owned by that username and contains the caller's address, computes a tier **in code**,
   and stores `{github, tier, verified_at}` for that wallet.
4. Anyone can look up a wallet (or username) and read its verified identity and tier.

Why it fits the quality bar:
- **Real trust problem:** binding a wallet to an off-chain identity without a trusted server.
- **Live authoritative data:** GitHub's public API, fetched by validators independently.
- **GenLayer is central:** validators each fetch the web and must reach consensus; a plain EVM
  contract cannot do this.
- **Not "just an LLM answer":** identity and tier are decided by deterministic code. Do NOT add
  an LLM unless there is time left and the human asks for it.

## 2. Scope

IN (must ship):
- One Intelligent Contract: `contracts/gitproof.py`
- Direct-mode tests with mocked web
- One-page frontend: connect wallet, verify, lookup, transaction status
- Deployed on **StudioNet** (gasless), address saved in frontend config
- README with 3 usage steps, and a deployments note

OUT (do not build): Bradbury deployment, OAuth, indexers, databases, backends, multiple
identity providers, NFTs/SBTs, admin roles, upgrade logic, dashboards, i18n, auth libraries,
CI pipelines, extra CLI tools.

## 3. Hard rules

1. **Never invent GenLayer APIs, imports, decorators, SDK calls, network names or RPC URLs.**
   Before writing contract or SDK code, read: the GenLayer docs, the
   `genlayer-project-boilerplate` repo, and any existing GenLayer skill/AGENTS file the human has.
   Copy proven patterns. If a call cannot be verified, add `TODO(verify)` and list it at the end.
2. **Fail closed.** If GitHub is unreachable, rate-limited or returns something unexpected, the
   transaction must revert/reject with a stable error string. Never store a partial or "unverified"
   record as if it were valid.
3. **Deterministic core.** Everything validators compare must be a small, normalized value
   (see section 5). Never compare raw web text or follower counts directly.
4. **No secrets in the repo.** No private keys, no tokens. The frontend signs with the user's
   wallet. Do not require a GitHub token.
5. **Do not weaken or delete tests to make them pass.**
6. Keep it small: contract under ~200 lines, frontend under ~300 lines of app code.

## 4. Contract spec (`contracts/gitproof.py`)

State (verify exact storage types from docs/boilerplate):
- `records`: map wallet address -> `{github: str, tier: str, verified_at: u256 or str}`
- `owners`: map normalized github username -> wallet address (one wallet per username; prevents
  two wallets claiming the same account)

Methods:
- `verify(github_username: str, gist_id: str)` — **write**. Uses the caller's address
  (`gl` message sender; verify exact name in docs).
- `get_record(wallet: str)` — **view**. Returns the record or an empty/none result.
- `get_wallet(github_username: str)` — **view**. Returns the wallet that claimed it, if any.

Validation before any web call (cheap, deterministic):
- `github_username`: 1-39 chars, `[A-Za-z0-9-]`, lowercase it for storage.
- `gist_id`: hex-ish string, max ~40 chars, no slashes.
- Reject if the username is already owned by a different wallet.

Web fetches (inside the non-deterministic block, verify exact web API in docs):
- `https://api.github.com/gists/<gist_id>` -> JSON. Checks:
  - `owner.login` equals the username (case-insensitive)
  - the gist is public
  - some file's `content` contains exactly `gitproof:<caller address>` (case-insensitive hex)
- `https://api.github.com/users/<username>` -> JSON. Read: `public_repos`, `followers`,
  `created_at`.
- Do NOT use `gist_id` to build any other URL. Fixed host only (`api.github.com`).

Tier computed **in code** from the profile (bucketed so tiny live changes don't break consensus):
```
account_age_years = floor((now - created_at) / 365 days)   # use a fixed reference, see below
score = min(public_repos, 50) + min(followers, 100) // 2 + min(account_age_years, 5) * 5
tier = "NEWCOMER" if score < 15 else "BUILDER" if score < 45 else "VETERAN"
```
- Do not use wall-clock "now" inside the comparison if validators could differ across a boundary.
  Prefer computing age from `created_at` against the block/transaction timestamp if the SDK
  exposes it (verify), otherwise use only `public_repos` and `followers` and drop age.
- Tune thresholds so the human's own GitHub account lands clearly inside a bucket, not on a
  boundary.

Consensus (verify exact helper names in docs):
- The non-deterministic function returns a **tiny normalized value**:
  `{"ok": true, "github": "<lowercased>", "tier": "BUILDER"}` or `{"ok": false, "reason": "<CODE>"}`.
- Use the **strict equality** equivalence helper on that normalized value. Nothing else is
  compared. No raw bodies, no counts, no timestamps in the compared value.
- After consensus: if `ok` is false, raise with the stable reason; if true, write `records` and
  `owners`.

Stable reason codes (closed set, use exactly these strings):
`BAD_USERNAME`, `BAD_GIST_ID`, `ALREADY_CLAIMED`, `GIST_NOT_FOUND`, `GIST_NOT_PUBLIC`,
`GIST_WRONG_OWNER`, `GIST_MISSING_PROOF`, `PROFILE_NOT_FOUND`, `SOURCE_UNAVAILABLE`.

Known risk to document, not solve: unauthenticated GitHub API has a low rate limit per IP.
If validators hit it, the transaction fails with `SOURCE_UNAVAILABLE`; retrying later works.

## 5. Tests (`tests/direct/`)

Use the direct-mode test approach from the boilerplate with **mocked web responses**.
Required cases (keep each tiny):
1. Happy path: valid gist + profile -> record stored with expected tier.
2. Gist owned by someone else -> `GIST_WRONG_OWNER`.
3. Gist missing the caller's address -> `GIST_MISSING_PROOF`.
4. Private/non-public gist -> `GIST_NOT_PUBLIC`.
5. Username already claimed by another wallet -> `ALREADY_CLAIMED`.
6. GitHub error (500/404) -> `SOURCE_UNAVAILABLE` / `PROFILE_NOT_FOUND`, **no state written**.
7. Bad inputs (`BAD_USERNAME`, `BAD_GIST_ID`) rejected before any web call.
8. Tier boundaries: just below and at each threshold.

Also run `genvm-lint` (or the boilerplate's lint step) on the contract and fix all findings.

## 6. Frontend (`frontend/`, Vite + React or plain Vite, pick whichever the boilerplate uses)

One page, four blocks:
1. **Connect wallet** (use the official `genlayer-js` SDK and the StudioNet chain config;
   verify exact import names in the SDK docs).
2. **Verify form**: username + gist ID + a "Copy proof line" button that copies
   `gitproof:<connected address>` and a link to https://gist.github.com to create the gist.
3. **Transaction status**: show signature -> tx hash -> consensus status -> final result
   (success, or the stable reason code with a plain-English message).
4. **Lookup**: input a wallet address or GitHub username, call the view methods, show the card
   (`@username · TIER · verified`).

Rules: no backend, no keys, wallet signs. Contract address and chain come from one config file.
Show friendly error text for each reason code. Mobile-friendly, simple clean styling, no UI
library needed.

## 7. Timeboxed plan (stop and report after each gate)

| Time | Task | Gate |
|---|---|---|
| 0:00-0:20 | Clone boilerplate, read docs, verify every API you will use, write the verified list in `docs/api-notes.md` | Notes file exists, no unverified calls remain without `TODO(verify)` |
| 0:20-1:30 | Contract + direct tests + lint | All 8 test cases pass, lint clean |
| 1:30-2:00 | Deploy to StudioNet, run one real `verify` with a real gist | Record readable via `get_record`; save address + tx hash in `deployments.md` |
| 2:00-3:15 | Frontend wired to the deployed contract | Real wallet write works with full status display, lookup shows the card |
| 3:15-3:45 | README, 60-90s demo script, deploy frontend (Vercel) | Public URL loads and the Live flow works |
| 3:45-4:00 | Fill the Portal form | Checklist below ticked |

If behind schedule, cut in this order: tier age component -> username lookup -> styling polish.
Never cut: the real StudioNet write, the tests, the demo.

## 8. README (keep short)

- 2-line pitch
- How it works (the 4 flow steps from section 1)
- Use it: create gist, open site, verify
- Contract address (StudioNet) + explorer link
- Reason-code table
- Limitations: proves control of a GitHub account and a snapshot activity tier, not that the
  person is trustworthy; GitHub rate limits; StudioNet only.

## 9. Portal submission checklist (Identity/Reputation)

- [ ] Primary tag: Identity/Reputation (pick the closest two secondary tags offered)
- [ ] Website URL = deployed frontend; GitHub = repo; evidence = repo link
- [ ] Contract link = StudioNet explorer address URL
- [ ] How-to steps: connect wallet, create gist with proof line, enter username + gist ID,
      verify, look up the record
- [ ] Expected verification outcome: transaction reaches final status and the lookup shows
      `@username · TIER` for the broker
- [ ] Demo video (YouTube or X post), 60-90 seconds, one continuous run
- [ ] One-liner (max 180 chars) and description (max 1000 chars) written from the README

## 10. How you (the agent) work

1. Read this file fully, then do the 0:00-0:20 step and show me `docs/api-notes.md`.
2. State a plan in 5 lines or fewer before each step.
3. Run the gate command for each step and paste the real output. If you could not run
   something, say so plainly; never claim it works.
4. Ask me before: adding a dependency, adding any feature not in section 2 IN, or deploying
   anywhere other than StudioNet.
5. At the end, list every `TODO(verify)` and every place you deviated from this file.
