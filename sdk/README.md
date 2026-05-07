# @celo-org/builder-codes

ERC-8021 builder-code attribution for Celo. One line to tag a transaction; one line to verify it. Wraps [`ox/erc8021`](https://oxlib.sh/ercs/erc8021/Attribution).

## Install

```bash
npm install @celo-org/builder-codes viem
```

`viem` is an optional peer dep, only needed if you call `verifyTx`.

## Usage

### Tag a transaction

```ts
import { toDataSuffix } from "@celo-org/builder-codes";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

const wallet = createWalletClient({ chain: celo, transport: http() });

await wallet.sendTransaction({
  to: "0x...",
  value: 0n,
  data: toDataSuffix("celo_b7k3p9da"),
});
```

Multi-code (platform + app):

```ts
toDataSuffix(["minipay", "celo_b7k3p9da"]);
```

### Verify a transaction

```ts
import { verifyTx } from "@celo-org/builder-codes";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const client = createPublicClient({ chain: celo, transport: http() });

const result = await verifyTx({ client, hash: "0x..." });
// → { codes: ["celo_b7k3p9da"], schemaId: 0 } or null
```

### Decode a suffix offline

```ts
import { fromDataSuffix } from "@celo-org/builder-codes";

fromDataSuffix("0x62617365617070070080218021802180218021802180218021");
// → { codes: ["baseapp"], schemaId: 0 }
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

This is stricter than ERC-8021 itself but matches the format Celo distributes (`celo_xxxxxxxx`) and standard platform codes like `minipay`, `proofofship`, `baseapp`.

## API

```ts
toDataSuffix(code: string | readonly string[]): Hex
fromDataSuffix(suffix: Hex): { codes: string[]; schemaId: number } | null
verifyTx({ client, hash }): Promise<{ codes: string[]; schemaId: number } | null>

ERC_8021_MARKER: "0x80218021802180218021802180218021"
```

`verifyTx` never throws — RPC errors return `null`.

## License

MIT.
