import { describe, it, expect } from "vitest";
import {
  toDataSuffix,
  verifyIntents,
  verifyTx,
  verifyUserOps,
} from "../src/index.js";
import {
  ORCHESTRATOR_ADDRESSES,
} from "../src/index.js";
import {
  MAINNET_MULTI_ACCOUNT,
  MAINNET_MULTI_CODE,
  MAINNET_MULTI_INPUT,
  MAINNET_MULTI_RECEIPT,
  MAINNET_MULTI_TO,
  MAINNET_SINGLE_ACCOUNT,
  MAINNET_SINGLE_CODE,
  MAINNET_SINGLE_INPUT,
  MAINNET_SINGLE_RECEIPT,
  MAINNET_SINGLE_TO,
  SEPOLIA_PASSKEY_ACCOUNT,
  SEPOLIA_PASSKEY_CODES,
  SEPOLIA_PASSKEY_INPUT,
  SEPOLIA_PASSKEY_RECEIPT,
  SEPOLIA_PASSKEY_TO,
  SEPOLIA_UNSIGNED_FIELD_INPUT,
  SEPOLIA_UNSIGNED_FIELD_RECEIPT,
  SEPOLIA_UNSIGNED_FIELD_TO,
  SEPOLIA_UNTAGGED_ACCOUNT,
  SEPOLIA_UNTAGGED_INPUT,
  SEPOLIA_UNTAGGED_RECEIPT,
  SEPOLIA_UNTAGGED_TO,
} from "./fixtures/orchestrator-intents.js";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TRANSFER,
  batch,
  intent,
  intentExecutedLog,
  single,
  tagged,
} from "./helpers/intents.js";
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

// ---------------------------------------------------------------------------
// Relayed intents (Orchestrator.execute)
// ---------------------------------------------------------------------------

type Receipt = {
  status: unknown;
  logs: readonly { address: string; topics: readonly string[]; data: string }[];
};

function relayed(
  input: `0x${string}`,
  to: string,
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

const ORCHESTRATOR = ORCHESTRATOR_ADDRESSES.celo;
const CODE = "celo_b7k3p9da";
const TAGGED_INTENT = single(intent(ACCOUNT_A, [tagged(TRANSFER, CODE)]));
const ok = (logs: Receipt["logs"]): Receipt => ({ status: "success", logs });
const executedA = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A });

