import { describe, it, expect } from "vitest";
import {
  toDataSuffix,
  verifyIntents,
  verifyTx,
  verifyUserOps,
} from "../src/index.js";
import {
  MAINNET_MULTI_ACCOUNT,
  MAINNET_MULTI_CODE,
  MAINNET_MULTI_INPUT,
  MAINNET_MULTI_TO,
  MAINNET_SINGLE_ACCOUNT,
  MAINNET_SINGLE_CODE,
  MAINNET_SINGLE_INPUT,
  MAINNET_SINGLE_TO,
  SEPOLIA_PASSKEY_ACCOUNT,
  SEPOLIA_PASSKEY_CODES,
  SEPOLIA_PASSKEY_INPUT,
  SEPOLIA_PASSKEY_TO,
  SEPOLIA_UNSIGNED_FIELD_INPUT,
  SEPOLIA_UNSIGNED_FIELD_TO,
  SEPOLIA_UNTAGGED_ACCOUNT,
  SEPOLIA_UNTAGGED_INPUT,
  SEPOLIA_UNTAGGED_TO,
} from "./fixtures/orchestrator-intents.js";
import {
  V06_CODE,
  V06_INPUT,
  V06_SENDER,
  V06_TO,
} from "./fixtures/entrypoint-v06-handleops.js";

type StubClient = {
  getTransaction: (args: {
    hash: `0x${string}`;
  }) => Promise<{ input: `0x${string}`; to?: `0x${string}` } | null>;
};

function clientReturning(
  input: `0x${string}` | null,
  to?: `0x${string}`,
): StubClient {
  return {
    getTransaction: async () => (input === null ? null : { input, to }),
  };
}

function clientThatThrows(): StubClient {
  return {
    getTransaction: async () => {
      throw new Error("RPC down");
    },
  };
}

const HASH = ("0x" + "a".repeat(64)) as `0x${string}`;

describe("verifyTx", () => {
  it("decodes a tagged tx", async () => {
    const suffix = toDataSuffix("celo_b7k3p9da");
    // simulate real-world calldata: random fn selector + args + suffix
    const fakeCallData = "0xa9059cbb000000000000000000000000aaaa";
    const input = (fakeCallData + suffix.slice(2)) as `0x${string}`;
    const client = clientReturning(input);

    const result = await verifyTx({
      client: client as never,
      hash: HASH,
    });

    expect(result).toEqual({ codes: ["celo_b7k3p9da"], schemaId: 0 });
  });

  it("decodes multi-code", async () => {
    const suffix = toDataSuffix(["minipay", "celo_b7k3p9da"]);
    const client = clientReturning(suffix as `0x${string}`);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result?.codes).toEqual(["minipay", "celo_b7k3p9da"]);
  });

  it("returns null for an untagged tx", async () => {
    const client = clientReturning("0xa9059cbb000000000000000000000000aaaa");
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toBeNull();
  });

  it("returns null for empty input (0x)", async () => {
    const client = clientReturning("0x");
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toBeNull();
  });

  it("returns null when the RPC throws (does not propagate)", async () => {
    const client = clientThatThrows();
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toBeNull();
  });

  it("returns null when the tx is not found", async () => {
    const client = clientReturning(null);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toBeNull();
  });
});

describe("verifyTx — ERC-4337 bundles", () => {
  it("decodes a correctly tagged UserOperation inside handleOps (v0.6, real Mainnet tx)", async () => {
    const client = clientReturning(V06_INPUT, V06_TO);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({ codes: [V06_CODE], schemaId: 0, sender: V06_SENDER });
  });

  it("does not set sender for a plain (non-bundle) tagged tx", async () => {
    const client = clientReturning(toDataSuffix("celo_b7k3p9da"));
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).not.toHaveProperty("sender");
  });

  it("returns null for a bundle whose ops are all untagged", async () => {
    // Strip the suffix out of the inner callData by replacing the marker
    // bytes — the bundle still decodes, but no op carries a tag.
    const untagged = V06_INPUT.replace(
      /80218021802180218021802180218021/,
      "00000000000000000000000000000000",
    ) as `0x${string}`;
    const client = clientReturning(untagged, V06_TO);
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });
});

