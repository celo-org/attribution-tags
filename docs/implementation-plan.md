# Celo Builder Codes — Implementation Plan

**Lena, DevRel Lead, Celo Core Co — 6 May 2026**

## Objective

Ship ERC-8021 attribution for Celo in time for May Proof of Ship. Lean: SDK + dbt model + distribution server. No on-chain registry, no claim UI, no payouts. Those land later.

## Deliverables & owners

| # | Deliverable | Owner | Due |
|---|---|---|---|
| 1 | `@celo-org/builder-codes` SDK + integration guide | Lena | Wed May 13 |
| 2 | Distribution server (form → code) | Lena | Wed May 13 |
| 3 | Dune dbt model + queryable attributed-tx table | Chidi | Fri May 8 |

Lena handoff to Chidi: test tx fixture + lookup-table read access by **Wed May 7**.

## The standard for keys

- **Format:** `celo_xxxxxxxx` (5-byte prefix + 8 lowercase alphanumeric chars).
- **Length:** 13 bytes, well under ERC-8021's 32-byte ceiling.
- **Generation:** server-side, cryptographically random; rejected on collision.
- **Uniqueness:** enforced at the distribution server. Off-chain only — no on-chain check.
- **Allowed chars in random part:** `[a-z0-9]` excluding visually ambiguous (`0`, `1`, `o`, `l`).

Codes are not human-readable on purpose: no squatting, no claim arbitration, easy to filter on-chain by the `celo_` prefix.

## Workstream 1 — SDK (Lena)

`@celo-org/builder-codes`, npm package, three exports:

```ts
toDataSuffix(code: string | string[]): Hex
fromDataSuffix(suffix: Hex): { codes: string[] } | null
verifyTx({ client, hash }): Promise<{ codes: string[] } | null>
```

All wrappers around `ox/erc8021`. Vector tests assert byte-for-byte match with Base's reference (`baseapp` → `0x07626173656170700080218021…`) so anything tagged on Celo is decodable by tools built for Base, and vice versa.

**Effort:** 1.5–2 days. Skeleton + tests Day 1; integration guide + verifier + npm publish Day 2.

## Workstream 2 — Dune dbt model (Chidi)

Incremental dbt model on Dune that reads `celo.transactions`, parses the ERC-8021 suffix from `input`, joins against the codes lookup table, and outputs `attributed_transactions`.

**Wire format reference (for the parser):**

Read backwards from the end of `tx.input`:

```
tx.input = [...call data...] || [code:N] || [length:1] || [schema:1] || [marker:16]
                                                                 0x00     0x80218021…×8
```

Parse logic (end-of-calldata first):
1. Last 16 bytes = marker `0x80218021802180218021802180218021` — required for the tx to be tagged.
2. Byte at `[end - 17]` = schema ID (`0x00` for v1).
3. Byte at `[end - 18]` = length `L` (1–32).
4. Bytes at `[end - 18 - L]` to `[end - 19]` = code, ASCII.

For multi-code suffixes (e.g. `proofofship,celo_b7k3p9da`), the code field contains the comma-delimited list as one ASCII string.

- Marker: constant `0x80218021802180218021802180218021` (16 bytes)
- Schema byte: `0x00` for v1
- Code: ASCII, no commas inside a single code (commas reserved as multi-code delimiter)

**Filter:** `WHERE input LIKE '%80218021802180218021802180218021'` catches every tagged tx.

**Output schema (proposed, open to Chidi's preferences):**

```
block_time, tx_hash, from, to, value,
builder_code, builder_name, tp_project_id,
contract_called, function_selector, success
```

**Effort:** 2 days (Chidi). Friday May 8 deadline.

## Workstream 3 — Distribution server (Lena)

Tiny Next.js app on Vercel (or Cloudflare Workers).

**Form fields:** Talent Protocol project ID, Telegram handle, email.

**Backend flow:**
1. Validate Talent Protocol project via TP API (confirm it exists; record builder identity).
2. Generate random code, retry on collision.
3. Store row in Airtable (or Vercel KV) with: `code, tp_project_id, telegram, email, created_at`.
4. Return code to user; show one-screen "your code is X, here's the SDK" success page.

**Storage choice:** Airtable. Easy for Chidi to import as a Dune-uploaded dataset, easy for Lena to manually inspect/edit, no DB to operate.

**Effort:** 1–2 days. Day 1 = working form + code generation + Airtable integration. Day 2 = TP validation + polish.

## Dependencies between workstreams

- **Lena → Chidi (by Wed May 7):**
  - Tagged Celo Sepolia tx hash for parser validation
  - Read access to the Airtable codes lookup
  - Confirmed wire-format spec (above) — ideally also a second tx with multi-code, e.g. `proofofship,celo_xxxx`, so he handles the comma path
- **Chidi → Lena (by Fri May 8):** queryable `attributed_transactions` table on Dune, so the integration guide can include "see your tagged txs here" link.

## Open questions

- **Talent Protocol API access.** Do we have a key, or do we need one? Their public Builder Score API may not cover project verification — confirm what endpoint we use.
- **npm scope.** Is `@celo` available, or do we publish under `@celo-org`? (Confirm before publishing.)
- **Multi-code support in v1.** Worth shipping `toDataSuffix(['proofofship', 'celo_xxxx'])` from day one so Proof of Ship co-attribution works without a follow-up release. Recommend yes — `ox` already supports it; near-zero extra work.
- **Should Talent Protocol integrate ERC-8021 attribution into Proof of Ship themselves?** If yes, we'd ask their team to use `proofofship` as a fixed platform code on every PoS-tagged action. Worth asking before May launch.

## Out of scope (deferred)

NFT registry, on-chain claim, payouts, leaderboard frontend, governance multisig, smart-wallet capability work. All previously sketched; revisit after May Proof of Ship lands.
