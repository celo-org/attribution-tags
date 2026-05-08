# Integrating Celo Builder Codes

**Lena Hierzi, DevRel Lead, Celo Core Co — 7 May 2026**

A 1-pager for builders shipping on Celo. Tag your transactions so the on-chain attribution pipeline can see them, in two steps.

**Who this is for:** MiniPay app builders, Proof of Ship cohort projects, and Celo ecosystem projects that want their on-chain activity attributed to them. Celo only — the rest of this guide assumes you're sending transactions to Celo Mainnet (or Celo Sepolia for testing).

## What this is

ERC-8021 is the standard for appending a small attribution suffix to a transaction's calldata. The suffix is invisible to the contract being called (the EVM discards trailing bytes), so adding it never changes execution semantics — it just makes the transaction identifiable as having come through your app.

`@gigahierz/builder-codes` (pre-release) is a thin wrapper over [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution) that gives you three calls. It will move to `@celo-org/builder-codes` at the stable 0.1.0 once Celo Core publish rights are in place; until then, install from the personal scope on the `next` tag.

```ts
toDataSuffix(code | [codes])  // → Hex
fromDataSuffix(suffix)         // → { codes, schemaId } | null
verifyTx({ client, hash })     // → { codes, schemaId } | null
```

## Step 1 — Get your code

You'll receive a code in the format `celo_xxxxxxxx` (13 ASCII bytes). Codes are not human-readable on purpose — no name squatting, no claim arbitration.

How codes are issued is being finalised; you'll get yours through your usual onboarding contact at Celo or MiniPay. Until that flow is live, hardcode a placeholder like `celo_test1234` for local development.

## Step 2 — Tag your transactions

Install the SDK:

```bash
npm install @gigahierz/builder-codes@next viem
# or pnpm add / yarn add — same args
```

Append the suffix to the `data` field of any transaction you send:

```ts
import { toDataSuffix } from "@gigahierz/builder-codes";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

const wallet = createWalletClient({ chain: celo, transport: http() });

await wallet.sendTransaction({
  to: "0x...",
  value: 1n,
  data: toDataSuffix("celo_b7k3p9da"),
});
```

If you're calling a contract method, concatenate your existing calldata with the suffix:

```ts
import { encodeFunctionData, concat } from "viem";

const callData = encodeFunctionData({ abi, functionName: "transfer", args });
const taggedData = concat([callData, toDataSuffix("celo_b7k3p9da")]);

await wallet.sendTransaction({ to: tokenAddress, data: taggedData });
```

That's the whole integration. Every transaction sent through your app is now tagged.

### Each layer attributes itself

ERC-8021 supports multi-code suffixes — one tx can carry several codes — but each code should only be added by the entity it represents.

- **Your app code** (`celo_xxxxxxxx`): added by your app, in your app's SDK call. That's what this guide is teaching you to do.
- **A platform code** like `minipay` or `proofofship`: added by the platform itself, at the wallet level (MiniPay) or the cohort layer (Proof of Ship). Not your app's job.

If you put `["minipay", yourCode]` in your app's `toDataSuffix` call, your app is asserting "this tx ran in MiniPay" — even when it didn't. Every tx your app sends from a regular browser would lie about being a MiniPay tx, polluting the attribution data. Don't.

The combined on-chain shape `minipay,celo_xxxxxxxx` is what eventually appears once MiniPay's wallet prepends its own claim. Your responsibility ends at your own code.

### MiniPay mini apps — auto-derive

If you're shipping a MiniPay mini app, you don't need to register or be issued a code. The SDK derives a deterministic per-app code from your hostname (e.g. `mondeto.app` → `celo_b057492a`), which means same hostname → same code, every time, anywhere it runs:

```ts
import { toDataSuffix, codeFromHostname } from "@gigahierz/builder-codes";

const tag = toDataSuffix(codeFromHostname(location.hostname));
// → suffix encoding just your celo_xxxxxxxx code

await wallet.sendTransaction({ to, value, data: tag });
```

That's the entire integration. No backend, no key, no form. Don't add `"minipay"` yourself — MiniPay will prepend it at the wallet level once their integration ships, and the on-chain shape will become `minipay,celo_xxxxxxxx` automatically.

The hostname-to-code mapping is a one-way SHA-256 prefix; you can verify it offline:

```bash
printf "%s" "mondeto.app" | shasum -a 256 | cut -c1-8
# → b057492a (matches codeFromHostname("mondeto.app"))
```