describe("verifyTx — relayed intents, real transactions with their receipts", () => {
  it("credits the account for a tagged, executed intent (Celo Mainnet)", async () => {
    const client = relayed(MAINNET_SINGLE_INPUT, MAINNET_SINGLE_TO, MAINNET_SINGLE_RECEIPT);
    expect(await verifyTx({ client: client as never, hash: HASH })).toEqual({
      codes: [MAINNET_SINGLE_CODE],
      schemaId: 0,
      sender: MAINNET_SINGLE_ACCOUNT,
    });
  });

  it("credits a session-key intent with several tagged calls (Celo Mainnet)", async () => {
    const client = relayed(MAINNET_MULTI_INPUT, MAINNET_MULTI_TO, MAINNET_MULTI_RECEIPT);
    expect(await verifyTx({ client: client as never, hash: HASH })).toEqual({
      codes: [MAINNET_MULTI_CODE],
      schemaId: 0,
      sender: MAINNET_MULTI_ACCOUNT,
    });
  });

  it("credits an intent signed by a passkey (Celo Sepolia)", async () => {
    const client = relayed(SEPOLIA_PASSKEY_INPUT, SEPOLIA_PASSKEY_TO, SEPOLIA_PASSKEY_RECEIPT);
    expect(await verifyTx({ client: client as never, hash: HASH })).toEqual({
      codes: [...SEPOLIA_PASSKEY_CODES],
      schemaId: 0,
      sender: SEPOLIA_PASSKEY_ACCOUNT,
    });
  });

  it("returns null for an executed intent with no tag (Celo Sepolia)", async () => {
    const client = relayed(SEPOLIA_UNTAGGED_INPUT, SEPOLIA_UNTAGGED_TO, SEPOLIA_UNTAGGED_RECEIPT);
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("the fixtures target the exported Orchestrator deployments", () => {
    expect(MAINNET_SINGLE_TO).toBe(ORCHESTRATOR_ADDRESSES.celo.toLowerCase());
    expect(SEPOLIA_PASSKEY_TO).toBe(ORCHESTRATOR_ADDRESSES.celoSepolia.toLowerCase());
  });

  it("a tag at the very end of the outer input is read as for any transaction, with no sender", async () => {
    // Unchanged behaviour: the end of the outer input is checked first. Here
    // the tail tag is outside the account's calls, so no account is named;
    // verifyIntents reports the intent itself as untagged.
    const client = relayed(SEPOLIA_UNSIGNED_FIELD_INPUT, SEPOLIA_UNSIGNED_FIELD_TO, SEPOLIA_UNSIGNED_FIELD_RECEIPT);
    const result = await verifyTx({ client: client as never, hash: HASH });
    expect(result).toEqual({ codes: ["altana", "altana_test"], schemaId: 0 });
    expect(result).not.toHaveProperty("sender");
    const intents = await verifyIntents({ client: client as never, hash: HASH });
    expect(intents![0]!.attribution).toBeNull();
  });
});

describe("verifyTx — a forged intent is not credited", () => {
  it("credits a synthetic intent only with a matching IntentExecuted log (control)", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([executedA]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toEqual({
      codes: [CODE],
      schemaId: 0,
      sender: ACCOUNT_A,
    });
  });

  it("execute calldata sent to an EOA or an unknown contract is not read", async () => {
    // The transaction succeeds and even carries a look-alike log: it still
    // is not an Orchestrator call.
    const elsewhere = "0x9999999999999999999999999999999999999999";
    const client = relayed(
      TAGGED_INTENT,
      elsewhere,
      ok([intentExecutedLog({ address: elsewhere, eoa: ACCOUNT_A })]),
    );
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a transaction with no `to` is not read", async () => {
    const client = {
      getTransaction: async () => ({ input: TAGGED_INTENT, to: null }),
      getTransactionReceipt: async () => ok([executedA]),
    };
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a reverted transaction credits nobody", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, { status: "reverted", logs: [executedA] });
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      { sender: ACCOUNT_A, attribution: null },
    ]);
  });

  it("an intent the Orchestrator rejected (err != 0) credits nobody", async () => {
    // The Orchestrator returns an error code without reverting, so the
    // transaction itself succeeds.
    const rejected = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A, incremented: false, err: "0x8baa579f" });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([rejected]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("err != 0 with the nonce consumed still credits nobody", async () => {
    const failed = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A, incremented: true, err: "0xad4db224" });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([failed]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("err == 0 but the nonce not incremented credits nobody", async () => {
    const odd = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A, incremented: false });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([odd]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("no IntentExecuted log credits nobody", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a log for another account does not count", async () => {
    const other = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_B });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([other]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a log for another nonce does not count", async () => {
    const other = intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A, nonce: 2n });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([other]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a matching log emitted by another contract does not count", async () => {
    const spoof = intentExecutedLog({ address: "0x9999999999999999999999999999999999999999", eoa: ACCOUNT_A });
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([spoof]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("another event from the Orchestrator with the same topics layout does not count", async () => {
    const wrongEvent = { ...executedA, topics: [("0x" + "12".repeat(32)), ...executedA.topics.slice(1)] };
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([wrongEvent]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a truncated log does not count (never throws)", async () => {
    const short = { ...executedA, data: "0x01" };
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, ok([short]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a client that cannot fetch receipts credits nobody", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, "none");
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      { sender: ACCOUNT_A, attribution: null },
    ]);
  });

  it("a missing receipt credits nobody", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, null);
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });

  it("returns null when the receipt RPC throws (does not propagate)", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, "throws");
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toBeNull();
  });

  it("a real, executed transaction is not credited when its receipt is swapped for another's", async () => {
    const client = relayed(MAINNET_SINGLE_INPUT, MAINNET_SINGLE_TO, MAINNET_MULTI_RECEIPT);
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
  });
});

