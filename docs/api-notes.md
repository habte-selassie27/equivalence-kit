# GitProof — verified API notes

Written 2026-10-25 before any contract or frontend code. Every API below was read from an
official source or executed locally; anything not yet executed end-to-end is marked
`TODO(verify)` and listed again at the bottom.

## Sources

- `https://docs.genlayer.com/full-documentation.txt` — fetched 2026-10-25 (1,028,906 bytes).
- `https://docs.genlayer.com/developers/intelligent-contracts/examples/fetch-github-profile`
- `https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle`
- `https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context`
- `genlayerlabs/genlayer-project-boilerplate` @ `main`, cloned 2026-10-25
  (`contracts/football_bets.py`, `contracts/PatternTest.py`, `tests/direct/`).
- Installed locally: `genlayer-test 0.29.2`, `genvm-linter 0.11.0`, `genlayer-py 0.16.3`,
  CPython 3.12.13.
- Prior StudioNet deployments recorded in this workspace (EquivalenceKit, commit `015c4a8`,
  now removed): the same web-fetch, storage, sender and error APIs were already used by
  contracts that reached consensus on StudioNet. Used only as corroboration, not as the
  primary source.

## 1. Contract API ledger — VERIFIED

| Item | Exact verified usage | Source |
|---|---|---|
| File header | `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }` | official FetchGitHubProfile + boilerplate |
| Import | `from genlayer import *` (everything else under `gl`) | docs + boilerplate |
| Contract | exactly one `gl.Contract` subclass per file | docs |
| Constructor | `__init__(self)` required, not decorated | docs + prior StudioNet probe |
| View | `@gl.public.view` | docs |
| Write | `@gl.public.write` | docs |
| Sender | `gl.message.sender_address`; hex via `.as_hex` | transaction-context + boilerplate |
| Tx timestamp | `datetime.now(timezone.utc)` is pinned to the transaction datetime and is identical on every validator | transaction-context |
| Raw timestamp | `gl.message_raw['datetime']` (ISO 8601 string) | transaction-context |
| Storage map | `TreeMap[K, V]`, fully parameterized | storage docs + boilerplate |
| Storage record | `@allow_storage` + `@dataclass` | storage docs + boilerplate |
| Storage integer | sized `u256`; convert with `u256(int(value))` | boilerplate |
| Collection init | class-body fields zero-initialize; `__init__` may be empty (`pass`) | prior StudioNet deployment |
| Web fetch | `gl.nondet.web.get(url)` -> `Response`; fields `.status` (int), `.headers`, `.body` (bytes) | web-access docs + prior deployment |
| Equivalence | `gl.eq_principle.strict_eq(fn)`; `fn` takes no arguments; returns the agreed value | equivalence-principle + FetchGitHubProfile |
| Strict-eq rule | callers must return an already-normalized value; docs show `json.dumps(..., sort_keys=True)` | equivalence-principle |
| Errors | `raise gl.vm.UserError("CODE")`; stable string survives to the UI | error-handling docs + prior deployment |
| Direct tests | `direct_vm`, `direct_deploy`, `direct_alice`, `direct_bob`; `direct_vm.sender = ...`; `direct_vm.mock_web(pattern, {"status", "body"})`; `direct_vm.expect_revert("CODE")` | boilerplate tests + genlayer-test 0.29.2 |

Notes that decide the implementation:

- **Age is allowed.** The transaction timestamp is deterministic, so `created_at` can be
  compared against `datetime.now(timezone.utc)` without breaking consensus. No wall clock.
- **Web calls must be inside the equivalence function.** All `gl.nondet.*` calls live
  inside the function passed to `strict_eq`.
- **Normalize before comparing.** The compared value is only
  `{"ok": bool, "github": str, "tier": str}` or `{"ok": false, "reason": CODE}`. No counts,
  timestamps, headers, or raw bodies.
- **Return shape.** `strict_eq`'s documented examples return a **string** (the
  FetchGitHubProfile example stores the raw string; the equivalence page returns
  `json.dumps(json.loads(result), sort_keys=True)`). GitProof therefore returns a
  canonical JSON string and parses it after consensus. This is the documented shape, not a
  dict-serialization assumption.

## 2. GitHub REST API — VERIFIED live on 2026-10-25

### Gist

