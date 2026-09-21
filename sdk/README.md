# @celo/attribution-tags

ERC-8021 attribution **on Celo**. One line to tag a transaction; one line to verify it. Wraps [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution).

Built for, in priority order:

1. **MiniPay** apps
2. **Proof of Ship** cohort projects
3. **Celo ecosystem** projects more broadly

The SDK is Celo-only — examples below all use `viem/chains`'s `celo` / `celoSepolia`. Configure your viem clients accordingly.

## Install

```bash
npm install @celo/attribution-tags viem
# or
pnpm add @celo/attribution-tags viem
# or
yarn add @celo/attribution-tags viem
```

`viem` is an optional peer dep, only needed if you call `verifyTx`.

> **Local testing without publish:** `cd sdk && npm pack` produces a `.tgz` you can install with `npm install /absolute/path/to/celo-attribution-tags-X.Y.Z.tgz` (or `pnpm add /path/...tgz`). The path is absolute and machine-specific, so this is for local-only workflows; for cross-machine sharing, install from npm.

## Usage

### Tag a transaction

```ts
import { toDataSuffix } from "@celo/attribution-tags";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

const wallet = createWalletClient({ chain: celo, transport: http() });

await wallet.sendTransaction({
  to: "0x...",
  value: 0n,
  data: toDataSuffix("celo_b7k3p9da"),
});
```

**A note on multi-code:** ERC-8021 lets one suffix carry several codes — `toDataSuffix(["foo", "bar"])` is supported by the wire format. But each code should only be added by the entity it represents. Your app emits its own code; platform codes like `minipay` are added by the platform's wallet, not by your app. See [`BUILDERS.md`](../BUILDERS.md) for the full layering rule.

### Verify a transaction

```ts
import { verifyTx } from "@celo/attribution-tags";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const client = createPublicClient({ chain: celo, transport: http() });

const result = await verifyTx({ client, hash: "0x..." });
// → { codes: ["celo_b7k3p9da"], schemaId: 0 } or null
```

### Smart-account (ERC-4337) transactions

When the user has a smart-contract wallet, the on-chain transaction is the bundler's `handleOps` call to the EntryPoint and the app's suffix sits inside the UserOperation's `callData`. `verifyTx` handles this automatically (EntryPoint v0.6 and v0.7): if the outer input carries no tag it decodes the bundle and returns the first tagged operation, with `sender` set to the smart account that produced it. To see every operation:

```ts
import { verifyUserOps, fromEntryPointCalldata } from "@celo/attribution-tags";

await verifyUserOps({ client, hash });
// → [{ sender: "0xad00…", attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } }, …]
//   or null if the tx is not a handleOps bundle

fromEntryPointCalldata(tx.input); // same, offline, from raw calldata
```

Credit `sender`, not the transaction's `from` — `from` is the bundler.

### Decode a suffix offline

```ts
import { fromDataSuffix } from "@celo/attribution-tags";

fromDataSuffix("0x63656c6f040080218021802180218021802180218021");
// → { codes: ["celo"], schemaId: 0 }
```

### Role-based tags (Schema 2) — for facilitators and payment infrastructure

ERC-8021 Schema 2 encodes *who played which role* in producing a transaction, instead of a flat code list. It's the shape used by payment facilitators (e.g. x402 settlement services) that submit transactions on behalf of an app and want to attribute the app, the facilitator, and optionally the paying client separately:

```ts
import { toRoleDataSuffix } from "@celo/attribution-tags";

const suffix = toRoleDataSuffix({
  app: "celo_b7k3p9da",   // the app / resource server
  wallet: "celo_facil",   // the wallet / facilitator submitting the tx
  service: "celo_agent",  // optional: the paying client
});
// append to settlement calldata: concat([callData, suffix])
```

`fromDataSuffix` / `verifyTx` decode Schema 2 automatically:

```ts
fromDataSuffix(suffix);
// → {
//     codes: ["celo_b7k3p9da", "celo_facil", "celo_agent"],
//     schemaId: 2,
//     app: "celo_b7k3p9da",
//     wallet: "celo_facil",
//     service: ["celo_agent"],
//   }
```

Most apps don't need this: if you're tagging your own transactions, use `toDataSuffix` (Schema 0). Schema 2 is for infrastructure that submits transactions *for* others.

## Wire format

