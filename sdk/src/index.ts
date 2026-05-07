import { Attribution } from "ox/erc8021";
import { Bytes, Hash as OxHash } from "ox";
import type { Hex } from "ox";
import type { Hash, PublicClient } from "viem";

export const ERC_8021_MARKER =
  "0x80218021802180218021802180218021" as const;

// Intentionally stricter than ERC-8021. Celo distributes codes as
// celo_xxxxxxxx and uses lowercase platform codes (minipay, proofofship).
// Don't loosen without coordinating with the off-chain registry.
const CODE_RE = /^[a-z0-9_]{1,32}$/;

function normalizeCodes(input: string | readonly string[]): string[] {
  const arr = typeof input === "string" ? [input] : [...input];
  if (arr.length === 0) {
    throw new Error("toDataSuffix: at least one code is required");
  }
  for (const c of arr) {
    if (typeof c !== "string") {
      throw new Error("toDataSuffix: codes must be strings");
    }
    if (!CODE_RE.test(c)) {
      throw new Error(
        `toDataSuffix: invalid code ${JSON.stringify(c)} — codes must match /^[a-z0-9_]{1,32}$/ (no spaces, no commas, no uppercase)`,
      );
    }
  }
  return arr;
}

export function toDataSuffix(code: string | readonly string[]): Hex.Hex {
  const codes = normalizeCodes(code);
  return Attribution.toDataSuffix({ codes });
}

export interface DecodedSuffix {
  codes: string[];
  schemaId: number;
}

export function fromDataSuffix(suffix: Hex.Hex): DecodedSuffix | null {
  let attr: ReturnType<typeof Attribution.fromData>;
  try {
    attr = Attribution.fromData(suffix);
  } catch {
    return null;
  }
  if (!attr) return null;

  const codes = [...((attr as { codes?: readonly string[] }).codes ?? [])];
  const schemaId = Attribution.getSchemaId(attr);

  return { codes, schemaId };
}

export interface VerifyTxArgs {
  client: PublicClient;
  hash: Hash;
}

export async function verifyTx(
  args: VerifyTxArgs,
): Promise<DecodedSuffix | null> {
  try {
    const tx = await args.client.getTransaction({ hash: args.hash });
    if (!tx?.input) return null;
    return fromDataSuffix(tx.input as Hex.Hex);
  } catch {
    return null;
  }
}

// MiniPay flow: derive a deterministic per-app code from the hostname,
// so apps can self-attribute with no registration step. See
// docs/minipay-attribution.md for the design discussion.
const HOSTNAME_RE = /^[a-z0-9.-]+$/;

export function codeFromHostname(hostname: string): string {
  if (typeof hostname !== "string" || hostname.length === 0) {
    throw new Error("codeFromHostname: hostname is required");
  }
  let normalized = hostname.toLowerCase();
  if (normalized.startsWith("www.")) {
    normalized = normalized.slice(4);
  }
  if (!HOSTNAME_RE.test(normalized)) {
    throw new Error(
      `codeFromHostname: invalid hostname ${JSON.stringify(hostname)}`,
    );
  }
  const digest = OxHash.sha256(Bytes.fromString(normalized), { as: "Hex" });
  // digest is 0x-prefixed 64-char hex; first 4 bytes = 8 hex chars after the prefix
  return `celo_${digest.slice(2, 10)}`;
}
