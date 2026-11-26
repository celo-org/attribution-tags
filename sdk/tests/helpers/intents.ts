// Builders for synthetic Orchestrator calls and receipts, shared by the
// intent tests. The layouts mirror Orchestrator 0.5.x.
import { AbiFunction, AbiParameters } from "ox";
import { INTENT_EXECUTED_TOPIC, toDataSuffix } from "../../src/index.js";

export const EXECUTE = AbiFunction.from("function execute(bytes encodedIntent)");
export const EXECUTE_BATCH = AbiFunction.from(
  "function execute(bytes[] encodedIntents)",
);
const INTENT = AbiParameters.from(
  "(address eoa, bytes executionData, uint256 nonce, address payer, address paymentToken, uint256 paymentMaxAmount, uint256 combinedGas, bytes[] encodedPreCalls, bytes[] encodedFundTransfers, address settler, uint256 expiry, bool isMultichain, address funder, bytes funderSignature, bytes settlerContext, uint256 paymentAmount, address paymentRecipient, bytes signature, bytes paymentSignature, address supportedAccountImplementation)",
);
const CALLS = AbiParameters.from("(address to, uint256 value, bytes data)[]");

export const ACCOUNT_A = "0x1111111111111111111111111111111111111111" as const;
export const ACCOUNT_B = "0x2222222222222222222222222222222222222222" as const;
export const TOKEN = "0x3333333333333333333333333333333333333333" as const;
export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const TRANSFER = ("0xa9059cbb" + "11".repeat(64)) as `0x${string}`;

export function tagged(
  data: `0x${string}`,
  code: string | string[],
): `0x${string}` {
  return (data + toDataSuffix(code).slice(2)) as `0x${string}`;
}

export function intent(
  eoa: `0x${string}`,
  calls: readonly `0x${string}`[],
  extra: {
    nonce?: bigint;
    paymentSignature?: `0x${string}`;
    emptyExecutionData?: boolean;
  } = {},
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
      nonce: extra.nonce ?? 1n,
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
      // Not a real signature: these intents were never signed by anyone.
      signature: ("0x" + "ab".repeat(65)) as `0x${string}`,
      paymentSignature: extra.paymentSignature ?? "0x",
      supportedAccountImplementation: ZERO,
    },
  ]);
}

export const single = (encoded: `0x${string}`) =>
  AbiFunction.encodeData(EXECUTE, [encoded]);

export const batch = (encoded: readonly `0x${string}`[]) =>
  AbiFunction.encodeData(EXECUTE_BATCH, [encoded]);

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

/** An IntentExecuted log as an RPC returns it. */
export function intentExecutedLog(args: {
  address: string;
  eoa: string;
  nonce?: bigint;
  incremented?: boolean;
  err?: string;
}) {
  return {
    address: args.address,
    topics: [
      INTENT_EXECUTED_TOPIC,
      `0x${word(args.eoa)}`,
      `0x${word((args.nonce ?? 1n).toString(16))}`,
    ],
    data: `0x${word(args.incremented === false ? "0" : "1")}${(args.err ?? "0x00000000").slice(2).padEnd(64, "0")}`,
  };
}
