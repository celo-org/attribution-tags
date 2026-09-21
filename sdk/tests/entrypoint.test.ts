import { describe, it, expect } from "vitest";
import { AbiFunction } from "ox";
import {
  ENTRY_POINT_ADDRESSES,
  fromDataSuffix,
  fromEntryPointCalldata,
  toDataSuffix,
} from "../src/index.js";
import {
  V06_CODE,
  V06_INPUT,
  V06_SENDER,
  V06_TO,
} from "./fixtures/entrypoint-v06-handleops.js";

const HANDLE_OPS_V07 = AbiFunction.from(
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
);

const SENDER_A = "0x1111111111111111111111111111111111111111" as const;
const SENDER_B = "0x2222222222222222222222222222222222222222" as const;
const ZERO32 = ("0x" + "0".repeat(64)) as `0x${string}`;

function packedOp(sender: `0x${string}`, callData: `0x${string}`) {
  return {
    sender,
    nonce: 1n,
    initCode: "0x" as const,
    callData,
    accountGasLimits: ZERO32,
    preVerificationGas: 0n,
    gasFees: ZERO32,
    paymasterAndData: "0x" as const,
    signature: "0x" as const,
  };
}

describe("fromEntryPointCalldata — EntryPoint v0.6 (real Mainnet bundle)", () => {
  it("the outer input is NOT a plain tagged tx", () => {
    expect(fromDataSuffix(V06_INPUT)).toBeNull();
  });

  it("decodes the single UserOperation with its sender and code", () => {
    const ops = fromEntryPointCalldata(V06_INPUT);
    expect(ops).toHaveLength(1);
    expect(ops![0]).toEqual({
      sender: V06_SENDER,
      attribution: { codes: [V06_CODE], schemaId: 0 },
    });
  });

  it("the fixture targets the canonical v0.6 EntryPoint", () => {
    expect(V06_TO).toBe(ENTRY_POINT_ADDRESSES.v0_6.toLowerCase());
  });
});

describe("fromEntryPointCalldata — EntryPoint v0.7 (PackedUserOperation)", () => {
  const tagged = ("0xa9059cbb" + toDataSuffix("celo_b7k3p9da").slice(2)) as `0x${string}`;
  const untagged = "0xa9059cbb0000" as const;
  const input = AbiFunction.encodeData(HANDLE_OPS_V07, [
    [packedOp(SENDER_A, tagged), packedOp(SENDER_B, untagged)],
    "0x3333333333333333333333333333333333333333",
  ]);

  it("uses the v0.7 selector", () => {
    expect(input.slice(0, 10)).toBe("0x765e827f");
  });

  it("returns one entry per op, in bundle order, untagged ops as null", () => {
    expect(fromEntryPointCalldata(input)).toEqual([
      { sender: SENDER_A, attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } },
      { sender: SENDER_B, attribution: null },
    ]);
  });
});

describe("fromEntryPointCalldata — suffix inside the account's execute() call", () => {
  // Most smart accounts expose execute(address,uint256,bytes); the app's
  // tagged calldata is the bytes argument, zero-padded to 32 bytes by ABI
  // encoding. The marker is therefore not at the end of callData.
  const EXECUTE = AbiFunction.from(
    "function execute(address dest, uint256 value, bytes func)",
  );
  const inner = ("0xa9059cbb" + "11".repeat(5) + toDataSuffix("celo_b7k3p9da").slice(2)) as `0x${string}`;
  const callData = AbiFunction.encodeData(EXECUTE, [SENDER_B, 0n, inner]);
  const input = AbiFunction.encodeData(HANDLE_OPS_V07, [
    [packedOp(SENDER_A, callData)],
    "0x3333333333333333333333333333333333333333",
  ]);

  it("callData is padded after the marker", () => {
    expect(callData.endsWith("80218021")).toBe(false);
    expect(fromDataSuffix(callData)).toBeNull();
  });

  it("still finds and decodes the tag", () => {
    expect(fromEntryPointCalldata(input)).toEqual([
      { sender: SENDER_A, attribution: { codes: ["celo_b7k3p9da"], schemaId: 0 } },
    ]);
  });
});

describe("fromEntryPointCalldata — non-bundles", () => {
  it("returns null for a plain contract call", () => {
    expect(fromEntryPointCalldata("0xa9059cbb000000000000000000000000aaaa")).toBeNull();
  });

  it("returns null for empty / too-short input", () => {
    expect(fromEntryPointCalldata("0x")).toBeNull();
    expect(fromEntryPointCalldata("0x1fad")).toBeNull();
  });

  it("returns null for a truncated handleOps call (never throws)", () => {
    const truncated = V06_INPUT.slice(0, 200) as `0x${string}`;
    expect(fromEntryPointCalldata(truncated)).toBeNull();
  });
});
