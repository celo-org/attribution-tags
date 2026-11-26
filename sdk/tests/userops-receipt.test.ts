import { describe, it, expect } from "vitest";
import {
  ENTRY_POINT_ADDRESSES,
  USER_OPERATION_EVENT_TOPIC,
  fromEntryPointCalldata,
  toDataSuffix,
  verifyTx,
  verifyUserOps,
} from "../src/index.js";
import {
  V06_CODE,
  V06_INPUT,
  V06_SENDER,
  V06_TO,
} from "./fixtures/entrypoint-v06-handleops.js";
import {
  V06_RECEIPT,
  V07_FAILED_INPUT,
  V07_FAILED_RECEIPT,
  V07_FAILED_TO,
  V07_MULTI_INPUT,
  V07_MULTI_RECEIPT,
  V07_MULTI_TO,
  V07_PARTIAL_INPUT,
  V07_PARTIAL_RECEIPT,
  V07_PARTIAL_TO,
  V07_SINGLE_INPUT,
  V07_SINGLE_RECEIPT,
  V07_SINGLE_TO,
} from "./fixtures/entrypoint-receipts.js";
import {
  SENDER_A,
  SENDER_B,
  UNTAGGED_CALL,
  bundle,
  op,
  taggedCall,
  userOpEvent,
} from "./helpers/userops.js";

type Log = { address: string; topics: readonly string[]; data: string };
type Receipt = { status: unknown; logs: readonly Log[] };

const HASH = ("0x" + "a".repeat(64)) as `0x${string}`;

function client(
  input: `0x${string}`,
  to: string | null,
  receipt: Receipt | null | "throws" | "none",
) {
  return {
    getTransaction: async () => ({ input, to }),
    ...(receipt === "none"
      ? {}
      : {
          getTransactionReceipt: async () => {
            if (receipt === "throws") throw new Error("RPC down");
            return receipt;
          },
        }),
  };
}

const EP = ENTRY_POINT_ADDRESSES.v0_7;
const CODE = "celo_b7k3p9da";
const TAGGED_A = bundle([op(SENDER_A, taggedCall(CODE))]);
const ok = (logs: readonly Log[]): Receipt => ({ status: "success", logs });
const ranA = userOpEvent({ address: EP, sender: SENDER_A });
const credited = { codes: [CODE], schemaId: 0, sender: SENDER_A };

const verify = (c: ReturnType<typeof client>, extra = {}) =>
  verifyTx({ client: c, hash: HASH, ...extra });
const ops = (c: ReturnType<typeof client>, extra = {}) =>
  verifyUserOps({ client: c, hash: HASH, ...extra });

describe("ERC-4337, real Celo Mainnet bundles with their receipts", () => {
  it("credits the executed op of a v0.6 bundle", async () => {
    expect(await verify(client(V06_INPUT, V06_TO, V06_RECEIPT))).toEqual({
      codes: [V06_CODE],
      schemaId: 0,
      sender: V06_SENDER,
    });
  });

  it("credits the executed op of a v0.7 bundle", async () => {
    expect(await verify(client(V07_SINGLE_INPUT, V07_SINGLE_TO, V07_SINGLE_RECEIPT))).toEqual({
      codes: ["celina", "goclaim"],
      schemaId: 0,
      sender: "0x2ce2d89dff84ce1e22e2b58cf42b28a0221dea48",
    });
  });

  it("credits every op of a five-op v0.7 bundle, each with its own account", async () => {
    const result = await ops(client(V07_MULTI_INPUT, V07_MULTI_TO, V07_MULTI_RECEIPT));
    expect(result).toHaveLength(5);
    expect(result!.map((o) => o.sender)).toEqual(
      fromEntryPointCalldata(V07_MULTI_INPUT)!.map((o) => o.sender),
    );
    for (const o of result!) {
      expect(o.attribution).toEqual({ codes: ["celina", "goclaim"], schemaId: 0 });
    }
  });

  it("does not credit an op whose execution reverted (success = false)", async () => {
    const c = client(V07_FAILED_INPUT, V07_FAILED_TO, V07_FAILED_RECEIPT);
    expect(await verify(c)).toBeNull();
    expect(await ops(c)).toEqual([
      { sender: "0x7404bd0514462abac14ce50f8851266ae0788ef4", attribution: null },
    ]);
  });

  it("in a bundle with one executed and one reverted op, only the executed one is credited", async () => {
    const c = client(V07_PARTIAL_INPUT, V07_PARTIAL_TO, V07_PARTIAL_RECEIPT);
    const tag = { codes: ["celina", "canvassing"], schemaId: 0 };
    const sender = "0x1e09b3a8b1498a7b40e9a0a5e78342fcf026a1e7";
    expect(await ops(c)).toEqual([
      { sender, attribution: tag },
      { sender, attribution: null },
    ]);
    expect(await verify(c)).toEqual({ ...tag, sender });
  });

  it("the fixtures target the exported EntryPoints and carry the exported event topic", () => {
    expect(V06_TO).toBe(ENTRY_POINT_ADDRESSES.v0_6.toLowerCase());
    expect(V07_SINGLE_TO).toBe(ENTRY_POINT_ADDRESSES.v0_7.toLowerCase());
    expect(
      V07_SINGLE_RECEIPT.logs.filter((l) => l.topics[0] === USER_OPERATION_EVENT_TOPIC),
    ).toHaveLength(1);
  });

  it("a real bundle is not credited when its receipt is swapped for another bundle's", async () => {
    expect(await verify(client(V07_SINGLE_INPUT, V07_SINGLE_TO, V07_MULTI_RECEIPT))).toBeNull();
  });
});

