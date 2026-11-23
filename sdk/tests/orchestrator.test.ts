import { describe, it, expect } from "vitest";
import { AbiFunction, AbiParameters } from "ox";
import {
  ORCHESTRATOR_SELECTORS,
  fromDataSuffix,
  fromEntryPointCalldata,
  fromOrchestratorCalldata,
  toDataSuffix,
  toRoleDataSuffix,
} from "../src/index.js";
import {
  MAINNET_MULTI_ACCOUNT,
  MAINNET_MULTI_CODE,
  MAINNET_MULTI_INPUT,
  MAINNET_SINGLE_ACCOUNT,
  MAINNET_SINGLE_CODE,
  MAINNET_SINGLE_INPUT,
  SEPOLIA_PASSKEY_ACCOUNT,
  SEPOLIA_PASSKEY_CODES,
  SEPOLIA_PASSKEY_INPUT,
  SEPOLIA_UNSIGNED_FIELD_ACCOUNT,
  SEPOLIA_UNSIGNED_FIELD_INPUT,
  SEPOLIA_UNTAGGED_ACCOUNT,
  SEPOLIA_UNTAGGED_INPUT,
} from "./fixtures/orchestrator-intents.js";

const EXECUTE = AbiFunction.from("function execute(bytes encodedIntent)");
const EXECUTE_BATCH = AbiFunction.from(
  "function execute(bytes[] encodedIntents)",
);
const INTENT = AbiParameters.from(
  "(address eoa, bytes executionData, uint256 nonce, address payer, address paymentToken, uint256 paymentMaxAmount, uint256 combinedGas, bytes[] encodedPreCalls, bytes[] encodedFundTransfers, address settler, uint256 expiry, bool isMultichain, address funder, bytes funderSignature, bytes settlerContext, uint256 paymentAmount, address paymentRecipient, bytes signature, bytes paymentSignature, address supportedAccountImplementation)",
);
const CALLS = AbiParameters.from("(address to, uint256 value, bytes data)[]");

const ACCOUNT_A = "0x1111111111111111111111111111111111111111" as const;
const ACCOUNT_B = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TRANSFER = ("0xa9059cbb" + "11".repeat(64)) as `0x${string}`;

function tagged(data: `0x${string}`, code: string | string[]): `0x${string}` {
  return (data + toDataSuffix(code).slice(2)) as `0x${string}`;
}

function intent(
  eoa: `0x${string}`,
  calls: readonly `0x${string}`[],
  extra: { paymentSignature?: `0x${string}`; emptyExecutionData?: boolean } = {},
): `0x${string}` {
  const executionData = extra.emptyExecutionData
    ? ("0x" as const)
    : AbiParameters.encode(CALLS, [
        calls.map((data) => ({ to: TOKEN, value: 0n, data })),
      ]);
  return AbiParameters.encode(INTENT, [
    {
      eoa,
      executionData,
      nonce: 1n,
      payer: ZERO,
      paymentToken: ZERO,
      paymentMaxAmount: 0n,
      combinedGas: 100_000n,
      encodedPreCalls: [],
      encodedFundTransfers: [],
      settler: ZERO,
      expiry: 0n,
      isMultichain: false,
      funder: ZERO,
      funderSignature: "0x",
      settlerContext: "0x",
      paymentAmount: 0n,
      paymentRecipient: ZERO,
      signature: ("0x" + "ab".repeat(65)) as `0x${string}`,
      paymentSignature: extra.paymentSignature ?? "0x",
      supportedAccountImplementation: ZERO,
    },
  ]);
}

const single = (encoded: `0x${string}`) =>
  AbiFunction.encodeData(EXECUTE, [encoded]);

describe("fromOrchestratorCalldata — real Celo Mainnet intents", () => {
  it("the outer input is NOT a plain tagged tx, nor a handleOps bundle", () => {
    expect(fromDataSuffix(MAINNET_SINGLE_INPUT)).toBeNull();
    expect(fromEntryPointCalldata(MAINNET_SINGLE_INPUT)).toBeNull();
  });

  it("decodes a single tagged call and credits the account that signed", () => {
    expect(fromOrchestratorCalldata(MAINNET_SINGLE_INPUT)).toEqual([
      {
        sender: MAINNET_SINGLE_ACCOUNT,
        attribution: { codes: [MAINNET_SINGLE_CODE], schemaId: 0 },
      },
    ]);
  });

  it("decodes an intent with several tagged calls (session key)", () => {
    expect(fromOrchestratorCalldata(MAINNET_MULTI_INPUT)).toEqual([
      {
        sender: MAINNET_MULTI_ACCOUNT,
        attribution: { codes: [MAINNET_MULTI_CODE], schemaId: 0 },
      },
    ]);
  });
});

