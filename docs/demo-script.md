# GitProof — 60–90 second demo script

One continuous run. Do not cut between the browser and the gist more than once.

## Before recording

- [ ] The app is open at https://gitproof-delta.vercel.app.
- [ ] The wallet you will connect is on StudioNet.
- [ ] You control the GitHub account you will type.
- [ ] The public gist exists and contains exactly
      `gitproof:<that wallet's address>` on its own line.
- [ ] You know the gist ID (the last segment of the gist URL).
- [ ] **Important:** `habte-selassie27` is already claimed by
      `0x5b3661c576c7001e6d6279c67f3779705d334c89`. Connect that wallet to re-verify the
      existing record, or use a different GitHub account with the wallet that is
      connected. A different wallet on the same username is rejected with
      `ALREADY_CLAIMED` by design.

## Script

**0:00–0:10 — The problem**

> "GitProof binds a wallet to a GitHub account without OAuth and without a backend.
> The proof is a public gist; the verifier is a GenLayer Intelligent Contract."

**0:10–0:25 — The proof**

Show the public gist. Point at the single line:

> "This line contains the wallet address. The contract will fetch this gist live, check
> that the gist belongs to the username, and check that the exact line contains the
> caller's address."

**0:25–0:50 — Verify**

Open the app, connect the wallet, paste the username and gist ID, click **Verify**.

> "The wallet signs. The transaction hash appears here. Validators are fetching GitHub
> independently and comparing one normalized value: the username and the tier."

When it finalizes:

> "Accepted. The contract stored the identity and the tier on StudioNet."

**0:50–1:10 — Look up**

Use **Look up** with the GitHub username, then with the wallet address.

> "Anyone can read the record. This is `@username · VETERAN · verified` — no wallet
> needed for the read."

**1:10–1:25 — Fail closed**

Open the explorer transaction and show the execution payload (or mention the reason-code
table in the README).

> "If the gist is missing, wrong, private, or GitHub is rate-limited, the transaction
> rejects with a stable code such as `GIST_MISSING_PROOF` or `SOURCE_UNAVAILABLE`.
> Nothing partial is ever stored."

**1:25–1:30 — Close**

> "GitProof: GitHub identity and a developer tier, verified by consensus."

## After recording

Add the public video URL to `docs/submission-notes.md` and to the portal.