describe("ERC-4337, a forged bundle is not credited", () => {
  it("credits a synthetic op with its own successful UserOperationEvent (control)", async () => {
    expect(await verify(client(TAGGED_A, EP, ok([ranA])))).toEqual(credited);
  });

  it("handleOps calldata sent to a non-EntryPoint address is not read", async () => {
    // Celo Mainnet has a successful handleOps call to the precompile 0x…01.
    for (const to of [
      "0x0000000000000000000000000000000000000001",
      "0x7079253c0358ef9fd87e16488299ef6e06f403b6",
    ]) {
      const c = client(TAGGED_A, to, ok([userOpEvent({ address: to, sender: SENDER_A })]));
      expect(await verify(c)).toBeNull();
      expect(await ops(c)).toBeNull();
    }
  });

  it("a transaction with no `to` is not read", async () => {
    expect(await verify(client(TAGGED_A, null, ok([ranA])))).toBeNull();
  });

  it("a reverted transaction credits nobody", async () => {
    const c = client(TAGGED_A, EP, { status: "reverted", logs: [ranA] });
    expect(await verify(c)).toBeNull();
    expect(await ops(c)).toEqual([{ sender: SENDER_A, attribution: null }]);
  });

  it("no UserOperationEvent credits nobody", async () => {
    expect(await verify(client(TAGGED_A, EP, ok([])))).toBeNull();
  });

  it("an event for another account does not count", async () => {
    const c = client(TAGGED_A, EP, ok([userOpEvent({ address: EP, sender: SENDER_B })]));
    expect(await verify(c)).toBeNull();
  });

  it("an event for another nonce does not count", async () => {
    const c = client(TAGGED_A, EP, ok([userOpEvent({ address: EP, sender: SENDER_A, nonce: 2n })]));
    expect(await verify(c)).toBeNull();
  });

  it("a matching event emitted by another contract does not count", async () => {
    const c = client(
      TAGGED_A,
      EP,
      ok([userOpEvent({ address: ENTRY_POINT_ADDRESSES.v0_6, sender: SENDER_A })]),
    );
    expect(await verify(c)).toBeNull();
  });

  it("another event from the EntryPoint with the same layout does not count", async () => {
    const c = client(
      TAGGED_A,
      EP,
      ok([userOpEvent({ address: EP, sender: SENDER_A, topic0: "0x" + "ee".repeat(32) })]),
    );
    expect(await verify(c)).toBeNull();
  });

  it("a truncated event does not count (never throws)", async () => {
    const log = { ...ranA, data: ranA.data.slice(0, 66) };
    expect(await verify(client(TAGGED_A, EP, ok([log])))).toBeNull();
    const noTopics = { ...ranA, topics: ranA.topics.slice(0, 2) };
    expect(await verify(client(TAGGED_A, EP, ok([noTopics])))).toBeNull();
  });

  it("a client that cannot fetch receipts credits nobody from a bundle", async () => {
    expect(await verify(client(TAGGED_A, EP, "none"))).toBeNull();
  });

  it("a client that cannot fetch receipts still verifies a plain tagged tx", async () => {
    const plain = toDataSuffix(CODE);
    expect(await verify(client(plain, "0x4444444444444444444444444444444444444444", "none"))).toEqual({
      codes: [CODE],
      schemaId: 0,
    });
  });

  it("a missing receipt credits nobody", async () => {
    expect(await verify(client(TAGGED_A, EP, null))).toBeNull();
  });

  it("returns null when the receipt RPC throws (does not propagate)", async () => {
    const c = client(TAGGED_A, EP, "throws");
    expect(await verify(c)).toBeNull();
    expect(await ops(c)).toBeNull();
  });
});

