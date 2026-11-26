import { Attribution } from "ox/erc8021";
import { AbiEvent, AbiFunction, AbiParameters, Bytes, Hash as OxHash } from "ox";
import type { Hex } from "ox";

// Structural stand-ins for viem's Hash / PublicClient. viem is an
// optional peer dep — importing its types here would leak into the
// published .d.ts and break TS consumers who don't install it.
export type TxHash = `0x${string}`;

export interface TxClient {
  getTransaction(args: {
    hash: TxHash;
  }): Promise<{ input?: string; to?: string | null } | null | undefined>;
  /**
   * Needed only to verify relayed intents (Orchestrator.execute): an intent
   * is credited only when the receipt shows it executed. viem's PublicClient
   * provides it.
   */
  getTransactionReceipt?(args: { hash: TxHash }): Promise<
    | {
        status?: unknown;
        logs?: readonly {
          address: string;
          topics: readonly string[];
          data: string;
        }[];
      }
    | null
    | undefined
  >;
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

  const appCode =
    roles.app === undefined ? undefined : validateCode(roles.app, "app");
  const walletCode =
    roles.wallet === undefined
      ? undefined
      : validateCode(roles.wallet, "wallet");
  const serviceCodes =
    service === undefined || service.length === 0
      ? undefined
      : service.map((c) => validateCode(c, "service"));

  // Build with only the keys that are present — ox's getSchemaId uses
  // `key in attribution` checks, so `{ appCode: undefined }` would still
  // select Schema 2 but is sloppier to reason about downstream.
  const attribution: Parameters<typeof Attribution.toDataSuffix>[0] = {
    id: 2,
    ...(appCode !== undefined && { appCode }),
    ...(walletCode !== undefined && { walletCode }),
    ...(serviceCodes !== undefined && { serviceCodes }),
  };
  const suffix = Attribution.toDataSuffix(attribution);

  // ox below 0.14.12 has no notion of `serviceCodes`: its getSchemaId
  // ignores the key (and our explicit `id`), so a service-only tag falls
  // through to the Schema 0 encoder and comes out empty, and an app+service
  // tag silently drops the `s` codes. Decoding what we just encoded turns
  // both silent corruptions into a loud failure — cheap, since encoding
  // happens once per transaction.
  const decoded = fromDataSuffix(suffix);
  const roundTrips =
    decoded !== null &&
    decoded.schemaId === 2 &&
    decoded.app === appCode &&
    decoded.wallet === walletCode &&
    sameCodes(decoded.service, serviceCodes);
  if (!roundTrips) {
    throw new Error(
      "toRoleDataSuffix: the encoded suffix did not round-trip — the resolved `ox` version does not support ERC-8021 Schema 2 service codes. @celo/attribution-tags requires ox >= 0.14.12.",
    );
  }
  return suffix;
}

function sameCodes(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((code, i) => code === b[i]);
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
  /**
   * Set only when the suffix was decoded from inside a wrapped transaction:
   * an ERC-4337 UserOperation in an EntryPoint `handleOps` bundle, or a
   * signed intent in an Orchestrator `execute` call. It is the account that
   * produced the operation. Credit this address, not the outer tx `from`
   * (which is the bundler or the relay).
   */
  sender?: `0x${string}`;
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
  /**
   * Extra Orchestrator deployments to accept for relayed intents, on top of
   * `ORCHESTRATOR_ADDRESSES`. An `execute` call to any other address is not
   * read.
   */
  orchestrators?: readonly string[];
}

