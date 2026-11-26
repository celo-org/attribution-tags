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

`viem` is an optional peer dep, only needed if you call `verifyTx` or use `withAttribution`.

> **Local testing without publish:** `cd sdk && npm pack` produces a `.tgz` you can install with `npm install /absolute/path/to/celo-attribution-tags-X.Y.Z.tgz` (or `pnpm add /path/...tgz`). The path is absolute and machine-specific, so this is for local-only workflows; for cross-machine sharing, install from npm.

## Usage

### Tag every transaction (recommended)

Extend the wallet client once; every `sendTransaction`, `writeContract` (and `*Sync`) call it makes carries the suffix, including plain value transfers with no `data`:

```ts
import { withAttribution } from "@celo/attribution-tags";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

const wallet = createWalletClient({ chain: celo, transport: http() })
  .extend(withAttribution("celo_b7k3p9da"));

await wallet.sendTransaction({ to: "0x...", value: 0n });
await wallet.writeContract({ address, abi, functionName: "transfer", args });
```

If the data already ends with a Schema 0 tag the codes are merged into one suffix (no double tagging); a Schema 2 tag is left untouched. A call-site `dataSuffix` is placed before the attribution tag. `sendCalls` (EIP-5792) is not wrapped — use viem ≥ 2.45's client-level `dataSuffix` option for that.

### Tag a single transaction

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

When the user has a smart-contract wallet, the on-chain transaction is the bundler's `handleOps` call to the EntryPoint and the app's suffix sits inside the UserOperation's `callData`. `verifyTx` handles this automatically (EntryPoint v0.6 to v0.9): if the outer input carries no tag it decodes the bundle and returns the first tagged operation that the receipt shows was executed, with `sender` set to the smart account that produced it. An operation counts as executed when the transaction succeeded on a known EntryPoint and that EntryPoint emitted the operation's own `UserOperationEvent` with `success = true`. An operation whose calls reverted, or a `handleOps` call to any other address, shows as untagged. This needs a client with `getTransactionReceipt` (viem's `PublicClient` has it). To see every operation:

```ts
import { verifyUserOps, fromEntryPointCalldata } from "@celo/attribution-tags";

await verifyUserOps({ client, hash });
// → [{ sender: "0xad00…", attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } }, …]
//   attribution is null for an untagged op or one that did not execute;
//   null if the tx is not a handleOps call to a known EntryPoint

fromEntryPointCalldata(tx.input); // offline decode of the raw calldata: UNVERIFIED
```

Credit `sender`, not the transaction's `from` — `from` is the bundler. Only `verifyUserOps` / `verifyTx` check that the operation executed: the calldata alone can name any account, so do not credit the output of `fromEntryPointCalldata` on its own. For a custom EntryPoint deployment, pass `entryPoints: [address]`.

### Relayed intents (Porto-style EIP-7702 wallets)

Some wallets are EIP-7702 accounts that sign an *intent* (their list of calls) and let a relay submit it, for example Altana wallets. The on-chain transaction is the relay's call to `Orchestrator.execute(bytes encodedIntent)`, and the app's suffix is on a call inside the signed intent. `verifyTx` handles this automatically: if the outer input carries no tag and is not a `handleOps` bundle, it decodes the intent and returns the tagged call's codes, with `sender` set to the account that signed — but only for an intent the receipt shows was executed. To see every intent:

```ts
import { verifyIntents, fromOrchestratorCalldata } from "@celo/attribution-tags";

await verifyIntents({ client, hash });
// → [{ sender: "0xb244…", attribution: { codes: ["celo_d6a0b77183c8"], schemaId: 0 } }]
//   or null if the tx is not an Orchestrator execute call

fromOrchestratorCalldata(tx.input); // offline, from raw calldata — UNVERIFIED, see below
```

Credit `sender`, not the transaction's `from` — `from` is the relay.

**What is verified.** Calldata alone proves nothing: anyone can send `execute` calldata holding a made-up intent that names any account. `verifyTx` and `verifyIntents` therefore credit an intent only when all of these hold, and report it as untagged (`attribution: null`) otherwise:

- the transaction's `to` is a known Orchestrator deployment — `ORCHESTRATOR_ADDRESSES` (Celo Mainnet and Celo Sepolia), plus any you pass as `orchestrators: [...]`. An `execute` call to any other address is not read at all;
- the transaction succeeded;
- that contract emitted `IntentExecuted` for the same account and nonce, with `incremented` true and `err` zero. The Orchestrator emits it after checking the account's EIP-712 signature and running the calls; a rejected intent gets a non-zero `err` without the transaction reverting.

Each intent is judged by its own log. The Orchestrator emits one `IntentExecuted` per intent, in order, so intents and logs are paired in order and a log is used once: in an `execute(bytes[])` batch, a forged intent cannot borrow the success of a genuine one that carries the same account and nonce. Logs in between are skipped, because an account's pre-calls (the key set-up that rides along with a new account's first transaction) emit their own `IntentExecuted` before the intent's. If any intent has no log of its own, none is credited.

