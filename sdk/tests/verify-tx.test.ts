import { describe, it, expect } from "vitest";
import { toDataSuffix, verifyTx } from "../src/index.js";

type StubClient = {
  getTransaction: (args: { hash: `0x${string}` }) => Promise<{ input: `0x${string}` } | null>;
};

function clientReturning(input: `0x${string}` | null): StubClient {
  return {
    getTransaction: async () => (input === null ? null : { input }),
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