describe("verifyTx — relayed intents, accepted deployments and inputs", () => {
  it("accepts an extra Orchestrator passed by the caller", async () => {
    const mine = "0x7777777777777777777777777777777777777777";
    const client = relayed(TAGGED_INTENT, mine, ok([intentExecutedLog({ address: mine, eoa: ACCOUNT_A })]));
    expect(await verifyTx({ client: client as never, hash: HASH })).toBeNull();
    expect(
      await verifyTx({ client: client as never, hash: HASH, orchestrators: [mine.toUpperCase().replace("0X", "0x")] }),
    ).toEqual({ codes: [CODE], schemaId: 0, sender: ACCOUNT_A });
  });

  it("matches addresses whatever their casing", async () => {
    const client = relayed(
      TAGGED_INTENT,
      ORCHESTRATOR.toLowerCase(),
      ok([intentExecutedLog({ address: ORCHESTRATOR.toUpperCase().replace("0X", "0x"), eoa: ACCOUNT_A.toUpperCase().replace("0X", "0x") })]),
    );
    expect((await verifyTx({ client: client as never, hash: HASH }))?.sender).toBe(ACCOUNT_A);
  });

  it("accepts a receipt status of 0x1", async () => {
    const client = relayed(TAGGED_INTENT, ORCHESTRATOR, { status: "0x1", logs: [executedA] });
    expect((await verifyTx({ client: client as never, hash: HASH }))?.codes).toEqual([CODE]);
  });

  it("in a batch, only the executed intent is credited", async () => {
    // A is tagged but was rejected; B is tagged and ran.
    const input = batch([
      intent(ACCOUNT_A, [tagged(TRANSFER, "celo_aaaaaaaa")]),
      intent(ACCOUNT_B, [tagged(TRANSFER, "celo_bbbbbbbb")], { nonce: 7n }),
    ]);
    const receipt = ok([
      intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_A, incremented: false, err: "0x8baa579f" }),
      intentExecutedLog({ address: ORCHESTRATOR, eoa: ACCOUNT_B, nonce: 7n }),
    ]);
    const client = relayed(input, ORCHESTRATOR, receipt);
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      { sender: ACCOUNT_A, attribution: null },
      { sender: ACCOUNT_B, attribution: { codes: ["celo_bbbbbbbb"], schemaId: 0 } },
    ]);
    expect(await verifyTx({ client: client as never, hash: HASH })).toEqual({
      codes: ["celo_bbbbbbbb"],
      schemaId: 0,
      sender: ACCOUNT_B,
    });
  });
});

describe("verifyIntents", () => {
  it("returns every intent with the account that signed it (real Mainnet tx)", async () => {
    const client = relayed(MAINNET_SINGLE_INPUT, MAINNET_SINGLE_TO, MAINNET_SINGLE_RECEIPT);
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      {
        sender: MAINNET_SINGLE_ACCOUNT,
        attribution: { codes: [MAINNET_SINGLE_CODE], schemaId: 0 },
      },
    ]);
  });

  it("returns the account with a null attribution for an untagged intent", async () => {
    const client = relayed(SEPOLIA_UNTAGGED_INPUT, SEPOLIA_UNTAGGED_TO, SEPOLIA_UNTAGGED_RECEIPT);
    expect(await verifyIntents({ client: client as never, hash: HASH })).toEqual([
      { sender: SEPOLIA_UNTAGGED_ACCOUNT, attribution: null },
    ]);
  });

  it("returns null for a transaction that is not an Orchestrator call", async () => {
    const plain = clientReturning(toDataSuffix("celo_b7k3p9da"));
    expect(await verifyIntents({ client: plain as never, hash: HASH })).toBeNull();
    const bundle = clientReturning(V06_INPUT, V06_TO);
    expect(await verifyIntents({ client: bundle as never, hash: HASH })).toBeNull();
    const otherFn = relayed("0xa9059cbb000000000000000000000000aaaa", ORCHESTRATOR, ok([]));
    expect(await verifyIntents({ client: otherFn as never, hash: HASH })).toBeNull();
  });

  it("returns null when the RPC throws", async () => {
    const client = clientThatThrows();
    expect(await verifyIntents({ client: client as never, hash: HASH })).toBeNull();
  });
});
