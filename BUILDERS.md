# Celo Builder Codes — for app builders

**Lena Hierzi, DevRel Lead, Celo Core Co — 8 May 2026**

You're shipping an app on Celo and you want your transactions to be attributable to your app. This is the guide for that. Two steps: install the SDK, append the suffix.

**Who this is for:** MiniPay app builders, Proof of Ship cohort projects, and Celo ecosystem projects that want their on-chain activity attributed to them. The rest of this guide assumes you're sending transactions to Celo Mainnet (or Celo Sepolia for testing).

If you're writing a parser, indexer, or Dune model for tagged transactions instead, see [`INDEXERS.md`](INDEXERS.md).

## What's actually happening

ERC-8021 is the standard for appending a small attribution suffix to a transaction's calldata. The suffix is invisible to the contract being called (the EVM discards trailing bytes), so adding it never changes execution semantics — it just makes the transaction identifiable as having come through your app.

`@celo/builder-codes` wraps the [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution) standard and gives you four exports:

```ts
toDataSuffix(code | [codes])               // → encoded suffix (Hex)
codeFromHostname(hostname)                 // → "celo_xxxxxxxx" derived from a hostname
fromDataSuffix(suffix)                     // → { codes, schemaId } | null
verifyTx({ client, hash })                 // → { codes, schemaId } | null
```

## Install

```bash
npm install @celo/builder-codes viem
# or pnpm add / yarn add — same args
```

`viem` is an optional peer dep; you only need it if you call `verifyTx` (decoding from a tx hash).

## Quickstart — MiniPay mini apps

If you're shipping a MiniPay mini app, **you don't need to register or be issued a code**. The SDK derives a deterministic per-app code from your hostname. Same hostname → same code, every time, anywhere it runs:

```ts
import { toDataSuffix, codeFromHostname } from '@celo/builder-codes'

const tag = toDataSuffix(codeFromHostname(location.hostname))

await wallet.sendTransaction({ to, value, data: tag })
```

That's the entire integration. No backend, no key, no form. Hostname-to-code is a one-way SHA-256 prefix; you can verify it offline:

```bash
printf "%s" "mondeto.app" | shasum -a 256 | cut -c1-12
# → b057492a5aa5   (matches codeFromHostname("mondeto.app") = "celo_b057492a5aa5")
```

`codeFromHostname` lowercases the hostname and strips a leading `www.`, so `WWW.Mondeto.App` and `mondeto.app` map to the same code. Subdomains stay distinct (so `app.mondeto.app` ≠ `mondeto.app`) — important on shared hosts like `*.vercel.app` where stripping subdomains would collide every Vercel-hosted app into one code.

Apps not in MiniPay's approved-app list will still produce a code on-chain, but the attribution dashboard only credits codes whose hostnames are on the list — so the credit step is gated, not the tagging step. See [`docs/minipay-attribution.md`](docs/minipay-attribution.md) for the design rationale and [`docs/minipay-integration-spec.md`](docs/minipay-integration-spec.md) for the end-to-end MiniPay handover (registration form → confirmation email → integration → verification).

## Quickstart — issued codes (Proof of Ship and others)

If you've been issued a code (`celo_xxxxxxxx`) through Proof of Ship onboarding or another path, pass it directly:

```ts
import { toDataSuffix } from '@celo/builder-codes'

const tag = toDataSuffix('celo_b7k3p9da')

await wallet.sendTransaction({ to, value, data: tag })
```

For local development before you have a real code, hardcode `celo_test1234` so you can iterate.

## If you're calling a contract method

Concatenate your encoded calldata with the suffix:

```ts
import { encodeFunctionData, concat } from 'viem'

const callData = encodeFunctionData({ abi, functionName: 'transfer', args })
const taggedData = concat([callData, tag])

await wallet.sendTransaction({ to: tokenAddress, data: taggedData })
```

If you're using **wagmi**, even simpler — pass `dataSuffix` and wagmi handles concatenation:

```ts
const { writeContract } = useWriteContract()

writeContract({
  address, abi,
  functionName: 'transfer',
  args,
  dataSuffix: tag,
})
```

## SSR-safety (Next.js, Remix, SvelteKit)

`codeFromHostname(window.location.hostname)` is browser-only. In a server-rendered framework, anything that touches `window` during render will throw `ReferenceError: window is not defined`. Two safe patterns:

**Pattern A — guarded helper, called from a client component / hook:**

