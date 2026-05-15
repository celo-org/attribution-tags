# Celo Builder Codes — for indexers and parsers

**Lena Hierzi, DevRel Lead, Celo Core Co — 8 May 2026**

You're writing a parser, indexer, or Dune model that needs to identify Celo transactions tagged with builder-code attribution and pull the code out. This is the guide for that.

If you're shipping an app and want to *produce* tagged transactions instead, see [`BUILDERS.md`](BUILDERS.md).

## What you're parsing

Tagged Celo transactions follow [ERC-8021](https://oxlib.sh/ercs/erc8021/Attribution) Schema 0. Every tagged tx has an attribution suffix appended to the end of `tx.input`:

```
[...your normal calldata...] [code:N] [length:1] [schema:1] [marker:16]
                                                    0x00     0x80218021…×8
```

The suffix is **trailing metadata**: the EVM ignored it when executing the tx, but it's preserved verbatim in the calldata you read back from the chain. To parse a tagged tx, you read the last 35+ bytes of `tx.input` and decode them.

## SQL filter

This is the one-line filter that picks out every tagged Celo tx:

```sql
WHERE input LIKE '%80218021802180218021802180218021'
```

The marker is `0x80218021` repeated 8 times (16 bytes total, 32 hex chars). Anywhere it appears at the very end of `input` qualifies. False-positive rate is functionally zero — random calldata ending in this exact 16-byte sequence is astronomically unlikely.

## Decoding logic

Read backwards from the end of `tx.input`:

| Read position | Field | Notes |
|---|---|---|
| Last 16 bytes | **Marker** | Must equal `0x80218021802180218021802180218021`. If not, tx is not tagged — discard. |
| `[end - 17]` (1 byte) | **Schema ID** | `0x00` for v1. Other values reserved; treat as unknown for now. |
| `[end - 18]` (1 byte) | **Length `L`** | Bytes 1–32. Says how long the code field is. |
| `[end - 18 - L]` … `[end - 19]` (L bytes) | **Code field** | ASCII string. Multi-code is comma-delimited inside this string. |

So total suffix length = `L + 18` bytes (= `L + 1 [length] + 1 [schema] + 16 [marker]`).

The code field, decoded as ASCII, is either a single code (`celo_b057492a`) or a comma-delimited list (`minipay,celo_b057492a`). Split on `,` to get the list; we reject commas inside individual codes at the SDK encode layer, so the split is unambiguous.

## Pseudocode

```python
MARKER = bytes.fromhex("80218021802180218021802180218021")  # 16 bytes

def parse_suffix(input_bytes):
    if len(input_bytes) < 19:
        return None
    if input_bytes[-16:] != MARKER:
        return None
    schema = input_bytes[-17]
    code_len = input_bytes[-18]
    if code_len == 0 or code_len > 32:
        return None
    code_field = input_bytes[-18 - code_len : -18].decode("ascii")
    codes = code_field.split(",")
    return {"codes": codes, "schema_id": schema}
```

For a TS-side equivalent, you can use this repo's SDK directly:

```ts
import { fromDataSuffix } from '@celo/builder-codes'

fromDataSuffix(rawCalldata)
// → { codes: ["celo_xxxxxxxx"], schemaId: 0 } or null
```

## Example txs (verified live on Celo Mainnet)

Two real transactions you can plug into your parser to test it. Both have status: success. Both produced by the SDK in this repo, on the corrected (single-code) pattern.

| Function | Decoded suffix | Tx hash | Why it's useful |
|---|---|---|---|
| `Mondeto.updateProfile(uint24,string,string)` | `{ codes: ["celo_ce264747447f"], schemaId: 0 }` | [`0xfe554a…cef2c74b881`](https://celoscan.io/tx/0xfe554ab86bf3fcd29b56d148f906ac94f05f5e1d415912a7bf371cef2c74b881) | Smallest realistic shape — color + two strings + suffix. Confirms the basic case. |
| `Mondeto.buyPixels(uint256[])` | `{ codes: ["celo_ce264747447f"], schemaId: 0 }` | [`0xba6c36…792fb162ea`](https://celoscan.io/tx/0xba6c3607c1fbf8ce17c8c18bacb102678e42b3f212de677921bb39792fb162ea) | Realistic dynamic-array calldata with the suffix at the end. Confirms tail-of-input handling. |

`celo_ce264747447f` is `codeFromHostname("mondeto-web.vercel.app")` — both txs were sent from the production Mondeto frontend, decoded cleanly against `@celo/builder-codes@0.2.0`.

**Parser compatibility note:** early Mainnet example txs from the pre-0.2.0 dev period carry **8-char codes** (e.g. `celo_49960de5` from `codeFromHostname("localhost")` under the old derivation). Both are valid ERC-8021 suffixes — the parser doesn't care about the length of the code field — but indexers should accept any code length from 1–32 bytes, not just the current 12-char shape.

## The hostname-derivation algorithm

For MiniPay-style auto-derived codes, each app's code is derived deterministically from its hostname:

1. Take the hostname (`location.hostname` in browser; whatever your indexer needs to associate)
2. Lowercase it
3. Strip a leading `www.` (so `www.mondeto.app` and `mondeto.app` map to the same code)
4. SHA-256 the bytes
5. Take the first 6 bytes (12 hex chars)
6. Prefix with `celo_`

Subdomains stay distinct — `mondeto.app` ≠ `app.mondeto.app`. Preview/staging hostnames produce their own codes by design.

### Pinned hostname → code vectors

Independently verified against `shasum -a 256`. If your reimplementation doesn't produce these values, the algorithm has drifted.

| Hostname | Code |
|---|---|
| `mondeto.app` | `celo_b057492a5aa5` |
| `celo.org` | `celo_8549372f8229` |
| `minipay.io` | `celo_51e519342b9a` |
| `app.mondeto.app` | `celo_1a8ba29dac7a` |
| `mondeto.vercel.app` | `celo_04168799c492` |

Sanity check from any shell:

```bash
printf "%s" "mondeto.app" | shasum -a 256 | cut -c1-12
# → b057492a5aa5
```

The design choice (plain SHA-256 over HMAC) is deliberate: once a tagged tx is on chain, the code is public, so a secret-key HMAC buys nothing against spoofing — attribution integrity lives at the indexer layer (only credit codes whose hostnames appear on the approved-app list), not in the encoding.

## Resolving codes to apps (for now: a single hostname lookup)

For the test phase, codes are produced by a single path: hostname-derived for MiniPay apps. To map a `celo_xxxxxxxx` back to an app, take MiniPay's approved-app list (the existing developer-intake hostnames), compute `codeFromHostname(host)` for each, and that's your lookup table.

You don't need anything fancier than that to ship the first dashboard.

## Suggested output schema

For a Dune-style materialized table, this is roughly the shape that's been useful so far. Adjust to taste:

```
block_time
tx_hash
from_address
to_address
value
contract_called             -- the contract `tx.to`
function_selector           -- first 4 bytes of the original calldata (before the suffix)
success                     -- from the receipt
builder_code                -- the decoded code, e.g. "celo_b057492a"
builder_name                -- joined from the codes lookup table (nullable)
schema_id                   -- 0 for v1
multi_code_full             -- the raw code field, e.g. "minipay,celo_b057492a"
```

## Roadmap — what changes when MiniPay tags at the wallet layer

App-level SDKs in this repo emit only the per-app code (`celo_xxxxxxxx`). Platform codes are added by the **platform itself**, not by apps. The roadmap item that simplifies your work: MiniPay's wallet will eventually prepend `minipay,` to every tx it signs, **before the app's own suffix is even applied**.

When that ships, the on-chain shape for any MiniPay tx becomes:

```
[code:N=21][len:0x15][schema:0x00][marker]
where the code field is "minipay,celo_xxxxxxxx"
```

That makes filtering for MiniPay txs trivial — split the code field on `,`, look for `minipay` in the resulting list. No hostname lookup needed at all to identify *which platform* a tx came through. You'd still want the hostname → code lookup if you want to identify *which specific MiniPay app* sent the tx, but the platform-attribution question becomes a one-line filter.

For the testing phase, you won't see `minipay` on-chain yet — every tx will be the single-code shape. Just decode and group by code.

Your parser should split on `,` regardless of which shape arrives. Each comma-separated segment is a separate attribution claim.

## SDK utilities you can reuse

Even if you're parsing in SQL, these can be useful for spot-checks and validation:

- [`fromDataSuffix(input)`](sdk/src/index.ts) — decode any calldata to `{ codes, schemaId } | null`
- [`verifyTx({ client, hash })`](sdk/src/index.ts) — fetch a tx and decode in one call
- [`codeFromHostname(hostname)`](sdk/src/index.ts) — produce the expected code for a hostname

Install: `npm install @celo/builder-codes viem`

## Reference

- Full SDK source: [`sdk/src/index.ts`](sdk/src/index.ts)
- Wire-format vector tests: [`sdk/tests/vectors.test.ts`](sdk/tests/vectors.test.ts) — byte-exact assertions against `ox/erc8021`
- Hostname vector tests: [`sdk/tests/hostname.test.ts`](sdk/tests/hostname.test.ts)
- ERC-8021 spec: https://oxlib.sh/ercs/erc8021/Attribution

## Questions

File an issue or reach out to Lena Hierzi on Telegram / Discord.