export async function verifyTx(
  args: VerifyTxArgs,
): Promise<DecodedSuffix | null> {
  try {
    const tx = await args.client.getTransaction({ hash: args.hash });
    if (!tx?.input) return null;
    const input = tx.input as Hex.Hex;
    const outer = fromDataSuffix(input);
    if (outer) return outer;
    // ERC-4337: the builder's suffix sits at the end of each UserOperation's
    // callData, which the bundler wraps inside handleOps — so it is in the
    // middle of the outer input, not at the end. Fall back to the first
    // tagged operation in the bundle.
    const ops = fromEntryPointCalldata(input);
    if (ops) {
      for (const op of ops) {
        if (op.attribution) return { ...op.attribution, sender: op.sender };
      }
      return null;
    }
    // Relayed intents (Porto-style EIP-7702 wallets): a relay submits the
    // account's signed intent through Orchestrator.execute, so the builder's
    // suffix is on a call inside the intent. Fall back to the first tagged
    // intent that the receipt shows was executed, credited to the account
    // that signed it.
    const intents = await executedIntents(args, tx);
    if (!intents) return null;
    for (const intent of intents) {
      if (intent.attribution) {
        return { ...intent.attribution, sender: intent.sender };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ERC-4337 (smart-account) bundles
//
// A smart-account wallet puts the app's calldata (suffix included) into a
// UserOperation and a bundler submits it to the EntryPoint via handleOps.
// The outer tx therefore never ends with the marker. Detection is keyed on
// the handleOps selector rather than the EntryPoint address so that forks
// and custom EntryPoint deployments decode too; the canonical addresses
// are exported for documentation and indexer allow-lists.
// ---------------------------------------------------------------------------

export const ENTRY_POINT_ADDRESSES = {
  /** EntryPoint v0.6 — handleOps(UserOperation[],address), selector 0x1fad948c */
  v0_6: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  /** EntryPoint v0.7 — handleOps(PackedUserOperation[],address), selector 0x765e827f */
  v0_7: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
} as const;

const HANDLE_OPS_V06 = AbiFunction.from(
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
);

const HANDLE_OPS_V07 = AbiFunction.from(
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
);

const HANDLE_OPS_BY_SELECTOR: Record<string, typeof HANDLE_OPS_V06 | typeof HANDLE_OPS_V07> = {
  [AbiFunction.getSelector(HANDLE_OPS_V06)]: HANDLE_OPS_V06,
  [AbiFunction.getSelector(HANDLE_OPS_V07)]: HANDLE_OPS_V07,
};

// A UserOperation's callData is the smart account's own entry point —
// typically execute(address,uint256,bytes) or executeBatch(...) — and the
// app's tagged calldata is the `bytes` argument inside it. ABI encoding
// pads that argument to a 32-byte boundary, so the marker is followed by
// up to 31 zero bytes and Attribution.fromData (which reads from the end)
// sees nothing. Locate the marker and decode the slice that ends with it.
const MARKER_HEX = ERC_8021_MARKER.slice(2).toLowerCase();

function fromEmbeddedSuffix(data: Hex.Hex): DecodedSuffix | null {
  const direct = fromDataSuffix(data);
  if (direct) return direct;
  const hex = data.toLowerCase();
  let at = hex.indexOf(MARKER_HEX, 2);
  while (at !== -1) {
    const end = at + MARKER_HEX.length;
    // Only consider byte-aligned occurrences.
    if (end % 2 === 0) {
      const decoded = fromDataSuffix(hex.slice(0, end) as Hex.Hex);
      if (decoded) return decoded;
    }
    at = hex.indexOf(MARKER_HEX, at + 1);
  }
  return null;
}

export interface UserOpAttribution {
  /** The smart account that produced the operation — the address to credit. */
  sender: `0x${string}`;
  /** Decoded suffix from the operation's callData, or null if untagged. */
  attribution: DecodedSuffix | null;
}

/**
 * Decode an EntryPoint `handleOps` calldata (v0.6 or v0.7) into one entry
 * per UserOperation. Returns null if the input is not a handleOps call or
 * cannot be decoded. Pure — no RPC.
 */
export function fromEntryPointCalldata(
  input: Hex.Hex,
): UserOpAttribution[] | null {
  if (typeof input !== "string" || input.length < 10) return null;
  const fn = HANDLE_OPS_BY_SELECTOR[input.slice(0, 10).toLowerCase()];
  if (!fn) return null;
  try {
    const decoded = AbiFunction.decodeData(fn, input);
    if (!decoded) return null;
    const [ops] = decoded as unknown as [
      readonly { sender: `0x${string}`; callData: Hex.Hex }[],
      string,
    ];
    return ops.map((op) => ({
      sender: op.sender,
      attribution: fromEmbeddedSuffix(op.callData),
    }));
  } catch {
    return null;
  }
}

/**
 * Fetch a transaction and, if it is an EntryPoint `handleOps` bundle,
 * decode the attribution of every UserOperation in it. Returns null for
 * non-bundle transactions and on RPC errors — never throws.
 */
export async function verifyUserOps(
  args: VerifyTxArgs,
): Promise<UserOpAttribution[] | null> {
  try {
    const tx = await args.client.getTransaction({ hash: args.hash });
    if (!tx?.input) return null;
    return fromEntryPointCalldata(tx.input as Hex.Hex);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Relayed intents (Porto-style EIP-7702 wallets, e.g. Altana)
//
// The account is an EIP-7702 delegated EOA. It signs an intent (its list of
// calls, a nonce, the fee terms) and a relay submits it by calling
// Orchestrator.execute(bytes encodedIntent). The outer `from` is the relay
// and the outer input never ends with the marker: the builder's suffix is on
// a call inside the intent's executionData, followed by the intent's other
// fields.
//
// Only the calls in executionData are read; the intent's other fields (the
// relay's payment amounts and signatures) are never scanned.
//
// Calldata alone proves nothing: anyone can send `execute` calldata holding a
// made-up intent that names any account. The calls are the account's own only
// once the Orchestrator has checked the account's EIP-712 signature and run
// them, which it reports with an IntentExecuted event. So:
//
//   - fromOrchestratorCalldata (offline) decodes and returns what the calldata
//     claims. Its output is UNVERIFIED.
//   - verifyTx / verifyIntents credit an intent only when the transaction
//     succeeded, went to a known Orchestrator deployment, and that contract
//     emitted IntentExecuted for the same account and nonce with no error.
//
// The intent layout is that of Orchestrator 0.5.x, the version deployed on
// Celo.
// ---------------------------------------------------------------------------

/**
 * Orchestrator deployments whose intents verifyTx / verifyIntents accept.
 * Pass `orchestrators` to accept others.
 */
export const ORCHESTRATOR_ADDRESSES = {
  /** Celo Mainnet (42220), Orchestrator 0.5.5 */
  celo: "0xAF140d0416A994Aebb3fA6212B16CE6700f09751",
  /** Celo Sepolia (11142220), Orchestrator 0.5.5 */
  celoSepolia: "0xcb5CEf3C54aa90e9A7ad602A258D3d360cC862B9",
} as const;

const INTENT_EXECUTED = AbiEvent.from(
  "event IntentExecuted(address indexed eoa, uint256 indexed nonce, bool incremented, bytes4 err)",
);

/** topic0 of IntentExecuted(address,uint256,bool,bytes4). */
export const INTENT_EXECUTED_TOPIC = AbiEvent.getSelector(INTENT_EXECUTED);

const ORCHESTRATOR_EXECUTE = AbiFunction.from(
  "function execute(bytes encodedIntent)",
);

const ORCHESTRATOR_EXECUTE_BATCH = AbiFunction.from(
  "function execute(bytes[] encodedIntents)",
);

/** Selectors of the Orchestrator entry points that carry signed intents. */
export const ORCHESTRATOR_SELECTORS = {
  /** execute(bytes encodedIntent) */
  execute: AbiFunction.getSelector(ORCHESTRATOR_EXECUTE),
  /** execute(bytes[] encodedIntents) */
  executeBatch: AbiFunction.getSelector(ORCHESTRATOR_EXECUTE_BATCH),
} as const;

const INTENT = AbiParameters.from(
  "(address eoa, bytes executionData, uint256 nonce, address payer, address paymentToken, uint256 paymentMaxAmount, uint256 combinedGas, bytes[] encodedPreCalls, bytes[] encodedFundTransfers, address settler, uint256 expiry, bool isMultichain, address funder, bytes funderSignature, bytes settlerContext, uint256 paymentAmount, address paymentRecipient, bytes signature, bytes paymentSignature, address supportedAccountImplementation)",
);

const INTENT_CALLS = AbiParameters.from(
  "(address to, uint256 value, bytes data)[]",
);

export interface IntentAttribution {
  /**
   * The account the intent names as its signer — the address to credit, once
   * the intent is known to have executed.
   */
  sender: `0x${string}`;
  /**
   * Decoded suffix from the intent's calls, or null if untagged. From
   * verifyIntents it is also null for an intent that did not execute.
   */
  attribution: DecodedSuffix | null;
}

interface DecodedIntent extends IntentAttribution {
  nonce: bigint;
}

function fromEncodedIntent(encoded: Hex.Hex): DecodedIntent {
  const [intent] = AbiParameters.decode(INTENT, encoded) as unknown as [
    { eoa: `0x${string}`; executionData: Hex.Hex; nonce: bigint },
  ];
  let attribution: DecodedSuffix | null = null;
  if (intent.executionData !== "0x") {
    const [calls] = AbiParameters.decode(
      INTENT_CALLS,
      intent.executionData,
    ) as unknown as [readonly { data: Hex.Hex }[]];
    // A wallet tags the end of what it executes, so the last tagged call wins
    // when a batch carries more than one.
    for (let i = calls.length - 1; i >= 0 && !attribution; i--) {
      attribution = fromEmbeddedSuffix(calls[i]!.data);
    }
  }
  return { sender: intent.eoa, nonce: intent.nonce, attribution };
}

/**
 * Decode an Orchestrator `execute` calldata into one entry per intent.
 * Returns null if the input is not an Orchestrator `execute` call or cannot
 * be decoded. Pure — no RPC.
 *
 * UNVERIFIED: this reads what the calldata claims. It does not know whether
 * the transaction went to an Orchestrator, whether the account's signature
 * was valid, or whether the intent ran, and anyone can send calldata naming
 * any account. Use verifyIntents / verifyTx to credit a `sender`, or apply
 * the same checks yourself (see INDEXERS.md).
 */
export function fromOrchestratorCalldata(
  input: Hex.Hex,
): IntentAttribution[] | null {
  const intents = decodeIntents(input);
  if (!intents) return null;
  return intents.map(({ sender, attribution }) => ({ sender, attribution }));
}

function decodeIntents(input: Hex.Hex): DecodedIntent[] | null {
  if (typeof input !== "string" || input.length < 10) return null;
  const selector = input.slice(0, 10).toLowerCase();
  try {
    if (selector === ORCHESTRATOR_SELECTORS.execute) {
      const [encoded] = AbiFunction.decodeData(
        ORCHESTRATOR_EXECUTE,
        input,
      ) as unknown as [Hex.Hex];
      return [fromEncodedIntent(encoded)];
    }
    if (selector === ORCHESTRATOR_SELECTORS.executeBatch) {
      const [encoded] = AbiFunction.decodeData(
        ORCHESTRATOR_EXECUTE_BATCH,
        input,
      ) as unknown as [readonly Hex.Hex[]];
      return encoded.map(fromEncodedIntent);
    }
    return null;
  } catch {
    return null;
  }
}

function succeeded(status: unknown): boolean {
  return status === "success" || status === "0x1" || status === 1 || status === 1n;
}

/**
 * The intents of an Orchestrator `execute` transaction, with the attribution
 * kept only for those the receipt shows were executed:
 *
 *   - the transaction's `to` is a known Orchestrator deployment (otherwise
 *     null: the call is not treated as an Orchestrator call at all),
 *   - the transaction succeeded,
 *   - that contract emitted IntentExecuted with the same account and nonce,
 *     `incremented` true and `err` zero, as that intent's own log (intents
 *     and logs are paired in order, each log used once).
 *
 * An intent that fails any of the last two is returned with a null
 * attribution. If any intent has no log of its own, none is credited. Throws
 * on RPC errors; callers catch.
 */
async function executedIntents(
  args: VerifyTxArgs,
  tx: { input?: string; to?: string | null },
): Promise<IntentAttribution[] | null> {
  const to = typeof tx.to === "string" ? tx.to.toLowerCase() : null;
  const known = [
    ...Object.values(ORCHESTRATOR_ADDRESSES),
    ...(args.orchestrators ?? []),
  ].map((a) => a.toLowerCase());
  if (to === null || !known.includes(to)) return null;

  const intents = decodeIntents(tx.input as Hex.Hex);
  if (!intents) return null;

  const receipt = await args.client.getTransactionReceipt?.({ hash: args.hash });
  const logs = receipt && succeeded(receipt.status) ? (receipt.logs ?? []) : [];

  // The Orchestrator's IntentExecuted logs, in the order it emitted them.
  const executed: { eoa: string; nonce: bigint; ok: boolean }[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== to) continue;
    const [topic0, eoa, nonce] = log.topics;
    if (topic0?.toLowerCase() !== INTENT_EXECUTED_TOPIC) continue;
    if (!eoa || !nonce) continue;
    // data = abi.encode(bool incremented, bytes4 err)
    const data = log.data.slice(2);
    const ok =
      data.length >= 128 &&
      BigInt(`0x${data.slice(0, 64)}`) !== 0n &&
      data.slice(64, 72) === "00000000";
    executed.push({
      eoa: `0x${eoa.slice(-40)}`.toLowerCase(),
      nonce: BigInt(nonce),
      ok,
    });
  }

  // Pair each intent with ITS OWN log, in order. The Orchestrator runs the
  // intents in the order given and emits exactly one IntentExecuted for each,
  // failed or not, so intent i's log comes after intent i-1's. A log is used
  // once and never looked at again: an intent that failed cannot borrow the
  // success of a later intent carrying the same account and nonce (a forged
  // copy placed in front of the genuine one in an execute(bytes[]) batch).
  //
  // Logs in between are skipped rather than counted: an intent's pre-calls
  // (a new account's key set-up rides along with its first transaction) each
  // emit their own IntentExecuted before the intent's, so one intent can
  // account for several logs.
  const results: boolean[] = [];
  let next = 0;
  let complete = true;
  for (const intent of intents) {
    const sender = intent.sender.toLowerCase();
    let at = -1;
    for (let k = next; k < executed.length; k++) {
      if (executed[k]!.eoa === sender && executed[k]!.nonce === intent.nonce) {
        at = k;
        break;
      }
    }
    if (at === -1) {
      // An intent with no log of its own means the logs do not describe this
      // calldata. Credit nothing.
      complete = false;
      break;
    }
    results.push(executed[at]!.ok);
    next = at + 1;
  }

  return intents.map((intent, i) => ({
    sender: intent.sender,
    attribution: complete && results[i] ? intent.attribution : null,
  }));
}

/**
 * Fetch a transaction and, if it is an `execute` call to a known
 * Orchestrator, return the attribution of every intent in it. An intent is
 * credited only when the receipt shows it executed (see ORCHESTRATOR_ADDRESSES
 * and INTENT_EXECUTED_TOPIC); otherwise its attribution is null. Needs a
 * client with `getTransactionReceipt`. Returns null for other transactions
 * and on RPC errors — never throws.
 */
export async function verifyIntents(
  args: VerifyTxArgs,
): Promise<IntentAttribution[] | null> {
  try {
    const tx = await args.client.getTransaction({ hash: args.hash });
    if (!tx?.input) return null;
    return await executedIntents(args, tx);
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

// Celo Builders platform flow: the platform assigns each registered
// project a code derived from its GitHub repository slug. This must stay
// byte-identical to the platform's derivation (celo-org/celo-builders,
// `deriveAttributionTag`): trim → lowercase → SHA-256 → first 6 bytes →
// "celo_" prefix. Don't change without recomputing every pinned vector.
const REPO_SLUG_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

function repoSlug(input: string): string {
  const trimmed = input.trim();
  // Accept a GitHub URL and reduce it to owner/repo — the platform parses
  // URLs the same way before deriving.
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(
    trimmed,
  );
  if (m) {
    return `${m[1]}/${m[2]!.replace(/\.git$/i, "")}`;
  }
  return trimmed;
}

export function codeFromRepo(repo: string): string {
  if (typeof repo !== "string" || repo.trim().length === 0) {
    throw new Error("codeFromRepo: repository slug is required");
  }
  const normalized = repoSlug(repo).toLowerCase();
  if (!REPO_SLUG_RE.test(normalized)) {
    throw new Error(
      `codeFromRepo: expected "owner/repo" or a github.com URL, got ${JSON.stringify(repo)}`,
    );
  }
  const digest = OxHash.sha256(Bytes.fromString(normalized), { as: "Hex" });
  return `celo_${digest.slice(2, 14)}`;
}

// ---------------------------------------------------------------------------
// withAttribution — tag every transaction a viem wallet client sends
//
// Appending the suffix by hand at every call site is the failure mode we
// see most: one path forgets it and produces untagged transactions with no
// error anywhere. Extending the client once moves the suffix to a single
// place. `sendTransaction` gets the suffix appended to `data`;
// `writeContract` gets it via viem's own `dataSuffix` parameter, because
// viem binds `writeContract` to the client at the time `walletActions` is
// applied, so a later `sendTransaction` override does not reach it. The
// `*Sync` variants are wrapped when the client has them.
// ---------------------------------------------------------------------------

const MARKER_BYTES = ERC_8021_MARKER.length / 2 - 1; // 16

/**
 * Append `suffix` to `data`, merging with an existing Schema 0 tag
 * (codes are deduplicated, existing codes first) and leaving an existing
 * Schema 2 (role-based) tag untouched.
 */
function appendSuffixToData(data: unknown, suffix: Hex.Hex): Hex.Hex {
  const base = (typeof data === "string" && data.length >= 2 ? data : "0x") as Hex.Hex;
  const existing = fromDataSuffix(base);
  if (!existing) {
    return (base + suffix.slice(2)) as Hex.Hex;
  }
  if (existing.schemaId !== 0) {
    // Already carries a role-based tag (e.g. from a facilitator) — don't
    // rewrite what another party encoded.
    return base;
  }
  const ours = fromDataSuffix(suffix)!.codes;
  const merged = [...existing.codes];
  for (const c of ours) if (!merged.includes(c)) merged.push(c);
  // Schema 0 suffix layout: [codes][len:1][schema:1][marker:16]
  const existingBytes = existing.codes.join(",").length + 1 + 1 + MARKER_BYTES;
  const stripped = base.slice(0, base.length - existingBytes * 2) as Hex.Hex;
  try {
    return (stripped + toDataSuffix(merged).slice(2)) as Hex.Hex;
  } catch {
    // The existing tag was written by another ERC-8021 emitter with codes
    // outside Celo's stricter charset (e.g. uppercase). Never fail the
    // transaction over attribution: append ours after theirs instead.
    // Parsers read from the end, so our tag is the one they see.
    return (base + suffix.slice(2)) as Hex.Hex;
  }
}

/** viem accepts `dataSuffix` as a hex string or `{ value, required }`. */
function dataSuffixValue(dataSuffix: unknown): string | undefined {
  if (typeof dataSuffix === "string") return dataSuffix;
  if (dataSuffix && typeof dataSuffix === "object" && "value" in dataSuffix) {
    const v = (dataSuffix as { value: unknown }).value;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (args: any) => any;

/** Structural stand-in for a viem WalletClient (no viem types in our .d.ts). */
export interface AttributableClient {
  sendTransaction: Action;
  sendTransactionSync?: Action;
  writeContract?: Action;
  writeContractSync?: Action;
}

type Attributed<C extends AttributableClient> = Pick<
  C,
  Extract<keyof C, keyof AttributableClient>
>;

// sendTransaction: append to `data` (folding in a call-site dataSuffix
// first, since viem would otherwise concatenate it after ours).
function tagSend(args: Record<string, unknown> | undefined, suffix: Hex.Hex) {
  const { dataSuffix, ...rest } = args ?? {};
  const callSite = dataSuffixValue(dataSuffix);
  const base =
    callSite !== undefined && callSite.length > 2
      ? (typeof rest.data === "string" ? rest.data : "0x") + callSite.slice(2)
      : rest.data;
  return { ...rest, data: appendSuffixToData(base, suffix) };
}

// writeContract: we never see the encoded calldata, so ride viem's own
// `dataSuffix` parameter and make sure our tag comes last.
function tagWrite(args: Record<string, unknown> | undefined, suffix: Hex.Hex) {
  const { dataSuffix, ...rest } = args ?? {};
  const callSite = dataSuffixValue(dataSuffix);
  return { ...rest, dataSuffix: appendSuffixToData(callSite, suffix) };
}

/**
 * viem wallet-client extension that appends the ERC-8021 suffix for `code`
 * to every transaction the client sends:
 *
 *   const wallet = createWalletClient({ chain: celo, transport })
 *     .extend(withAttribution("celo_b7k3p9da"));
 *
 * Covers `sendTransaction`, `writeContract`, their `*Sync` variants, and
 * plain value transfers (empty `data`). If the data already ends with a
 * Schema 0 tag the codes are merged into one suffix; a Schema 2 tag is
 * left as is.
 */
export function withAttribution(code: string | readonly string[]) {
  const suffix = toDataSuffix(code);
  return <C extends AttributableClient>(client: C): Attributed<C> => {
    const actions: AttributableClient = {
      sendTransaction: (args) => client.sendTransaction(tagSend(args, suffix)),
    };
    if (typeof client.sendTransactionSync === "function") {
      actions.sendTransactionSync = (args) =>
        client.sendTransactionSync!(tagSend(args, suffix));
    }
    if (typeof client.writeContract === "function") {
      actions.writeContract = (args) => client.writeContract!(tagWrite(args, suffix));
    }
    if (typeof client.writeContractSync === "function") {
      actions.writeContractSync = (args) =>
        client.writeContractSync!(tagWrite(args, suffix));
    }
    return actions as Attributed<C>;
  };
}