This needs a client with `getTransactionReceipt` (viem's `PublicClient` has it). Within an executed intent only the calls are read, never the fields a relay fills in, so a relay cannot add or change a tag.

`fromOrchestratorCalldata` does none of this: it returns what the calldata claims. Use it for debugging, or as the decode step of an indexer that applies the same three checks itself.

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

> **Status on Celo:** the hosted x402 facilitator (`api.x402.celo.org`) does not emit Schema 2 tags yet. The facilitator-side implementation is under review upstream in [x402-rs/x402-rs#99](https://github.com/x402-rs/x402-rs/pull/99); x402 settlements on Celo are untagged until it ships.

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
withAttribution(code | codes): (client) => client   // viem wallet-client extension
fromDataSuffix(data: Hex): DecodedSuffix | null
verifyTx({ client, hash }): Promise<DecodedSuffix | null>
verifyUserOps({ client, hash }): Promise<UserOpAttribution[] | null>   // ERC-4337 bundles (executed ops only)
verifyIntents({ client, hash }): Promise<IntentAttribution[] | null>   // relayed intents (Orchestrator.execute)
fromOrchestratorCalldata(data: Hex): IntentAttribution[] | null        // offline decode, unverified
fromEntryPointCalldata(data: Hex): UserOpAttribution[] | null          // offline decode, unverified
codeFromHostname(hostname: string): string  // → "celo_" + 12 hex chars
codeFromRepo(repo: string): string          // → "celo_" + 12 hex chars ("owner/repo" or github.com URL)

interface DecodedSuffix {
  codes: string[];      // every code found, regardless of schema
  schemaId: number;     // 0 or 2
  app?: string;         // Schema 2 only
  wallet?: string;      // Schema 2 only
  service?: string[];   // Schema 2 only
  sender?: `0x${string}`; // ERC-4337 and relayed intents only: the account to credit
}

interface UserOpAttribution {
  sender: `0x${string}`;              // UserOperation sender (smart account)
  attribution: DecodedSuffix | null;  // null if untagged, or (verifyUserOps) if the op did not execute
}

interface IntentAttribution {
  sender: `0x${string}`;              // account the intent names as its signer
  attribution: DecodedSuffix | null;  // null if untagged, or (verifyIntents) if the intent did not execute
}

ENTRY_POINT_ADDRESSES: { v0_6; v0_7; v0_8; v0_9 }  // canonical EntryPoints verifyTx accepts
USER_OPERATION_EVENT_TOPIC: `0x${string}`  // topic0 of UserOperationEvent
ORCHESTRATOR_SELECTORS: { execute: `0x${string}`; executeBatch: `0x${string}` }  // Orchestrator entry points
ORCHESTRATOR_ADDRESSES: { celo: `0x${string}`; celoSepolia: `0x${string}` }      // deployments verifyTx accepts
INTENT_EXECUTED_TOPIC: `0x${string}`  // topic0 of IntentExecuted(address,uint256,bool,bytes4)

type AttributionTagSuffix = Hex  // alias for the suffix return type
ERC_8021_MARKER: "0x80218021802180218021802180218021"
```

`fromDataSuffix` accepts full calldata, not just the bare suffix — it parses from the end. It returns `null` for anything that isn't a clean Schema 0 or Schema 2 tag: no marker, a Schema 1 (custom-registry) tag, or a tag carrying no codes at all.

`withAttribution(code)` returns a viem `extend` function. It validates the code once at construction (throws on an invalid code, before any transaction is sent) and wraps `sendTransaction`, `sendTransactionSync`, `writeContract` and `writeContractSync` when the client has them. The SDK still doesn't import viem: the extension is typed structurally, so your client keeps viem's own types.

`verifyTx` never throws — RPC errors return `null`, the same answer as an untagged transaction. Public RPCs can drop calls under load, so retry, or use a dedicated RPC, before treating a `null` as untagged. For ERC-4337 bundles (`handleOps` on a known EntryPoint, v0.6 to v0.9) it decodes each UserOperation's `callData` and returns the first tagged operation that the receipt shows was executed, with its `sender`; `verifyUserOps` returns all operations. For relayed intents (`execute` on a known Orchestrator deployment) it returns, the same way, the first tagged intent that the receipt shows was executed, with `sender` set to the account that signed it; `verifyIntents` returns all of them. For these wrapper calls the end of the outer input is never read: it is the last operation's signature or the intent's payment signature, which one participant can make end with the marker. Both checks need a client with `getTransactionReceipt`; without it, bundles and intents are reported untagged. Pass `entryPoints` or `orchestrators` to accept extra deployments.

`codeFromHostname` derives a per-app code from a hostname (used by MiniPay mini apps to self-attribute without a registration step). Algorithm: lowercase → strip leading `www.` → SHA-256 → first 6 bytes hex (12 chars) → `celo_` prefix. Same input → same code, every time.

`codeFromRepo` reproduces the Celo Builders platform's derivation of a project's code from its GitHub repository, so a builder can assert that the code in their config matches their own repository. Algorithm: trim → lowercase → SHA-256 of the `owner/repo` slug → first 6 bytes hex (12 chars) → `celo_` prefix. A full `https://github.com/owner/repo` URL (with or without `.git` / trailing path) is reduced to the slug first. Anything that isn't `owner/repo` throws.

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

### Pinned repository → code vectors

Verified against `shasum -a 256` and against [`tests/repo.test.ts`](tests/repo.test.ts), which also compares `codeFromRepo` with a verbatim copy of the platform's derivation on every run.

| Repository | Code |
|---|---|
| `gigahierz/trading-bot-updown` | `celo_7b3c251337be` |
| `icmelvin/myceloproject` | `celo_4d19a013cc70` |
| `icmelvin/2nd-celo-hackathon` | `celo_3712ca0f1cdc` |

Case and surrounding whitespace don't matter (`icmelvin/MyCeloProject` gives the same code); the repository name does — a fork or a renamed repo is a different code.

## License

MIT.