**Schema 0** (default — `toDataSuffix`). The suffix layout, reading left-to-right at the end of calldata:

```
[code:N][length:1][schema:1][marker:16]
                      0x00     0x80218021…×8
```

Multi-code is encoded as a comma-delimited string in the code field; the SDK splits on decode.

**Schema 2** (role-based — `toRoleDataSuffix`):

```
[CBOR map {a,w,s}][length:2][schema:1][marker:16]
                               0x02      0x80218021…×8
```

The CBOR map uses ERC-8021's canonical short keys: `a` = app code, `w` = wallet code, `s` = service codes (array). Encoding is delegated to `ox/erc8021`, so it is wire-compatible with other Schema 2 implementations.

The marker constant is exported as `ERC_8021_MARKER`.

## Validation

`toDataSuffix` and `toRoleDataSuffix` reject codes that:

- are empty or longer than 32 bytes
- contain anything outside `[a-z0-9_]` (no uppercase, no spaces, no commas)
- comma-joined, exceed 255 bytes total (the wire format's length byte caps the multi-code field)

This is stricter than ERC-8021 itself but matches the format Celo distributes (`celo_xxxxxxxx`) and the platform codes used in the Celo ecosystem (`minipay`, `proofofship`). Within those bounds any code works — issued, hostname-derived, or a custom one you pick for your app.

## API

```ts
toDataSuffix(code: string | readonly string[]): Hex          // Schema 0
toRoleDataSuffix({ app?, wallet?, service? }): Hex            // Schema 2
fromDataSuffix(data: Hex): DecodedSuffix | null
verifyTx({ client, hash }): Promise<DecodedSuffix | null>
verifyUserOps({ client, hash }): Promise<UserOpAttribution[] | null>   // ERC-4337 bundles
fromEntryPointCalldata(data: Hex): UserOpAttribution[] | null          // offline variant
codeFromHostname(hostname: string): string  // → "celo_" + 12 hex chars

interface DecodedSuffix {
  codes: string[];      // every code found, regardless of schema
  schemaId: number;     // 0 or 2
  app?: string;         // Schema 2 only
  wallet?: string;      // Schema 2 only
  service?: string[];   // Schema 2 only
  sender?: Address;     // ERC-4337 only: the smart account to credit
}

interface UserOpAttribution {
  sender: Address;                    // UserOperation sender (smart account)
  attribution: DecodedSuffix | null;  // null if that op is untagged
}

ENTRY_POINT_ADDRESSES: { v0_6: Address; v0_7: Address }  // canonical EntryPoints

type AttributionTagSuffix = Hex  // alias for the suffix return type
ERC_8021_MARKER: "0x80218021802180218021802180218021"
```

`fromDataSuffix` accepts full calldata, not just the bare suffix — it parses from the end. It returns `null` for anything that isn't a clean Schema 0 or Schema 2 tag: no marker, a Schema 1 (custom-registry) tag, or a tag carrying no codes at all.

`verifyTx` never throws — RPC errors return `null`. For ERC-4337 bundles (`handleOps` on EntryPoint v0.6 or v0.7, detected by selector so custom EntryPoint deployments work too) it falls back to decoding each UserOperation's `callData` and returns the first tagged one with its `sender`. `verifyUserOps` returns all operations.

`codeFromHostname` derives a per-app code from a hostname (used by MiniPay mini apps to self-attribute without a registration step). Algorithm: lowercase → strip leading `www.` → SHA-256 → first 6 bytes hex (12 chars) → `celo_` prefix. Same input → same code, every time.

### Pinned hostname → code vectors

Independently verified against `shasum -a 256` and against [`tests/hostname.test.ts`](tests/hostname.test.ts). If a reimplementation doesn't produce these values, the algorithm has drifted.

| Hostname | Code |
|---|---|
| `mondeto.app` | `celo_b057492a5aa5` |
| `celo.org` | `celo_8549372f8229` |
| `minipay.io` | `celo_51e519342b9a` |
| `app.mondeto.app` | `celo_1a8ba29dac7a` |
| `mondeto.vercel.app` | `celo_04168799c492` |

Subdomains stay distinct by design (so `*.vercel.app` apps don't all collide into one code). Preview / staging hostnames therefore produce their own codes; aggregate environments at the dashboard layer, not the SDK layer.

## License

MIT.
