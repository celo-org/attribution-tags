import { Attribution } from "ox/erc8021";
import { Bytes, Hash as OxHash } from "ox";
import type { Hex } from "ox";

// Structural stand-ins for viem's Hash / PublicClient. viem is an
// optional peer dep — importing its types here would leak into the
// published .d.ts and break TS consumers who don't install it.
export type TxHash = `0x${string}`;

export interface TxClient {
  getTransaction(args: {
    hash: TxHash;
  }): Promise<{ input?: string } | null | undefined>;
}

export const ERC_8021_MARKER =
  "0x80218021802180218021802180218021" as const;

// Convenience alias for consumers using viem's Hex elsewhere — the
// types are structurally identical (both are `0x${string}`), but
// importing this from the SDK documents the intent at the call site.
export type AttributionTagSuffix = Hex.Hex;

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
  // The wire format stores the comma-joined code field's length in a
  // single byte, so the joined field is capped at 255 bytes.
  const joinedLength = arr.join(",").length;
  if (joinedLength > 255) {
    throw new Error(
      `toDataSuffix: combined codes are ${joinedLength} bytes (comma-joined) — the ERC-8021 length byte caps the code field at 255 bytes; use fewer or shorter codes`,
    );
  }
  return arr;
}

export function toDataSuffix(
  code: string | readonly string[],
): AttributionTagSuffix {
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

  // Celo attribution is Schema 0 only. Other schemas (e.g. Schema 1's
  // custom code registry) carry codes that are NOT canonical Celo codes —
  // treat them as untagged rather than let them masquerade as ours.
  const schemaId = Attribution.getSchemaId(attr);
  if (schemaId !== 0) return null;

  const codes = [...attr.codes];
  if (codes.length === 0) return null;

  return { codes, schemaId };
}

export interface VerifyTxArgs {
  client: TxClient;
  hash: TxHash;
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
// so apps can self-attribute with no registration step.
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
  // digest is 0x-prefixed 64-char hex; we take the first 6 bytes = 12 hex chars
  // after the 0x prefix. 12 chars = 48 bits of entropy, ~2.3M codes before
  // birthday-bound collisions get meaningful — comfortable headroom for MiniPay
  // scale. Don't change without recomputing every pinned vector.
  return `celo_${digest.slice(2, 14)}`;
}