describe("ERC-4337, each op is paired with its own event, strictly", () => {
  it("one event short: nothing in the bundle is credited", async () => {
    const input = bundle([op(SENDER_A, taggedCall(CODE)), op(SENDER_B, UNTAGGED_CALL)]);
    const c = client(input, EP, ok([ranA]));
    expect(await verify(c)).toBeNull();
    expect(await ops(c)).toEqual([
      { sender: SENDER_A, attribution: null },
      { sender: SENDER_B, attribution: null },
    ]);
  });

  it("one event too many: nothing in the bundle is credited", async () => {
    const c = client(TAGGED_A, EP, ok([ranA, userOpEvent({ address: EP, sender: SENDER_B })]));
    expect(await verify(c)).toBeNull();
  });

  it("a forged copy in front of the genuine op cannot borrow its event", async () => {
    // A real EntryPoint reverts the whole bundle when an op fails validation,
    // so a forged copy can only appear next to a single genuine event.
    const input = bundle([op(SENDER_A, taggedCall("celo_attacker1")), op(SENDER_A, UNTAGGED_CALL)]);
    expect(await verify(client(input, EP, ok([ranA])))).toBeNull();
  });

  it("events in a different order than the ops credit nothing", async () => {
    const input = bundle([op(SENDER_A, taggedCall(CODE)), op(SENDER_B, taggedCall(CODE))]);
    const c = client(
      input,
      EP,
      ok([userOpEvent({ address: EP, sender: SENDER_B }), ranA]),
    );
    expect(await verify(c)).toBeNull();
  });

  it("the first tagged op that executed is credited, skipping a reverted one before it", async () => {
    const input = bundle([
      op(SENDER_A, taggedCall("celo_reverted1")),
      op(SENDER_B, taggedCall(CODE)),
    ]);
    const c = client(
      input,
      EP,
      ok([
        userOpEvent({ address: EP, sender: SENDER_A, success: false }),
        userOpEvent({ address: EP, sender: SENDER_B }),
      ]),
    );
    expect(await verify(c)).toEqual({ codes: [CODE], schemaId: 0, sender: SENDER_B });
  });

  it("logs from other contracts between the events do not shift the pairing", async () => {
    const input = bundle([op(SENDER_A, UNTAGGED_CALL), op(SENDER_B, taggedCall(CODE))]);
    const transfer = { address: "0x5555555555555555555555555555555555555555", topics: ["0x" + "ff".repeat(32)], data: "0x" };
    const c = client(
      input,
      EP,
      ok([transfer, ranA, transfer, userOpEvent({ address: EP, sender: SENDER_B }), transfer]),
    );
    expect(await verify(c)).toEqual({ codes: [CODE], schemaId: 0, sender: SENDER_B });
  });
});

describe("ERC-4337, accepted EntryPoints and inputs", () => {
  it("accepts the canonical v0.6, v0.7, v0.8 and v0.9 EntryPoints", async () => {
    expect(Object.keys(ENTRY_POINT_ADDRESSES)).toEqual(["v0_6", "v0_7", "v0_8", "v0_9"]);
    for (const ep of Object.values(ENTRY_POINT_ADDRESSES)) {
      const c = client(TAGGED_A, ep, ok([userOpEvent({ address: ep, sender: SENDER_A })]));
      expect(await verify(c)).toEqual(credited);
    }
  });

  it("accepts an extra EntryPoint passed by the caller, and only then", async () => {
    const custom = "0x7079253c0358ef9fd87e16488299ef6e06f403b6";
    const c = client(TAGGED_A, custom, ok([userOpEvent({ address: custom, sender: SENDER_A })]));
    expect(await verify(c)).toBeNull();
    expect(await verify(c, { entryPoints: [custom] })).toEqual(credited);
    expect(await ops(c, { entryPoints: [custom] })).toEqual([
      { sender: SENDER_A, attribution: { codes: [CODE], schemaId: 0 } },
    ]);
  });

  it("matches addresses whatever their casing", async () => {
    const c = client(
      TAGGED_A,
      EP.toUpperCase().replace("0X", "0x"),
      ok([userOpEvent({ address: EP.toLowerCase(), sender: SENDER_A.toUpperCase().replace("0X", "0x") })]),
    );
    expect(await verify(c)).toEqual(credited);
  });

  it("accepts a receipt status of 0x1 or 1", async () => {
    for (const status of ["0x1", 1]) {
      expect(await verify(client(TAGGED_A, EP, { status, logs: [ranA] }))).toEqual(credited);
    }
  });

  it("the offline decoder still returns what the calldata claims (unverified)", () => {
    expect(fromEntryPointCalldata(TAGGED_A)).toEqual([
      { sender: SENDER_A, attribution: { codes: [CODE], schemaId: 0 } },
    ]);
  });
});
