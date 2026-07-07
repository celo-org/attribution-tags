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

// ERC-8021 Schema 2: role-based attribution (CBOR map). Used by x402
// facilitators to tag settlement transactions with the app (resource
// server), wallet (facilitator), and service (client) that produced a
// payment. Wire-compatible with other Schema 2 implementations — the
// CBOR keys are the spec's canonical short keys (a / w / s).
export interface RoleCodes {
  /** Application code — the app or resource server serving the request. */
  app?: string;
  /** Wallet code — the wallet or facilitator submitting the transaction. */
  wallet?: string;
  /** Service code(s) — additional providers (e.g. the paying client). */
  service?: string | readonly string[];
}

function validateCode(code: string, role: string): string {
  if (typeof code !== "string" || !CODE_RE.test(code)) {
    throw new Error(
      `toRoleDataSuffix: invalid ${role} code ${JSON.stringify(code)} — codes must match /^[a-z0-9_]{1,32}$/ (no spaces, no commas, no uppercase)`,
    );
  }
  return code;
}

export function toRoleDataSuffix(roles: RoleCodes): AttributionTagSuffix {
  const service =
    roles.service === undefined
      ? undefined
      : typeof roles.service === "string"
        ? [roles.service]
        : [...roles.service];

  if (
    roles.app === undefined &&
    roles.wallet === undefined &&
    (service === undefined || service.length === 0)
  ) {
    throw new Error(
      "toRoleDataSuffix: at least one of app, wallet, or service is required",
    );
  }

  // Build with only the keys that are present — ox's getSchemaId uses
  // `key in attribution` checks, so `{ appCode: undefined }` would still
  // select Schema 2 but is sloppier to reason about downstream.
  const attribution: Parameters<typeof Attribution.toDataSuffix>[0] = {
    id: 2,
    ...(roles.app !== undefined && { appCode: validateCode(roles.app, "app") }),
    ...(roles.wallet !== undefined && {
      walletCode: validateCode(roles.wallet, "wallet"),
    }),
    ...(service !== undefined &&
      service.length > 0 && {
        serviceCodes: service.map((c) => validateCode(c, "service")),
      }),
  };
  return Attribution.toDataSuffix(attribution);
}

export interface DecodedSuffix {
  /** Every code found in the suffix, regardless of schema. */
  codes: string[];
  schemaId: number;
  /** Schema 2 only: application (resource server) code. */
  app?: string;
  /** Schema 2 only: wallet / facilitator code. */
  wallet?: string;
  /** Schema 2 only: service (client) codes. */
  service?: string[];
}

export function fromDataSuffix(suffix: Hex.Hex): DecodedSuffix | null {
  let attr: ReturnType<typeof Attribution.fromData>;
  try {
    attr = Attribution.fromData(suffix);
  } catch {
    return null;
  }
  if (!attr) return null;

  const schemaId = Attribution.getSchemaId(attr);

  // Schema 0: the canonical flat code list (Celo's default tag shape).
  if (schemaId === 0 && "codes" in attr && attr.codes) {
    const codes = [...attr.codes];
    if (codes.length === 0) return null;
    return { codes, schemaId };
  }

  // Schema 2: role-based CBOR attribution (x402 facilitators et al.).
  if (schemaId === 2) {
    const s2 = attr as {
      appCode?: string;
      walletCode?: string;
      serviceCodes?: readonly string[];
    };
    const service = s2.serviceCodes ? [...s2.serviceCodes] : undefined;
    const codes = [
      ...(s2.appCode ? [s2.appCode] : []),
      ...(s2.walletCode ? [s2.walletCode] : []),
      ...(service ?? []),
    ];
    if (codes.length === 0) return null;
    return {
      codes,
      schemaId,
      ...(s2.appCode !== undefined && { app: s2.appCode }),
      ...(s2.walletCode !== undefined && { wallet: s2.walletCode }),
      ...(service !== undefined && { service }),
    };
  }

  // Schema 1 (custom code registry) carries codes that are NOT canonical
  // Celo codes — treat as untagged rather than let them masquerade as ours.
  return null;
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