describe("verifyUserOps", () => {
  it("returns every op with its sender", async () => {
    const client = clientReturning(V06_INPUT, V06_TO);
    const ops = await verifyUserOps({ client: client as never, hash: HASH });
    expect(ops).toEqual([
      { sender: V06_SENDER, attribution: { codes: [V06_CODE], schemaId: 0 } },
    ]);
  });

  it("returns null for a non-bundle tx", async () => {
    const client = clientReturning(toDataSuffix("celo_b7k3p9da"));
    expect(await verifyUserOps({ client: client as never, hash: HASH })).toBeNull();
  });

  it("returns null when the RPC throws", async () => {
    const client = clientThatThrows();
    expect(await verifyUserOps({ client: client as never, hash: HASH })).toBeNull();
  });
});

describe("verifyTx — relayed intents (Orchestrator.execute)", () => {
  it("decodes a tagged call inside a signed intent (real Mainnet tx) and credits the account", async () => {
    const client = clientReturning(MAINNET_SINGLE_INPUT, MAINNET_SINGLE_TO);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({
      codes: [MAINNET_SINGLE_CODE],
      schemaId: 0,
      sender: MAINNET_SINGLE_ACCOUNT,
    });
  });

  it("decodes a session-key intent with several tagged calls (real Mainnet tx)", async () => {
    const client = clientReturning(MAINNET_MULTI_INPUT, MAINNET_MULTI_TO);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({
      codes: [MAINNET_MULTI_CODE],
      schemaId: 0,
      sender: MAINNET_MULTI_ACCOUNT,
    });
  });

  it("decodes an intent signed by a passkey (real Sepolia tx)", async () => {
    const client = clientReturning(SEPOLIA_PASSKEY_INPUT, SEPOLIA_PASSKEY_TO);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({
      codes: [...SEPOLIA_PASSKEY_CODES],
      schemaId: 0,
      sender: SEPOLIA_PASSKEY_ACCOUNT,
    });
  });

  it("a tag at the very end of the outer input is read as for any transaction, with no sender", async () => {
    // Unchanged behaviour: the end of the outer input is checked first. Here
    // the tail tag is outside the account's signed calls, so no account is
    // named; verifyIntents reports the intent itself as untagged.
    const client = clientReturning(SEPOLIA_UNSIGNED_FIELD_INPUT, SEPOLIA_UNSIGNED_FIELD_TO);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({ codes: ["altana", "altana_test"], schemaId: 0 });
    expect(result).not.toHaveProperty("sender");
    const intents = await verifyIntents({ client: client as never, hash: HASH });
    expect(intents![0]!.attribution).toBeNull();
  });

  it("returns null for a relayed intent with no tag (real Sepolia tx)", async () => {
    const client = clientReturning(SEPOLIA_UNTAGGED_INPUT, SEPOLIA_UNTAGGED_TO);
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });
});

describe("verifyIntents", () => {
  it("returns every intent with the account that signed it", async () => {
    const client = clientReturning(MAINNET_SINGLE_INPUT, MAINNET_SINGLE_TO);
    const intents = await verifyIntents({ client: client as never, hash: HASH });
    expect(intents).toEqual([
      {
        sender: MAINNET_SINGLE_ACCOUNT,
        attribution: { codes: [MAINNET_SINGLE_CODE], schemaId: 0 },
      },
    ]);
  });

  it("returns the account with a null attribution for an untagged intent", async () => {
    const client = clientReturning(SEPOLIA_UNTAGGED_INPUT, SEPOLIA_UNTAGGED_TO);
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      { sender: SEPOLIA_UNTAGGED_ACCOUNT, attribution: null },
    ]);
  });

  it("returns null for a transaction that is not an Orchestrator call", async () => {
    const client = clientReturning(toDataSuffix("celo_b7k3p9da"));
    expect(await verifyIntents({ client: client as never, hash: HASH })).toBeNull();
    const bundle = clientReturning(V06_INPUT, V06_TO);
    expect(await verifyIntents({ client: bundle as never, hash: HASH })).toBeNull();
  });

  it("returns null when the RPC throws", async () => {
    const client = clientThatThrows();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toBeNull();
  });
});
