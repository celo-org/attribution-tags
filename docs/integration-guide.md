# Integrating Celo Builder Codes

**Lena Hierzi, DevRel Lead, Celo Core Co — 7 May 2026**

A 1-pager for builders shipping on Celo. Tag your transactions so the on-chain attribution pipeline can see them, in two steps.

**Who this is for:** MiniPay app builders, Proof of Ship cohort projects, and Celo ecosystem projects that want their on-chain activity attributed to them. Celo only — the rest of this guide assumes you're sending transactions to Celo Mainnet (or Celo Sepolia for testing).

## What this is

ERC-8021 is the standard for appending a small attribution suffix to a transaction's calldata. The suffix is invisible to the contract being called (the EVM discards trailing bytes), so adding it never changes execution semantics — it just makes the transaction identifiable as having come through your app.

`@celo-org/builder-codes` is a thin wrapper over [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution) that gives you three calls:

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
npm install @celo-org/builder-codes viem
```

Append the suffix to the `data` field of any transaction you send:

```ts
import { toDataSuffix } from "@celo-org/builder-codes";
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

### Multi-code (platform + app)

If your app runs inside a host platform (e.g. MiniPay, or a Proof of Ship cohort), you can co-attribute by passing both codes:

```ts
toDataSuffix(["minipay", "celo_b7k3p9da"]);
```

The on-chain pipeline reads both. The platform code lets us aggregate by surface; your code identifies your specific app.

## Step 3 — Verify it worked

Once you've sent a tagged transaction, decode it:

```ts
import { verifyTx } from "@celo-org/builder-codes";
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
import { fromDataSuffix } from "@celo-org/builder-codes";
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
