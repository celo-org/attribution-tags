# Celo Attribution Tags — for indexers and parsers

You're writing a parser, indexer, or Dune model that needs to identify Celo transactions tagged with ERC-8021 attribution and pull the code out. This is the guide for that.

If you're shipping an app and want to *produce* tagged transactions instead, see [`BUILDERS.md`](BUILDERS.md).

## What you're parsing

Tagged Celo transactions follow [ERC-8021](https://oxlib.sh/ercs/erc8021/Attribution). App-emitted tags use **Schema 0**; facilitator-emitted tags (e.g. x402 settlement services) use **Schema 2**. Every tagged tx has an attribution suffix appended to the end of `tx.input`:

```
Schema 0 (apps):
[...your normal calldata...] [code:N] [length:1] [schema:1] [marker:16]
                                                    0x00     0x80218021…×8

Schema 2 (facilitators):
[...your normal calldata...] [CBOR map {a,w,s}] [length:2] [schema:1] [marker:16]
                                                              0x02     0x80218021…×8
```

The suffix is **trailing metadata**: the EVM ignored it when executing the tx, but it's preserved verbatim in the calldata you read back from the chain. To parse a tagged tx, you read the tail of `tx.input` and decode it — the suffix is at least 19 bytes (1-byte code + length + schema + 16-byte marker) and grows with the code field.

## SQL filter

This is the filter that picks out every tagged Celo tx. On DuneSQL (Trino), `transactions.data` is `varbinary`, so compare bytes — string `LIKE` won't run against it:

```sql
-- fast: compare the 16-byte tail directly
WHERE length(data) >= 19
  AND bytearray_substring(data, length(data) - 15, 16) = 0x80218021802180218021802180218021
```

or, less efficient but easy to eyeball:

```sql
WHERE to_hex(data) LIKE '%80218021802180218021802180218021'
```

If your store keeps calldata as a hex *string* (many non-Dune indexers do), the plain `input LIKE '%80218021802180218021802180218021'` form works as-is.

The marker is `0x80218021` repeated 8 times (16 bytes total, 32 hex chars). Anywhere it appears at the very end of the calldata qualifies. False-positive rate is functionally zero — random calldata ending in this exact 16-byte sequence is astronomically unlikely.

**Except for wrapper calls.** Leave `handleOps` calls to an EntryPoint and `execute` calls to an Orchestrator out of this tail rule, and read them as described in [ERC-4337 bundles](#erc-4337-bundles-smart-account-wallets) and [Relayed intents](#relayed-intents-porto-style-eip-7702-wallets). Their last bytes are the wrapper's own encoding — the last operation's signature, or the intent's payment signature — which one participant can make end with the marker whether or not anything executed. `verifyTx` never reads the end of such a call.

## Decoding logic

Read backwards from the end of `tx.input`:

| Read position | Field | Notes |
|---|---|---|
| Last 16 bytes | **Marker** | Must equal `0x80218021802180218021802180218021`. If not, tx is not tagged — discard. |
| `[end - 17]` (1 byte) | **Schema ID** | `0x00` (flat code list) or `0x02` (role-based CBOR). Other values reserved; treat the tx as untagged (the SDK's `fromDataSuffix` returns `null` for them). |
| Schema 0: `[end - 18]` (1 byte) | **Length `L`** | 1–255. Says how long the code field is. Note this bounds the whole comma-joined *field* — an individual code is at most 32 bytes, but a multi-code field can legally exceed 32. |
| Schema 0: `[end - 18 - L]` … `[end - 19]` (L bytes) | **Code field** | ASCII string. Multi-code is comma-delimited inside this string. |
| Schema 2: `[end - 19 … end - 18]` (2 bytes) | **Length `L`** | Big-endian length of the CBOR payload. |
| Schema 2: `[end - 19 - L]` … `[end - 20]` (L bytes) | **CBOR map** | Keys: `a` = app code (string), `w` = wallet/facilitator code (string), `s` = service codes (array of strings). All optional. |

Schema 0 total suffix length = `L + 18` bytes; Schema 2 = `L + 19` bytes (2-byte length field).

For Schema 0, the code field decoded as ASCII is either a single code (`celo_b057492a5aa5`) or a comma-delimited list (`minipay,celo_b057492a5aa5`). Split on `,` to get the list; we reject commas inside individual codes at the SDK encode layer, so the split is unambiguous.

For Schema 2, decode the CBOR map with any CBOR library and read the `a`/`w`/`s` keys. You'll see this shape on transactions submitted by payment facilitators (x402 settlements): `a` credits the app whose endpoint was paid, `w` identifies the facilitator, `s` optionally identifies the paying client.

## Pseudocode

```python
MARKER = bytes.fromhex("80218021802180218021802180218021")  # 16 bytes

def parse_suffix(input_bytes):
    if len(input_bytes) < 19:
        return None
    if input_bytes[-16:] != MARKER:
        return None
    schema = input_bytes[-17]
    if schema == 0:
        code_len = input_bytes[-18]
        if code_len == 0:
            return None
        if len(input_bytes) < 18 + code_len:
            return None  # claimed code field longer than the calldata — corrupt
        code_field = input_bytes[-18 - code_len : -18].decode("ascii")
        codes = code_field.split(",")
        return {"codes": codes, "schema_id": schema}
    if schema == 2:
        cbor_len = int.from_bytes(input_bytes[-19:-17], "big")
        if cbor_len == 0 or len(input_bytes) < 19 + cbor_len:
            return None
        tag = cbor2.loads(input_bytes[-19 - cbor_len : -19])
        # keys: a = app code, w = wallet/facilitator code, s = [service codes]
        codes = [c for c in [tag.get("a"), tag.get("w")] if c] + list(tag.get("s") or [])
        if not codes:
            return None
        return {"codes": codes, "schema_id": schema,
                "app": tag.get("a"), "wallet": tag.get("w"), "service": tag.get("s")}
    return None  # reserved schema — treat as untagged
```

For a TS-side equivalent, you can use this repo's SDK directly:

```ts
import { fromDataSuffix } from '@celo/attribution-tags'

fromDataSuffix(rawCalldata)
// → { codes: ["celo_xxxxxxxx"], schemaId: 0 } or null
```

`fromDataSuffix` accepts full calldata, not just the bare suffix — it parses from the end. It returns `null` for anything that isn't a clean Schema 0 or Schema 2 tag: no marker, a Schema 1 (custom-registry) tag, or a tag carrying no codes. Schema 2 results additionally carry `app` / `wallet` / `service` role fields.

## Example txs (verified live on Celo Mainnet)

Two real transactions you can plug into your parser to test it. Both have status: success. Both produced by the SDK in this repo, on the corrected (single-code) pattern.

| Function | Decoded suffix | Tx hash | Why it's useful |
|---|---|---|---|
| `Mondeto.updateProfile(uint24,string,string)` | `{ codes: ["celo_ce264747447f"], schemaId: 0 }` | [`0xfe554a…cef2c74b881`](https://celoscan.io/tx/0xfe554ab86bf3fcd29b56d148f906ac94f05f5e1d415912a7bf371cef2c74b881) | Smallest realistic shape — color + two strings + suffix. Confirms the basic case. |
| `Mondeto.buyPixels(uint256[])` | `{ codes: ["celo_ce264747447f"], schemaId: 0 }` | [`0xba6c36…792fb162ea`](https://celoscan.io/tx/0xba6c3607c1fbf8ce17c8c18bacb102678e42b3f212de677921bb39792fb162ea) | Realistic dynamic-array calldata with the suffix at the end. Confirms tail-of-input handling. |

`celo_ce264747447f` is `codeFromHostname("mondeto-web.vercel.app")` — both txs were sent from the production Mondeto frontend, decoded cleanly against `@celo/attribution-tags@0.2.0`.

**Parser compatibility note:** early Mainnet example txs from the pre-0.2.0 dev period carry **8-char codes** (e.g. `celo_49960de5` from `codeFromHostname("localhost")` under the old derivation). Both are valid ERC-8021 suffixes — the parser doesn't care about the length of the code field. Indexers should accept any code *field* length the length byte can express (1–255 bytes; individual codes are at most 32, but a comma-joined multi-code field can exceed 32), not just the current shapes.

## ERC-4337 bundles (smart-account wallets)

The tail-of-input assumption misses every transaction sent from a smart-contract wallet. The bundler calls the EntryPoint's `handleOps`, and the app's tagged calldata is inside each UserOperation's `callData` (usually as the `bytes` argument of the account's `execute(address,uint256,bytes)`, zero-padded to 32 bytes), so the app's tag is in the middle of the outer input, not at its end. The end of the input is the last operation's `signature`, which the EntryPoint does not check, so it can end with the marker too: never read it as a tag.

A real example: [`0x21a0cb…5924ea16`](https://celoscan.io/tx/0x21a0cb12d27e08a3b403edbfb6fa46b5392612ecdb91cabf0e87c40e5924ea16) — `to` is EntryPoint v0.6, the outer `fromDataSuffix` is `null`, and the single UserOperation carries `celo_5d5a7df8d3aa`.

What to do:

- Detect by selector **and** address: v0.6 `handleOps(UserOperation[],address)` = `0x1fad948c`, v0.7 and later `handleOps(PackedUserOperation[],address)` = `0x765e827f`, sent to a known EntryPoint — v0.6 `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, v0.8 `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`, v0.9 `0x433709009B8330FDa32311DF1C2AFA402eD8D009` (all deployed on Celo Mainnet and Celo Sepolia). The selector alone is not enough: anyone can send the same calldata to an EOA or to a contract of their own, and on Celo Mainnet a `handleOps` call to a precompile has succeeded.
- ABI-decode the bundle, then for each op find the marker inside `callData` and decode the slice ending with it (the suffix is followed by ABI padding, so parse-from-end fails on the raw `callData`).
- **Credit only an executed operation.** The calldata is a claim: it can name any account as `sender`, with a junk signature. The EntryPoint validates each operation (a validation failure reverts the whole bundle), runs it, and emits `UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)` (topic0 `0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f`). An operation whose calls reverted gets `success = false` and the transaction still succeeds, so the receipt status alone is not enough.
- **Pair each operation with its own event, strictly.** In a transaction that succeeded, take the EntryPoint's own `UserOperationEvent` logs in order: there must be exactly one per operation, and the i-th must carry the i-th operation's `sender` and `nonce`. Credit the operation only if its event has `success = true`. If the counts differ or any pair does not match, the receipt does not describe the calldata: credit nothing in that transaction. (Across all 34,780 successful `handleOps` transactions to these EntryPoints on Celo Mainnet in the 90 days to 2026-11-26, the counts matched every time.)
- Credit the op's `sender` — the smart account — not the outer `from`, which is the bundler. Emit one row per operation, not per transaction.

The SDK does all of this in `verifyUserOps({ client, hash })`, which returns `[{ sender, attribution }]` per operation with a null attribution for any operation that did not execute, and in `verifyTx`, which falls back to the first tagged, executed operation with `sender` set. Both take an optional `entryPoints` list of extra deployments to accept. `fromEntryPointCalldata(input)` is the offline decode step only: its output is unverified.

On Dune, select the candidates from the transactions table and join the event from the logs table, so that only executed operations remain:

```sql
SELECT t.hash, bytearray_substring(l.topic2, 13, 20) AS sender, bytearray_to_uint256(bytearray_substring(l.data, 1, 32)) AS nonce
FROM celo.transactions t
JOIN celo.logs l
  ON l.tx_hash = t.hash
 AND l.block_number = t.block_number
 AND l.contract_address = t."to"
 AND l.topic0 = 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f
WHERE t."to" IN (
    0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789, -- v0.6
    0x0000000071727De22E5E9d8BAf0edAc6f37da032, -- v0.7
    0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108, -- v0.8
    0x433709009B8330FDa32311DF1C2AFA402eD8D009  -- v0.9
  )
  AND t.success
  AND bytearray_substring(t.data, 1, 4) IN (0x1fad948c, 0x765e827f)
  AND varbinary_position(t.data, 0x80218021802180218021802180218021) > 0
  -- success = true
  AND bytearray_substring(l.data, 64, 1) = 0x01
```

Each row is an executed operation in a bundle that carries a marker somewhere; it is a candidate, not a credit. Decode the bundle and pair its operations with the EntryPoint's events as described above before crediting: in a bundle of several operations, the tagged one may not be the one that executed.

## Relayed intents (Porto-style EIP-7702 wallets)

The tail-of-input assumption also misses transactions from wallets that sign an intent and let a relay submit it (EIP-7702 accounts on the Porto / Ithaca stack, for example Altana wallets). The relay's EOA calls the Orchestrator's `execute(bytes encodedIntent)`, and the app's tagged calldata is the `data` of a call inside the intent's `executionData`, followed by the intent's other fields, so the app's tag is in the middle of the outer input, not at its end. The end of the input is the intent's `paymentSignature`, which the relay fills in and the wallet does not sign, so a marker there says nothing about the wallet: never read it as a tag.

A real example: [`0x5131fd…4d410aea`](https://celoscan.io/tx/0x5131fd5b5d14012e6a97a86a6cb4608264a52eebc1f67bf1e47a7a814d410aea) — `to` is the Orchestrator, the outer `from` is a relay, the outer `fromDataSuffix` is `null`, and the calls inside the intent carry `celo_d6a0b77183c8`.

What to do:

- Detect by selector **and** address: `execute(bytes)` = `0x09c5eabe`, or the batch form `execute(bytes[])` = `0x44471415`, sent to a known Orchestrator deployment — `0xAF140d0416A994Aebb3fA6212B16CE6700f09751` on Celo Mainnet, `0xcb5CEf3C54aa90e9A7ad602A258D3d360cC862B9` on Celo Sepolia. The selector alone is not enough: anyone can send the same calldata to an EOA or to a contract of their own.
- ABI-decode the argument as the intent tuple (first three fields: `address eoa`, `bytes executionData`, `uint256 nonce`), then decode `executionData` as `(address to, uint256 value, bytes data)[]` and look for the marker in each call's `data`. Read only those calls, never the intent's later fields (payment amounts, the relay's signatures).
- **Credit only an executed intent.** The calldata is a claim: it can name any wallet as `eoa`, with a junk signature. The Orchestrator checks the wallet's EIP-712 signature, runs the calls, and emits `IntentExecuted(address indexed eoa, uint256 indexed nonce, bool incremented, bytes4 err)` (topic0 `0x23a3c1343409f01965611c9c4c8b99e36d7b09ca22516507d5486ce0584379b8`). Require, in a transaction that succeeded, a log from the Orchestrator itself with the same `eoa` and `nonce`, `incremented = true` and `err = 0x00000000`. A rejected intent gets a non-zero `err` and the transaction still succeeds, so the receipt status alone is not enough either.
- **Pair each intent with its own log, in order.** The Orchestrator runs the intents in the order given and emits exactly one `IntentExecuted` per intent, failed or not. Walk the intents and the Orchestrator's `IntentExecuted` logs together: for each intent take the next log with its `eoa` and `nonce`, judge the intent by that log alone, and never reuse a log. Matching by `eoa` and `nonce` without order is not enough: an `execute(bytes[])` batch can hold a forged intent and a genuine one with the same pair, and the forged one (whose own log has `err != 0`) would borrow the genuine one's success. Do not require the counts to be equal either: a pre-call emits its own `IntentExecuted` before its intent's, so a new account's first transaction is one intent and two logs ([example](https://celo-sepolia.blockscout.com/tx/0x81c741ef7d80f6cfab83d9c5e085451ce453c10834aefa4086d747ba3c4aa8cf)). Skip those. If an intent has no log of its own, credit nothing in that transaction.
- Credit the intent's `eoa` — the wallet that signed — not the outer `from`, which is the relay. Emit one row per intent, not per transaction.

The SDK does all of this in `verifyIntents({ client, hash })`, which returns `[{ sender, attribution }]` per intent with a null attribution for any intent that did not execute, and in `verifyTx`, which falls back to the first tagged, executed intent with `sender` set. `fromOrchestratorCalldata(input)` is the offline decode step only: its output is unverified.

`verifyTx`, `verifyUserOps` and `verifyIntents` return `null` on RPC errors as well as for untagged transactions, and some public Celo RPCs drop calls under load. Retry, or use a dedicated RPC, before treating a `null` as untagged.

On Dune, select the candidates from the transactions table and join the event from the logs table, so that only executed intents remain:

```sql
SELECT t.hash, bytearray_substring(l.topic1, 13, 20) AS eoa, bytearray_to_uint256(l.topic2) AS nonce
FROM celo.transactions t
JOIN celo.logs l
  ON l.tx_hash = t.hash
 AND l.block_number = t.block_number
 AND l.contract_address = t."to"
 AND l.topic0 = 0x23a3c1343409f01965611c9c4c8b99e36d7b09ca22516507d5486ce0584379b8
WHERE t."to" = 0xAF140d0416A994Aebb3fA6212B16CE6700f09751
  AND t.success
  AND bytearray_substring(t.data, 1, 4) IN (0x09c5eabe, 0x44471415)
  AND varbinary_position(t.data, 0x80218021802180218021802180218021) > 0
  -- incremented = true, err = 0
  AND bytearray_substring(l.data, 32, 1) = 0x01
  AND bytearray_substring(l.data, 33, 4) = 0x00000000
```

Each row is a successful `IntentExecuted` in a transaction that carries a marker somewhere; it is a candidate, not a credit. Decode the transaction's intents and pair them with all of the Orchestrator's `IntentExecuted` logs in order, as described above, before crediting: the marker can sit in a field outside the calls, a batch can hold intents that did not execute, and a pre-call's log is not an intent's.

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

For the test phase, most codes are hostname-derived for MiniPay apps. To map a `celo_xxxxxxxx` back to an app, take MiniPay's approved-app list (the existing developer-intake hostnames), compute `codeFromHostname(host)` for each, and that's your lookup table. Issued and custom codes (apps can bring their own) resolve through the codes lookup table instead — same join, different source.

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
builder_code                -- the decoded code, e.g. "celo_b057492a5aa5"
builder_name                -- joined from the codes lookup table (nullable)
schema_id                   -- 0 (app-emitted) or 2 (facilitator-emitted)
multi_code_full             -- the raw code field, e.g. "minipay,celo_b057492a5aa5"
app_code                    -- Schema 2 only: the `a` role (nullable)
wallet_code                 -- Schema 2 only: the `w` role (nullable)
service_codes               -- Schema 2 only: the `s` role, array (nullable)
```

> The canonical term is now **attribution code** (`celo_xxxxxxxx`). The column
> names above (`builder_code`, `builder_name`) are kept as-is to avoid breaking
> the existing Dune/dbt model; rename them to `attribution_code` /
> `attribution_name` only in coordination with the dbt-model owner. The on-chain
> decoded value is unchanged.

## Roadmap — what changes when MiniPay tags at the wallet layer

App-level SDKs in this repo emit only the per-app code (`celo_xxxxxxxx`). Platform codes are added by the **platform itself**, not by apps. The roadmap item that simplifies your work: MiniPay's wallet will eventually prepend `minipay,` to every tx it signs, **before the app's own suffix is even applied**.

When that ships, the on-chain shape for any MiniPay tx becomes:

```
[code:N=25][len:0x19][schema:0x00][marker]
where the code field is "minipay,celo_xxxxxxxxxxxx"
(7 + 1 + 17 = 25 bytes for a hostname-derived celo_ + 12-hex-char code)
```

That makes filtering for MiniPay txs trivial — split the code field on `,`, look for `minipay` in the resulting list. No hostname lookup needed at all to identify *which platform* a tx came through. You'd still want the hostname → code lookup if you want to identify *which specific MiniPay app* sent the tx, but the platform-attribution question becomes a one-line filter.

For the testing phase, you won't see `minipay` on-chain yet — every tx will be the single-code shape. Just decode and group by code.

Your parser should split on `,` regardless of which shape arrives. Each comma-separated segment is a separate attribution claim.

## SDK utilities you can reuse

Even if you're parsing in SQL, these can be useful for spot-checks and validation:

- [`fromDataSuffix(input)`](sdk/src/index.ts) — decode any calldata to `{ codes, schemaId } | null`
- [`verifyTx({ client, hash })`](sdk/src/index.ts) — fetch a tx and decode in one call (falls back to ERC-4337 bundle and relayed-intent decoding)
- [`verifyUserOps({ client, hash })`](sdk/src/index.ts) / [`fromEntryPointCalldata(data)`](sdk/src/index.ts) — decode every UserOperation in a `handleOps` bundle, with its `sender` (`verifyUserOps` credits only executed operations; the offline decoder is unverified)
- [`verifyIntents({ client, hash })`](sdk/src/index.ts) / [`fromOrchestratorCalldata(data)`](sdk/src/index.ts) — the intents of an `Orchestrator.execute` call with the account to credit; `verifyIntents` credits only executed intents, `fromOrchestratorCalldata` is the unverified offline decode
- [`codeFromHostname(hostname)`](sdk/src/index.ts) — produce the expected code for a hostname
- [`codeFromRepo("owner/repo")`](sdk/src/index.ts) — produce the code the Celo Builders platform assigns for a GitHub repository

Install: `npm install @celo/attribution-tags viem`

## Reference

- Full SDK source: [`sdk/src/index.ts`](sdk/src/index.ts)
- Wire-format vector tests: [`sdk/tests/vectors.test.ts`](sdk/tests/vectors.test.ts) — byte-exact assertions against `ox/erc8021`
- Hostname vector tests: [`sdk/tests/hostname.test.ts`](sdk/tests/hostname.test.ts)
- ERC-8021 spec: https://oxlib.sh/ercs/erc8021/Attribution

## Questions

File an issue or reach out to Lena Hierzi on Telegram / Discord.
