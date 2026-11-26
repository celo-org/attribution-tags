// Builders for synthetic EntryPoint handleOps calls and their receipts, shared
// by the ERC-4337 tests. Layouts mirror EntryPoint v0.6 and v0.7+.
import { AbiFunction } from "ox";
import { USER_OPERATION_EVENT_TOPIC, toDataSuffix } from "../../src/index.js";

const HANDLE_OPS_V07 = AbiFunction.from(
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
);

export const SENDER_A = "0x1111111111111111111111111111111111111111" as const;
export const SENDER_B = "0x2222222222222222222222222222222222222222" as const;
export const BENEFICIARY = "0x3333333333333333333333333333333333333333" as const;
const ZERO32 = ("0x" + "00".repeat(32)) as `0x${string}`;

/** An account call (execute) whose data ends with the given code's suffix. */
export function taggedCall(code: string): `0x${string}` {
  return ("0xa9059cbb" + "11".repeat(64) + toDataSuffix(code).slice(2)) as `0x${string}`;
}
export const UNTAGGED_CALL = ("0xa9059cbb" + "11".repeat(64)) as `0x${string}`;

export function op(sender: `0x${string}`, callData: `0x${string}`, nonce = 1n) {
  return { sender, nonce, callData };
}

/** handleOps (v0.7 layout) with the given ops. Signatures are junk: nobody signed. */
export function bundle(ops: readonly ReturnType<typeof op>[]): `0x${string}` {
  return AbiFunction.encodeData(HANDLE_OPS_V07, [
    ops.map((o) => ({
      sender: o.sender,
      nonce: o.nonce,
      initCode: "0x" as const,
      callData: o.callData,
      accountGasLimits: ZERO32,
      preVerificationGas: 0n,
      gasFees: ZERO32,
      paymasterAndData: "0x" as const,
      signature: ("0x" + "ab".repeat(65)) as `0x${string}`,
    })),
    BENEFICIARY,
  ]);
}

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

/**
 * A UserOperationEvent log as an RPC returns it:
 * UserOperationEvent(bytes32 indexed userOpHash, address indexed sender,
 * address indexed paymaster, uint256 nonce, bool success,
 * uint256 actualGasCost, uint256 actualGasUsed)
 */
export function userOpEvent(args: {
  address: string;
  sender: string;
  nonce?: bigint;
  success?: boolean;
  topic0?: string;
}) {
  return {
    address: args.address,
    topics: [
      args.topic0 ?? USER_OPERATION_EVENT_TOPIC,
      `0x${"cd".repeat(32)}`,
      `0x${word(args.sender)}`,
      `0x${word("0")}`,
    ],
    data:
      "0x" +
      word((args.nonce ?? 1n).toString(16)) +
      word(args.success === false ? "0" : "1") +
      word("1234") +
      word("5678"),
  };
}
