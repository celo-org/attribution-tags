# MiniPay Wallet Integration — Builder-Code Attribution (ERC-8021)

**Lena Hierzi, DevRel Lead, Celo Core Co — 13 May 2026**
**Status:** Recommendation for the MiniPay wallet team

## Why this doc exists

App-level attribution (covered in [`minipay-integration-spec.md`](minipay-integration-spec.md)) lets each MiniPay mini app self-attribute its transactions via the SDK. This doc is the **wallet-level** complement: what the MiniPay wallet itself can do to participate in ERC-8021 attribution, so that every tx flowing through the MiniPay wallet carries a `minipay` claim on top of whatever the app added.

This is exactly the pattern Base ships in its wallet — see [Base's wallet-developer guide](https://docs.base.org/apps/builder-codes/wallet-developers) for the reference. This doc adapts it to MiniPay's context.

The work is roughly **one hour of MiniPay engineering**. The payoff is:

- Every MiniPay-routed tx is filterable on Dune with a single `WHERE codes LIKE '%minipay%'`.
- The platform-attribution question is decided on-chain, not via a hostname lookup.
- Spoofing the platform claim requires faking *both* the app suffix and the wallet suffix, not just one.

## What MiniPay needs to do

Three steps. Roughly mirrors the Base wallet spec — same ERC-8021 standard, same wire shape — adapted for MiniPay's stack.

### 1. Accept a `dataSuffix` capability from the app

When an app calls `wallet_sendCalls` (ERC-5792) or — for legacy flows — passes a `dataSuffix` to wagmi's `useWriteContract`, the wallet receives:

```ts
type DataSuffixCapability = {
  value: `0x${string}`;  // hex-encoded ERC-8021 suffix produced by the app
  optional?: boolean;
}
```

This is the app's own attribution claim (e.g. encoded `celo_b057492a`). The wallet's job is to preserve it on the wire.

### 2. Append the suffix to the appropriate calldata field

**For EOA transactions (the common MiniPay case):**

```ts
function applySuffixToEOA(tx, capabilities) {
  const suffix = capabilities.dataSuffix?.value
  if (!suffix) return tx
  return {
    ...tx,
    data: tx.data + suffix.slice(2),  // strip the leading 0x before concatenating
  }
}
```

**For ERC-4337 user operations (smart-account flows, if MiniPay routes any):**

```ts
function applySuffixToUserOp(userOp, capabilities) {
  const suffix = capabilities.dataSuffix?.value
  if (!suffix) return userOp
  return {
    ...userOp,
    callData: userOp.callData + suffix.slice(2),
  }
}
```

Same shape as Base's wallet guide; ERC-8021 is intentionally calldata-position-agnostic — what matters is that the suffix bytes end up at the tail of `tx.input` on chain. Wagmi already does this concatenation for apps that use `useWriteContract({ dataSuffix })`; the wallet's job is to make sure that whatever pathway the app uses (wagmi, direct `eth_sendTransaction`, `wallet_sendCalls`), the suffix survives to the signed tx.

### 3. Prepend MiniPay's own `minipay` claim

This is the value-add. After accepting and applying the app's suffix, MiniPay's wallet prepends its own platform code:

```
final code field = "minipay," + appCodeField
```

ERC-8021's multi-code shape is a comma-delimited string inside the single code field. So a tx from app `celo_b057492a5aa5` routed through MiniPay ends up with code field `minipay,celo_b057492a5aa5` on chain. Concretely:

```ts
import { toDataSuffix, fromDataSuffix } from '@celo/builder-codes'

// MiniPay wallet — called right before signing, with the app's already-applied suffix
function applyWalletAttribution(tx) {
  const existing = fromDataSuffix(tx.data as `0x${string}`)  // existing app suffix, if any
  const appCodes = existing?.codes ?? []
  const finalSuffix = toDataSuffix(['minipay', ...appCodes])

  // Strip the old suffix from tx.data if present, then append the new one
  const baseData = stripExistingSuffix(tx.data, existing)
  return { ...tx, data: baseData + finalSuffix.slice(2) }
}
```

MiniPay can either re-encode (decode the app suffix, prepend `minipay`, re-encode the whole thing) or hardcode the encoding using its own minimal implementation — `toDataSuffix` is ~30 lines wrapping `ox/erc8021`. Either is fine.

### What if the app didn't pass a suffix?

MiniPay should still emit its own `minipay` claim — every tx through the wallet should be identifiable as a MiniPay tx, regardless of whether the app integrated the SDK. So the fallback path is just `toDataSuffix('minipay')`.

## Wire-format reference

The full encoding shape is documented in [`INDEXERS.md`](../INDEXERS.md) and the SDK's [`sdk/README.md`](../sdk/README.md). The short version:

```
[code:N][length:1][schema:1][marker:16]
                      0x00     0x80218021…×8
```

For `minipay,celo_b057492a5aa5`:

- `code` = `minipay,celo_b057492a5aa5` (25 ASCII bytes)
- `length` = `0x19` (25)
- `schema` = `0x00`
- `marker` = `0x80218021802180218021802180218021`

= 43 bytes of suffix appended after the real calldata.

The marker constant is exported from the SDK as `ERC_8021_MARKER`. The 8021 marker doesn't carry the chain ID — it's the same constant on Celo, Base, Ethereum, and every other EVM chain that adopts the standard. ERC-8021 is the wire format; chain-specific semantics live in the code field (`celo_…` vs Base's prefix).

## The layering rule

A core property of this design: **each layer attributes only itself**.

- **The app** adds `celo_xxxxxxxx` (or its issued code). It does not add `minipay` — even when running inside MiniPay — because the app can't prove that at the moment it constructs the tx.
- **The MiniPay wallet** adds `minipay`. It does not add the app's code — that's the app's claim to make.
- **The indexer** sees both on-chain and joins them: `minipay,celo_b057492a` means "MiniPay-routed tx from the app whose hostname hashes to `celo_b057492a`".

If an app puts `["minipay", appCode]` in its own `toDataSuffix` call, the app is lying about being a MiniPay tx whenever it runs outside MiniPay. This is documented in [`BUILDERS.md`](../BUILDERS.md#the-layering-rule--apps-dont-add-platform-codes) and rejected at the docs level, but the wallet implementation here is what makes the layering trustworthy on-chain.

## Test plan

1. **Pass-through case** — app calls `wallet_sendCalls` with `dataSuffix: toDataSuffix(codeFromHostname('mondeto.app'))`. After signing, the on-chain `tx.input` ends with the suffix decoding to `{ codes: ['minipay', 'celo_b057492a5aa5'], schemaId: 0 }`.
2. **No-app-suffix case** — app sends a plain `eth_sendTransaction` with no suffix. After signing, the on-chain `tx.input` ends with the suffix decoding to `{ codes: ['minipay'], schemaId: 0 }`.
3. **Idempotence** — sending the same tx twice produces identical suffixes.
4. **Multi-call** — for `wallet_sendCalls` with multiple calls, the wallet decides per-call (each call carries its own attribution) or applies once at the bundle level. Recommendation: per-call, so each call is independently decodable. Same as Base's implementation.

The pinned hostname vectors in [`minipay-integration-spec.md`](minipay-integration-spec.md#33-pinned-test-vectors) double as integration-test fixtures: each row's hostname maps to a known suffix; pair it with `minipay,` prepended and you have a deterministic expected on-chain shape to assert against.

## SDK and source pointers

- App-side SDK: [`@celo/builder-codes`](https://www.npmjs.com/package/@celo/builder-codes) (will move to `@celo-org/builder-codes`).
- Encoder source: [`sdk/src/index.ts`](../sdk/src/index.ts) — `toDataSuffix`.
- Decoder source: [`sdk/src/index.ts`](../sdk/src/index.ts) — `fromDataSuffix`.
- Underlying standard: [ERC-8021 in `ox`](https://oxlib.sh/ercs/erc8021/Attribution).
- Reference wallet implementation: [Base's wallet-developer guide](https://docs.base.org/apps/builder-codes/wallet-developers).

## Open questions for MiniPay

1. **Where in the signing path should this hook live?** Recommend: just before the wallet hands the signed tx to the RPC, so the suffix is part of the signed payload. Open to alternatives if the MiniPay codebase has a cleaner intercept point.
2. **Should the `minipay` claim be opt-out?** Default-on is the recommendation — opt-out only for users who explicitly disable attribution in settings, if such a setting exists.
3. **Tx types covered.** EOA `eth_sendTransaction` is mandatory. ERC-5792 `wallet_sendCalls` if MiniPay supports it. ERC-4337 user-ops only if MiniPay routes any — open question for the wallet team.
4. **Existing fee-abstraction interactions.** Celo's fee-currency feature changes some calldata handling on some tx types — confirm no overlap. (Spoiler: there shouldn't be, since the suffix is trailing metadata, but worth a manual test.)

## Why bother — quick recap

- **One filter, full platform attribution.** `WHERE codes LIKE '%minipay%'` on Dune isolates every MiniPay tx. No hostname lookup needed.
- **Composes with app attribution for free.** The app keeps emitting its own code; the wallet stacks `minipay` on top. Each layer is independently verifiable.
- **Anti-spoofing improvement.** Faking a MiniPay tx now requires faking *both* the app suffix and the wallet suffix — and the wallet suffix is added inside MiniPay's signing path, which a third party can't reproduce without compromising the wallet itself.
- **Same standard as Base.** Indexers/dashboards built against ERC-8021 work for both ecosystems with no protocol-specific code.

## Questions

File an issue at `github.com/celo-org/builder-codes` or reach out to Lena Hierzi on Telegram / Discord.
