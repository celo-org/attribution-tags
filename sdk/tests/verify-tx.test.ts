import { describe, it, expect } from "vitest";
import { toDataSuffix, verifyTx, verifyUserOps } from "../src/index.js";
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