`codeFromHostname` lowercases the hostname and strips a leading `www.`, so `WWW.Mondeto.App` and `mondeto.app` map to the same code. Subdomains are kept (so `app.mondeto.app` ≠ `mondeto.app`), to avoid collisions on shared hosts like `*.vercel.app`.

Apps not in MiniPay's approved-app list will still produce a code on-chain, but the attribution dashboard only credits codes whose hostnames are on the list — so the credit step is gated, not the tagging step. See `docs/minipay-attribution.md` for the design rationale.

### SSR-safety (Next.js, Remix, SvelteKit)

`codeFromHostname` reads `window.location.hostname` indirectly through whatever you pass it — but in a server-rendered framework, anything that touches `window` during render will throw with `ReferenceError: window is not defined`. Two safe patterns:

**Pattern A — guarded helper, called from a client component / hook:**

```ts
// lib/builder-code.ts
import { toDataSuffix, codeFromHostname } from "@gigahierz/builder-codes";
import type { Hex } from "viem";

let cached: Hex | null = null;

export function getBuilderCodeSuffix(): Hex | undefined {
  if (typeof window === "undefined") return undefined;
  if (cached) return cached;
  try {
    cached = toDataSuffix(
      codeFromHostname(window.location.hostname),
    ) as Hex;
    return cached;
  } catch {
    return undefined;
  }
}
```

The `typeof window === "undefined"` check makes the function a no-op on the server. The cache means SHA-256 runs once per session, not once per render.

**Pattern B — derive at module init in a `"use client"` file:**

```tsx
"use client";
import { toDataSuffix, codeFromHostname } from "@gigahierz/builder-codes";

export const BUILDER_SUFFIX = toDataSuffix(
  codeFromHostname(window.location.hostname),
);
```

Only do this in a file marked `"use client"`. Importing it from a server component will throw at build time.

If your wagmi version supports the `dataSuffix` parameter on `useWriteContract` (or you wire it through your own contract-write helper), pass the result of `getBuilderCodeSuffix()` into it. wagmi handles the rest — no manual calldata concatenation needed.

## Step 3 — Verify it worked

Once you've sent a tagged transaction, decode it:

```ts
import { verifyTx } from "@gigahierz/builder-codes";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const client = createPublicClient({ chain: celo, transport: http() });

const result = await verifyTx({
  client,
  hash: "0x...",
});

console.log(result); // { codes: ["celo_b7k3p9da"], schemaId: 0 }
```

`verifyTx` returns `null` (never throws) if the marker isn't there. If it returns `null` for a tx you expected to be tagged, your suffix didn't make it onto the wire — most likely you set `data: code` instead of `data: toDataSuffix(code)`, or your wallet client stripped trailing bytes.

For offline debugging without an RPC roundtrip:

```ts
import { fromDataSuffix } from "@gigahierz/builder-codes";
fromDataSuffix(rawCalldata);
```

## Wire format reference

Reading backwards from the end of `tx.input`:

```
[...your calldata...] [code:N] [length:1] [schema:1] [marker:16]
                                              0x00     0x80218021…
```

- Marker: constant `0x80218021802180218021802180218021` (16 bytes)
- Schema: `0x00` for v1 (Schema 0 — canonical registry)
- Length: how many bytes the code field occupies (1–32)
- Code: ASCII; multi-code is comma-delimited inside this field

A SQL filter for any tagged tx on Celo:

```sql
WHERE input LIKE '%80218021802180218021802180218021'
```

## Common gotchas

- **Don't include the suffix in your contract's expected calldata.** It goes *after*. The contract sees only its real arguments.
- **Some smart-account/bundler flows strip trailing bytes.** If you're using ERC-4337 or a meta-tx relayer, double-check that your relayer preserves the suffix; if not, attribution won't survive bundling. Contact us if you hit this.
- **Codes are case-sensitive in principle, but the SDK enforces lowercase.** Stick to `[a-z0-9_]`.
- **No on-chain registry yet.** The mapping from `celo_xxxxxxxx` → app lives off-chain at Celo. Future phases may put this on-chain.

## Where to read your tagged transactions

Chidi (Celo data) maintains a Dune dbt model that joins tagged Celo transactions against the codes lookup. Once it's published, you'll be able to query `attributed_transactions` directly. Link to follow when the dataset is live.

## Questions

Reach out to Lena (DevRel) or your Celo onboarding contact. SDK source at `https://github.com/celo-org/builder-codes`.