```ts
// lib/builder-code.ts
import { toDataSuffix, codeFromHostname } from '@celo/builder-codes'
import type { Hex } from 'viem'

let cached: Hex | null = null

export function getBuilderCodeSuffix(): Hex | undefined {
  if (typeof window === 'undefined') return undefined
  if (cached) return cached
  try {
    cached = toDataSuffix(codeFromHostname(window.location.hostname)) as Hex
    return cached
  } catch {
    return undefined
  }
}
```

The `typeof window === 'undefined'` check makes the function a no-op on the server. The cache means SHA-256 runs once per session, not once per render.

**Pattern B — derive at module init in a `"use client"` file:**

```tsx
'use client'
import { toDataSuffix, codeFromHostname } from '@celo/builder-codes'

export const BUILDER_SUFFIX = toDataSuffix(codeFromHostname(window.location.hostname))
```

Only do this in a file marked `"use client"`. Importing it from a server component will throw at build time.

## The layering rule — apps don't add platform codes

ERC-8021 supports multi-code suffixes (one tx can carry several codes), but **each code should only be added by the entity it represents**.

- **Your app code** (`celo_xxxxxxxx`): added by your app. That's what this guide is teaching you to do.
- **A platform code** like `minipay` or `proofofship`: added by the **platform itself**, at the wallet level (MiniPay) or the cohort layer (Proof of Ship). Not your app's job.

If you put `["minipay", yourCode]` in your app's `toDataSuffix` call, your app is asserting "this tx ran in MiniPay" — even when running in plain Chrome. Every tx your app sends from a regular browser would lie about being a MiniPay tx, polluting the attribution data.

The combined on-chain shape `minipay,celo_xxxxxxxx` is what eventually appears once MiniPay's wallet prepends its own claim. Your responsibility ends at your own code.

## Verifying it worked

Once you've sent a tagged transaction, confirm the suffix is on-chain:

```ts
import { verifyTx } from '@celo/builder-codes'
import { createPublicClient, http } from 'viem'
import { celo } from 'viem/chains'

const client = createPublicClient({ chain: celo, transport: http() })

const result = await verifyTx({ client, hash: '0x...' })
console.log(result) // { codes: ["celo_b7k3p9da"], schemaId: 0 }
```

`verifyTx` returns `null` (never throws) if the marker isn't there. If it returns `null` for a tx you expected to be tagged, your suffix didn't make it onto the wire — most likely you set `data: code` instead of `data: toDataSuffix(code)`, or your wallet client / bundler stripped trailing bytes.

For offline debugging without an RPC roundtrip:

```ts
import { fromDataSuffix } from '@celo/builder-codes'

fromDataSuffix(rawCalldata)
// → { codes: ["celo_xxxxxxxx"], schemaId: 0 } or null
```

You can also verify against a real tx via Celoscan: the [Mondeto fixture](https://celoscan.io/tx/0xc47b7f8db12b33482b5de0129fc1da66f7b6cb45e56d1d16954ba7e0532bf4d5) is a real Mainnet `updateProfile` tx whose calldata ends with `celo_49960de5`'s suffix.

## Common gotchas

- **Don't include the suffix in your contract's expected calldata.** It goes *after*. The contract sees only its real arguments.
- **Some smart-account / bundler flows strip trailing bytes.** ERC-4337 bundlers and meta-tx relayers may rewrite the calldata, dropping the suffix. Test on-chain before declaring victory; if your relayer drops it, contact us.
- **Stick to `[a-z0-9_]` in your codes.** The SDK rejects uppercase, spaces, and commas at the encode step.
- **The suffix doesn't survive contract execution.** The EVM only sees the function-selector + args part of calldata; the suffix is metadata for off-chain readers, not for your contract logic.

## What about reading your tagged transactions later?

Once a tx is tagged and on-chain, anyone can decode the code from the `input` field — that's the point of using a public standard. Celo's attribution dashboard (Dune-based, built by Chidi) will surface tagged txs grouped by code; we'll link the dashboard here once it's published.

If you want to query the data yourself, see [`INDEXERS.md`](INDEXERS.md) — it has the wire format and SQL filter you need.

## Reference

- Full SDK API: [`sdk/README.md`](sdk/README.md)
- npm package: https://www.npmjs.com/package/@celo/builder-codes
- Source: https://github.com/celo-org/builder-codes

## Questions

File an issue or reach out to Lena Hierzi on Telegram / Discord.
