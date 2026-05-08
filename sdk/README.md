# @gigahierz/builder-codes

ERC-8021 builder-code attribution **on Celo**. One line to tag a transaction; one line to verify it. Wraps [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution).

> **Pre-release.** Currently published as `@gigahierz/builder-codes` on the `next` tag while we wait for `@celo-org` publish rights. Once those land, this will be republished as `@celo-org/builder-codes` at a stable `0.1.0`, and the `@gigahierz` package will be deprecated with a redirect.

Built for, in priority order:

1. **MiniPay** apps
2. **Proof of Ship** cohort projects
3. **Celo ecosystem** projects more broadly

The SDK is Celo-only — examples below all use `viem/chains`'s `celo` / `celoSepolia`. Configure your viem clients accordingly.

## Install

```bash
npm install @gigahierz/builder-codes@next viem
# or
pnpm add @gigahierz/builder-codes@next viem
# or
yarn add @gigahierz/builder-codes@next viem
```

`viem` is an optional peer dep, only needed if you call `verifyTx`.

> **Local testing without publish:** `cd sdk && npm pack` produces a `.tgz` you can install with `npm install /absolute/path/to/celo-org-builder-codes-X.Y.Z.tgz` (or `pnpm add /path/...tgz`). The path is absolute and machine-specific, so this is for local-only workflows; for cross-machine sharing, install from npm.

## Usage

### Tag a transaction

```ts
import { toDataSuffix } from "@gigahierz/builder-codes";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

const wallet = createWalletClient({ chain: celo, transport: http() });

await wallet.sendTransaction({
  to: "0x...",
  value: 0n,
  data: toDataSuffix("celo_b7k3p9da"),
});
```

**A note on multi-code:** ERC-8021 lets one suffix carry several codes — `toDataSuffix(["foo", "bar"])` is supported by the wire format. But each code should only be added by the entity it represents. Your app emits its own code; platform codes like `minipay` are added by the platform's wallet, not by your app. See `docs/integration-guide.md` for the full layering rule.

### Verify a transaction

```ts
import { verifyTx } from "@gigahierz/builder-codes";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const client = createPublicClient({ chain: celo, transport: http() });

const result = await verifyTx({ client, hash: "0x..." });
// → { codes: ["celo_b7k3p9da"], schemaId: 0 } or null
```

### Decode a suffix offline

```ts
import { fromDataSuffix } from "@gigahierz/builder-codes";

fromDataSuffix("0x63656c6f040080218021802180218021802180218021");
// → { codes: ["celo"], schemaId: 0 }
```

## Wire format

ERC-8021 Schema 0. The suffix layout, reading left-to-right at the end of calldata:

```
[code:N][length:1][schema:1][marker:16]
                      0x00     0x80218021…×8
```

Multi-code is encoded as a comma-delimited string in the code field; the SDK splits on decode.

The marker constant is exported as `ERC_8021_MARKER`.

## Validation

`toDataSuffix` rejects codes that:

- are empty or longer than 32 bytes
- contain anything outside `[a-z0-9_]` (no uppercase, no spaces, no commas)

This is stricter than ERC-8021 itself but matches the format Celo distributes (`celo_xxxxxxxx`) and the platform codes used in the Celo ecosystem (`minipay`, `proofofship`).

## API

```ts
toDataSuffix(code: string | readonly string[]): Hex
fromDataSuffix(suffix: Hex): { codes: string[]; schemaId: number } | null
verifyTx({ client, hash }): Promise<{ codes: string[]; schemaId: number } | null>
codeFromHostname(hostname: string): string  // → "celo_xxxxxxxx"

type BuilderCodeSuffix = Hex  // alias for the toDataSuffix return type
ERC_8021_MARKER: "0x80218021802180218021802180218021"
```

`verifyTx` never throws — RPC errors return `null`.

`codeFromHostname` derives a per-app code from a hostname (used by MiniPay mini apps to self-attribute without a registration step). Algorithm: lowercase → strip leading `www.` → SHA-256 → first 4 bytes hex → `celo_` prefix. Same input → same code, every time. See `docs/minipay-attribution.md` for the design.

## License

MIT.
