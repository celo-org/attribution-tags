# Celo Builder Codes

ERC-8021 builder-code attribution **on Celo**.

**Lena Hierzi, DevRel Lead, Celo Core Co — 8 May 2026**

Built for, in priority order: **MiniPay** apps, **Proof of Ship** cohort projects, and **Celo ecosystem** projects more broadly. Celo-only — ERC-8021 is the standard we conform to, nothing more.

## What this is

A way for any Celo app to put a small attribution suffix at the end of every transaction it sends, so the attribution pipeline can later say "this transaction came through Mondeto" or "this transaction came through MiniPay." The suffix is invisible to the contract being called (the EVM discards trailing bytes), so adding it never changes execution semantics — it just makes the transaction identifiable.

```
[...your normal calldata...] [code:N] [length:1] [schema:1] [marker:16]
                                                     0x00     0x80218021…×8
```

That's it. Stick the suffix on the end of `tx.input` and the tx is tagged.

This repo ships:

- An npm SDK that handles the encoding for you (`@gigahierz/builder-codes`, soon `@celo-org/builder-codes`)
- The wire-format reference and SQL filter for anyone parsing on-chain
- Two real verified tx fixtures on Celo Mainnet
- The MiniPay auto-derive design (no registration, no human in the loop)

## For app builders — tag your transactions

Install:

```bash
npm install @gigahierz/builder-codes@next viem
# or pnpm / yarn — same args
```

If you're a **MiniPay mini app**, the SDK derives a per-app code from your hostname automatically. No registration, no key, no form:

```ts
import { toDataSuffix, codeFromHostname } from '@gigahierz/builder-codes'

const tag = toDataSuffix(codeFromHostname(window.location.hostname))

await wallet.sendTransaction({ to, value, data: tag })
```

If you're using **wagmi**, pass `dataSuffix` to `useWriteContract` and wagmi handles the calldata concatenation:

```ts
const { writeContract } = useWriteContract()
writeContract({ address, abi, functionName, args, dataSuffix: tag })
```

If you've been issued a code (Proof of Ship or non-MiniPay path), call `toDataSuffix("celo_xxxxxxxx")` directly. Same shape.

**Don't add platform codes like `"minipay"` yourself.** That's MiniPay's claim to make at the wallet layer when they ship their integration. An app that puts `["minipay", code]` in its own suffix is asserting "this tx ran in MiniPay" even when it didn't, which pollutes attribution data. Each layer claims only what it can prove.

Full integration guide: [`docs/integration-guide.md`](docs/integration-guide.md). Covers SSR-safety (Next.js / Remix), multi-code rules, common gotchas, and the verifier API.

## For data engineers — parse on-chain attribution

You're looking for transactions whose `input` ends with the ERC-8021 marker. The SQL filter is one line:

```sql
WHERE input LIKE '%80218021802180218021802180218021'
```

Once filtered, decode the suffix by reading backwards from the end of `tx.input`:

| Position | Field | Notes |
|---|---|---|
| Last 16 bytes | Marker | Constant `0x80218021…×8`. Required to qualify as tagged. |
| `[end - 17]` | Schema ID | `0x00` for v1 |
| `[end - 18]` | Length `L` | Bytes 1–32, says how long the code field is |
| `[end - 18 - L]` to `[end - 19]` | Code field | ASCII string. If it contains a comma, it's multi-code: split on `,` |

Multi-code (e.g. `minipay,celo_b057492a`) is one ASCII string with commas; treat each comma-separated segment as a code. No commas inside an individual code (we reject them at the SDK layer).

### Test fixtures (verified live on Celo Mainnet)

Two real transactions you can plug into your parser to test it. Both have status: success, both produced by the SDK in this repo.

| Transaction | Decoded suffix | Tx hash | Why it's useful |
|---|---|---|---|
| `Mondeto.updateProfile(uint24,string,string)` | `{ codes: ["celo_49960de5"], schemaId: 0 }` | [`0xc47b7f…2bf4d5`](https://celoscan.io/tx/0xc47b7f8db12b33482b5de0129fc1da66f7b6cb45e56d1d16954ba7e0532bf4d5) | Smallest realistic shape — color + two strings + suffix. Good for confirming the basic case. |
| `Mondeto.buyPixels(uint256[])` | `{ codes: ["celo_49960de5"], schemaId: 0 }` | [`0xbf65cb…3cba96`](https://celoscan.io/tx/0xbf65cbfbc2635e80087654688a8a3c5d4da763502a548e6cdf55d9df833cba96) | Realistic dynamic-array calldata with the suffix at the end. Good for confirming the parser handles tail-of-input correctly. |

`celo_49960de5` is what `codeFromHostname("localhost")` produces — both txs were sent from a local dev environment. In production they'd carry the per-app code derived from the prod hostname.

### Sanity-check the algorithm

```bash
printf "%s" "mondeto.app" | shasum -a 256 | cut -c1-8
# → b057492a
```

The code for that hostname is `celo_b057492a`. Same hostname → same code, anywhere it runs. See the pinned vectors below for more.

### Pinned hostname → code vectors

Independently verified against `shasum -a 256`. If your reimplementation doesn't produce these, the algorithm has drifted.

| Hostname | Code |
|---|---|
| `mondeto.app` | `celo_b057492a` |
| `celo.org` | `celo_8549372f` |
| `minipay.io` | `celo_51e51934` |
| `app.mondeto.app` | `celo_1a8ba29d` |
| `mondeto.vercel.app` | `celo_04168799` |

Algorithm: lowercase the hostname → strip a leading `www.` → SHA-256 of the bytes → first 4 bytes hex → prefix with `celo_`. Subdomains stay distinct (so `mondeto.app` ≠ `app.mondeto.app`). Preview/staging hostnames produce their own codes by design.

The full design rationale, including why we picked plain SHA-256 over HMAC and why integrity moves to the attribution layer (not the encoding), is in [`docs/minipay-attribution.md`](docs/minipay-attribution.md).

## Repo layout

```
.
├── README.md                            (this file)
├── CLAUDE.md                            (project context, conventions)
├── docs/
│   ├── implementation-plan.md           (the original plan + May 7 update)
│   ├── integration-guide.md             (the 1-pager for app builders)
│   ├── minipay-attribution.md           (the auto-derive design)
│   └── integration-reports/
│       └── mondeto.md                   (first real consumer integration)
├── sdk/                                 (the npm package — @gigahierz/builder-codes)
│   ├── src/index.ts
│   ├── tests/
│   ├── package.json
│   └── README.md
└── .claude/commands/                    (Claude Code slash commands)
    ├── verify-tx.md
    ├── decode.md
    ├── test-fixture.md
    └── check-airtable.md
```

## Status

This is a **pre-release**. The SDK is currently published as `@gigahierz/builder-codes@0.1.0-rc.1` on the `next` tag while we wait for `@celo-org` publish rights. Once those land, the package will be republished as `@celo-org/builder-codes@0.1.0` (a fresh package under the org scope), and `@gigahierz/builder-codes` will be deprecated with a redirect message.

The wire format and the derivation algorithm are stable; only the npm name changes.

## Contact

Lena Hierzi (DevRel Lead, Celo Core Co) — file an issue or reach out on Telegram.

## License

MIT.