describe("fromOrchestratorCalldata — real Celo Sepolia intents", () => {
  it("decodes an intent signed by a passkey, multi-code", () => {
    expect(fromOrchestratorCalldata(SEPOLIA_PASSKEY_INPUT)).toEqual([
      {
        sender: SEPOLIA_PASSKEY_ACCOUNT,
        attribution: { codes: [...SEPOLIA_PASSKEY_CODES], schemaId: 0 },
      },
    ]);
  });

  it("returns the account with a null attribution for an untagged intent", () => {
    expect(fromOrchestratorCalldata(SEPOLIA_UNTAGGED_INPUT)).toEqual([
      { sender: SEPOLIA_UNTAGGED_ACCOUNT, attribution: null },
    ]);
  });

  it("ignores a tag that is only in a field the account did not sign", () => {
    // The marker is in the input (it is its last 16 bytes), but in the
    // intent's paymentSignature, which a relay fills in. The calls are clean.
    expect(SEPOLIA_UNSIGNED_FIELD_INPUT.endsWith("80218021802180218021802180218021")).toBe(true);
    expect(fromOrchestratorCalldata(SEPOLIA_UNSIGNED_FIELD_INPUT)).toEqual([
      { sender: SEPOLIA_UNSIGNED_FIELD_ACCOUNT, attribution: null },
    ]);
  });
});

describe("fromOrchestratorCalldata — which call is read", () => {
  it("uses the execute(bytes) selector", () => {
    expect(ORCHESTRATOR_SELECTORS.execute).toBe("0x09c5eabe");
    expect(single(intent(ACCOUNT_A, [TRANSFER])).slice(0, 10)).toBe("0x09c5eabe");
  });

  it("finds a tag on the last call of a batch", () => {
    const input = single(
      intent(ACCOUNT_A, [TRANSFER, tagged(TRANSFER, "celo_b7k3p9da")]),
    );
    expect(fromOrchestratorCalldata(input)).toEqual([
      { sender: ACCOUNT_A, attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } },
    ]);
  });

  it("finds a tag on an earlier call when the last one is untagged", () => {
    const input = single(
      intent(ACCOUNT_A, [tagged(TRANSFER, "celo_b7k3p9da"), TRANSFER]),
    );
    expect(fromOrchestratorCalldata(input)![0]!.attribution).toEqual({
      codes: ["celo_b7k3p9da"],
      schemaId: 0,
    });
  });

  it("the last tagged call wins when calls carry different tags", () => {
    const input = single(
      intent(ACCOUNT_A, [
        tagged(TRANSFER, "celo_aaaaaaaa"),
        tagged(TRANSFER, "celo_bbbbbbbb"),
      ]),
    );
    expect(fromOrchestratorCalldata(input)![0]!.attribution?.codes).toEqual([
      "celo_bbbbbbbb",
    ]);
  });

  it("decodes a call whose only data is the tag (a plain value transfer)", () => {
    const input = single(intent(ACCOUNT_A, [toDataSuffix("celo_b7k3p9da")]));
    expect(fromOrchestratorCalldata(input)![0]!.attribution?.codes).toEqual([
      "celo_b7k3p9da",
    ]);
  });

  it("does not read the intent's unsigned fields", () => {
    const input = single(
      intent(ACCOUNT_A, [TRANSFER], {
        paymentSignature: toDataSuffix("celo_b7k3p9da"),
      }),
    );
    expect(fromOrchestratorCalldata(input)).toEqual([
      { sender: ACCOUNT_A, attribution: null },
    ]);
  });

  it("handles an intent with no calls", () => {
    const input = single(intent(ACCOUNT_A, [], { emptyExecutionData: true }));
    expect(fromOrchestratorCalldata(input)).toEqual([
      { sender: ACCOUNT_A, attribution: null },
    ]);
  });
});