`GET https://api.github.com/gists/<id>` returned `200` with:

- `id` — string
- `public` — boolean (`true` for a public gist)
- `owner.login` — string
- `files` — object keyed by filename; each value contains
  `filename`, `content`, `truncated`, `raw_url`, `size`, `type`.
  For the small file tested, `content` was present (920 chars) and `truncated` was `false`.

Missing gist: `404`. Unauthenticated limit is 60 requests/hour per IP; exhausted quota is
`403` with a rate-limit body. Both are handled as fail-closed states below.

### User profile

`GET https://api.github.com/users/<login>` returned `200` with:

- `login` — string
- `public_repos` — integer
- `followers` — integer
- `created_at` — ISO 8601 UTC string, e.g. `2022-06-11T10:05:08Z`
- `type` — `"User"`

Missing user: `404`.

### Proof line

`gitproof:<wallet hex>`, compared case-insensitively against a **stripped whole line** in
any file's `content`. Substring matching is deliberately not used.

## 3. Tier check against the human's account

`https://api.github.com/users/habte-selassie27` on 2026-10-25:

- `public_repos` = 168, `followers` = 52, `created_at` = `2022-06-11T10:05:08Z`
- age = 1,597 days = 4 whole years
- score = `min(168, 50) + min(52, 100)//2 + min(4, 5)*5 = 50 + 26 + 20 = 96`
- tier = `VETERAN` (threshold 45), 51 points clear of the boundary.

The AGENTS.md formula and thresholds (15 / 45) are kept as written.

## 4. Frontend SDK — VERIFIED from the prior deployed app

These exact imports and calls shipped in the EquivalenceKit frontend and worked against
StudioNet with a real wallet:

```ts
const [sdkMod, chainMod, typeMod] = await Promise.all([
  import("genlayer-js"),
  import("genlayer-js/chains"),
  import("genlayer-js/types"),
]);
const client = sdkMod.createClient({ chain: chainMod.studionet });
client.readContract({ address, functionName, args });
client.writeContract({ address, functionName, args, value: 0n });
client.waitForTransactionReceipt({
  hash,
  status: typeMod.TransactionStatus.FINALIZED,
  interval: 4000,
  retries: 120,
});
client.connect("studionet");
```

- StudioNet chain object: `studionet` from `genlayer-js/chains`.
- Explorer: `https://explorer-studio.genlayer.com` (`/address/<addr>`, `/tx/<hash>`).
- RPC used by the CLI: `https://studio.genlayer.com/api`.
- Receipts arrive with both camelCase and snake_case spellings; the UI reads either.

VERIFIED on 2026-10-25: installed `genlayer-js 1.1.8`; the browser read path
(`get_record` / `get_wallet`) returned the live StudioNet record from the built app. The
write path uses the same SDK calls as the CLI-verified transaction below; a browser-wallet
write is the remaining human demo step.

## 5. Stable error codes (closed set)

`BAD_USERNAME`, `BAD_GIST_ID`, `ALREADY_CLAIMED`, `GIST_NOT_FOUND`, `GIST_NOT_PUBLIC`,
`GIST_WRONG_OWNER`, `GIST_MISSING_PROOF`, `PROFILE_NOT_FOUND`, `SOURCE_UNAVAILABLE`.

No other reason string is returned.

## 6. TODOs and their status

1. RESOLVED 2026-10-25: `strict_eq` returned the canonical JSON string after two live
   GitHub fetches on StudioNet. Transaction
   `0x417b112761c6d4d490161c399ded3430eba8a017ea36297c27fc9be162043061` reached
   `ACCEPTED` / `MAJORITY_AGREE`, and `get_record` returned the tier.
2. RESOLVED 2026-10-25: `datetime.fromisoformat(...)` worked in the GenVM runner on the
   same transaction; the account-age component contributed to the VETERAN result.
3. RESOLVED 2026-10-25: `genlayer-js 1.1.8`; browser reads work (see section 4). The
   browser-wallet write is still to be recorded in the demo.
4. OPEN, mock-only: secret-gist `public: false` path (the demo uses a public gist by
   design).
5. OPEN, mock-only: GitHub 403 rate-limit path (not forced live).
6. NOTE: `strict_eq` must not be used on raw web or LLM output; GitProof only compares
   the normalized string, which is the documented legitimate use.