describe("fromOrchestratorCalldata — tag shapes", () => {
  it("decodes a role-based (Schema 2) tag on a call", () => {
    const data = (TRANSFER +
      toRoleDataSuffix({ app: "celo_b7k3p9da", wallet: "celo_facil" }).slice(2)) as `0x${string}`;
    expect(fromOrchestratorCalldata(single(intent(ACCOUNT_A, [data])))).toEqual([
      {
        sender: ACCOUNT_A,
        attribution: {
          codes: ["celo_b7k3p9da", "celo_facil"],
          schemaId: 2,
          app: "celo_b7k3p9da",
          wallet: "celo_facil",
        },
      },
    ]);
  });

  it("decodes multi-code", () => {
    const input = single(
      intent(ACCOUNT_A, [tagged(TRANSFER, ["minipay", "celo_b7k3p9da"])]),
    );
    expect(fromOrchestratorCalldata(input)![0]!.attribution?.codes).toEqual([
      "minipay",
      "celo_b7k3p9da",
    ]);
  });

  it("finds a tag wrapped inside a call's own bytes argument (padded after the marker)", () => {
    // e.g. a call to a router or multicall whose argument is the tagged calldata
    const WRAP = AbiFunction.from("function forward(address target, bytes data)");
    const wrapped = AbiFunction.encodeData(WRAP, [
      TOKEN,
      tagged(("0xa9059cbb" + "11".repeat(5)) as `0x${string}`, "celo_b7k3p9da"),
    ]);
    expect(wrapped.endsWith("80218021")).toBe(false);
    expect(fromOrchestratorCalldata(single(intent(ACCOUNT_A, [wrapped])))![0]!.attribution).toEqual({
      codes: ["celo_b7k3p9da"],
      schemaId: 0,
    });
  });

  it("ignores a Schema 1 (custom registry) tag, like fromDataSuffix", () => {
    // codes "x", custom registry on chain 1: registry(20) chainId(1) chainIdLen(1) codes(1) codesLen(1) schema 0x01 marker
    const schema1 = ("0x" + "44".repeat(20) + "01" + "01" + "78" + "01" + "01" +
      "80218021802180218021802180218021") as `0x${string}`;
    expect(fromOrchestratorCalldata(single(intent(ACCOUNT_A, [(TRANSFER + schema1.slice(2)) as `0x${string}`])))).toEqual([
      { sender: ACCOUNT_A, attribution: null },
    ]);
  });

  it("accepts an upper-case hex input", () => {
    const input = single(intent(ACCOUNT_A, [tagged(TRANSFER, "celo_b7k3p9da")]));
    const upper = ("0x" + input.slice(2).toUpperCase()) as `0x${string}`;
    expect(fromOrchestratorCalldata(upper)![0]!.attribution?.codes).toEqual(["celo_b7k3p9da"]);
  });
});

describe("fromOrchestratorCalldata — execute(bytes[]) batches", () => {
  const input = AbiFunction.encodeData(EXECUTE_BATCH, [
    [
      intent(ACCOUNT_A, [tagged(TRANSFER, "celo_b7k3p9da")]),
      intent(ACCOUNT_B, [TRANSFER]),
    ],
  ]);

  it("uses the batch selector", () => {
    expect(input.slice(0, 10)).toBe(ORCHESTRATOR_SELECTORS.executeBatch);
  });

  it("returns one entry per intent, in order, untagged intents as null", () => {
    expect(fromOrchestratorCalldata(input)).toEqual([
      { sender: ACCOUNT_A, attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } },
      { sender: ACCOUNT_B, attribution: null },
    ]);
  });
});

describe("fromOrchestratorCalldata — not an Orchestrator call", () => {
  it("returns null for a plain contract call", () => {
    expect(fromOrchestratorCalldata("0xa9059cbb000000000000000000000000aaaa")).toBeNull();
  });

  it("returns null for empty / too-short input", () => {
    expect(fromOrchestratorCalldata("0x")).toBeNull();
    expect(fromOrchestratorCalldata("0x09c5")).toBeNull();
  });

  it("returns null for a truncated execute call (never throws)", () => {
    const truncated = MAINNET_SINGLE_INPUT.slice(0, 200) as `0x${string}`;
    expect(fromOrchestratorCalldata(truncated)).toBeNull();
  });

  it("returns null when the bytes are not an intent (never throws)", () => {
    const junk = single(("0x" + "ff".repeat(96)) as `0x${string}`);
    expect(fromOrchestratorCalldata(junk)).toBeNull();
  });
});
