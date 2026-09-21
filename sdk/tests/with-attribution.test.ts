import { describe, it, expect } from "vitest";
import { createWalletClient, custom, parseAbi } from "viem";
import { Attribution } from "ox/erc8021";
import { celo } from "viem/chains";
import {
  ERC_8021_MARKER,
  fromDataSuffix,
  toDataSuffix,
  toRoleDataSuffix,
  verifyTx,
  withAttribution,
} from "../src/index.js";

const CODE = "celo_b7k3p9da";
const SUFFIX = toDataSuffix(CODE);
const TO = "0x1111111111111111111111111111111111111111" as const;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as const;
const TRANSFER = "0xa9059cbb000000000000000000000000aaaa" as const;

// ---------------------------------------------------------------------------
// Pure: stub client, exact bytes
// ---------------------------------------------------------------------------

function stubClient() {
  const sent: Record<string, unknown>[] = [];
  const client = {
    sendTransaction: async (args: Record<string, unknown>) => {
      sent.push(args);
      return "0xhash";
    },
  };
  return { client, sent };
}

describe("withAttribution — appends the suffix (stub client)", () => {
  it("plain value transfer with no data", async () => {
    const { client, sent } = stubClient();
    const wallet = { ...client, ...withAttribution(CODE)(client) };
    await wallet.sendTransaction({ to: TO, value: 1n });
    expect(sent[0]!.data).toBe(SUFFIX);
    expect(sent[0]!.to).toBe(TO);
    expect(sent[0]!.value).toBe(1n);
  });

  it("empty data 0x", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    await wallet.sendTransaction({ to: TO, data: "0x" });
    expect(sent[0]!.data).toBe(SUFFIX);
  });

  it("contract calldata", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    await wallet.sendTransaction({ to: TO, data: TRANSFER });
    expect(sent[0]!.data).toBe(TRANSFER + SUFFIX.slice(2));
  });

  it("accepts multiple codes", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(["myapp", CODE])(client);
    await wallet.sendTransaction({ to: TO });
    expect(fromDataSuffix(sent[0]!.data as `0x${string}`)?.codes).toEqual(["myapp", CODE]);
  });

  it("rejects an invalid code at construction, not at send time", () => {
    expect(() => withAttribution("Bad Code")).toThrow();
  });
});

describe("withAttribution — sync variants and writeContract on a stub client", () => {
  function fullStub() {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const rec = (name: string) => async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return "0xhash";
    };
    return {
      calls,
      client: {
        sendTransaction: rec("sendTransaction"),
        sendTransactionSync: rec("sendTransactionSync"),
        writeContract: rec("writeContract"),
        writeContractSync: rec("writeContractSync"),
      },
    };
  }

  it("wraps sendTransactionSync like sendTransaction", async () => {
    const { client, calls } = fullStub();
    const wallet = withAttribution(CODE)(client);
    await wallet.sendTransactionSync({ to: TO, data: TRANSFER });
    expect(calls[0]!.name).toBe("sendTransactionSync");
    expect(calls[0]!.args.data).toBe(TRANSFER + SUFFIX.slice(2));
  });

  it("wraps writeContract / writeContractSync via dataSuffix", async () => {
    const { client, calls } = fullStub();
    const wallet = withAttribution(CODE)(client);
    await wallet.writeContract({ address: TO, abi: [], functionName: "f" });
    await wallet.writeContractSync({ address: TO, abi: [], functionName: "f", dataSuffix: "0xdead" });
    expect(calls[0]!.name).toBe("writeContract");
    expect(calls[0]!.args.dataSuffix).toBe(SUFFIX);
    expect(calls[1]!.name).toBe("writeContractSync");
    expect(calls[1]!.args.dataSuffix).toBe("0xdead" + SUFFIX.slice(2));
  });

  it("only exposes the actions the client actually has", () => {
    const { client } = stubClient();
    const ext = withAttribution(CODE)(client);
    expect(Object.keys(ext)).toEqual(["sendTransaction"]);
  });
});

describe("withAttribution — data that is already tagged", () => {
  it("does not double-tag the same code", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    await wallet.sendTransaction({ to: TO, data: TRANSFER + SUFFIX.slice(2) });
    const data = sent[0]!.data as string;
    expect(data).toBe(TRANSFER + SUFFIX.slice(2));
    expect(data.split(ERC_8021_MARKER.slice(2)).length - 1).toBe(1);
  });

  it("merges a different Schema 0 code into one suffix (existing first)", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    const pre = (TRANSFER + toDataSuffix("other_app").slice(2)) as `0x${string}`;
    await wallet.sendTransaction({ to: TO, data: pre });
    const data = sent[0]!.data as `0x${string}`;
    expect(fromDataSuffix(data)).toEqual({ codes: ["other_app", CODE], schemaId: 0 });
    expect(data).toBe(TRANSFER + toDataSuffix(["other_app", CODE]).slice(2));
  });

  it("leaves a Schema 2 (role-based) tag untouched", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    const pre = (TRANSFER + toRoleDataSuffix({ app: "x_app", wallet: "x_wallet" }).slice(2)) as `0x${string}`;
    await wallet.sendTransaction({ to: TO, data: pre });
    expect(sent[0]!.data).toBe(pre);
  });

  it("does not fail the transaction when the existing tag has codes outside Celo's charset", async () => {
    // Another ERC-8021 emitter may use codes the SDK's own validator rejects
    // (uppercase). The merge cannot re-encode those; the tx must still send
    // and still carry our code at the very end.
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    const foreign = (TRANSFER + Attribution.toDataSuffix({ codes: ["BaseApp"] }).slice(2)) as `0x${string}`;
    await wallet.sendTransaction({ to: TO, data: foreign });
    const data = sent[0]!.data as `0x${string}`;
    expect(data).toBe(foreign + SUFFIX.slice(2));
    expect(fromDataSuffix(data)).toEqual({ codes: [CODE], schemaId: 0 });
  });

  it("folds a call-site dataSuffix in before ours so the tag stays last", async () => {
    const { client, sent } = stubClient();
    const wallet = withAttribution(CODE)(client);
    await wallet.sendTransaction({ to: TO, data: TRANSFER, dataSuffix: "0xdead" });
    expect(sent[0]!.data).toBe(TRANSFER + "dead" + SUFFIX.slice(2));
    expect(sent[0]).not.toHaveProperty("dataSuffix");
  });
});

// ---------------------------------------------------------------------------
// Real viem wallet client with a recording transport (JSON-RPC account, so
// viem forwards eth_sendTransaction with the data as-is).
// ---------------------------------------------------------------------------

function recordingTransport() {
  const requests: { method: string; params?: unknown }[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      requests.push({ method, params });
      if (method === "eth_chainId") return `0x${celo.id.toString(16)}`;
      if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
      throw new Error(`unexpected rpc method ${method}`);
    },
  });
  const sentData = () =>
    requests
      .filter((r) => r.method === "eth_sendTransaction")
      .map((r) => (r.params as [{ data?: `0x${string}` }])[0].data ?? "0x");
  return { transport, sentData };
}

async function decodeViaVerifyTx(data: `0x${string}`) {
  const client = { getTransaction: async () => ({ input: data }) };
  return verifyTx({ client, hash: `0x${"a".repeat(64)}` });
}

const abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

describe("withAttribution — real viem wallet client", () => {
  function make() {
    const { transport, sentData } = recordingTransport();
    const wallet = createWalletClient({
      account: ACCOUNT,
      chain: celo,
      transport,
    }).extend(withAttribution(CODE));
    return { wallet, sentData };
  }

  it("sendTransaction with a plain value transfer", async () => {
    const { wallet, sentData } = make();
    await wallet.sendTransaction({ to: TO, value: 1n });
    const [data] = sentData();
    expect(data).toBe(SUFFIX);
    expect(await decodeViaVerifyTx(data!)).toEqual({ codes: [CODE], schemaId: 0 });
  });

  it("sendTransaction with data", async () => {
    const { wallet, sentData } = make();
    await wallet.sendTransaction({ to: TO, data: TRANSFER });
    expect(sentData()[0]).toBe(TRANSFER + SUFFIX.slice(2));
  });

  it("writeContract is tagged exactly once", async () => {
    const { wallet, sentData } = make();
    await wallet.writeContract({
      address: TO,
      abi,
      functionName: "transfer",
      args: [ACCOUNT, 5n],
    });
    const [data] = sentData();
    expect(data!.startsWith("0xa9059cbb")).toBe(true);
    expect(data!.split(ERC_8021_MARKER.slice(2)).length - 1).toBe(1);
    expect(await decodeViaVerifyTx(data!)).toEqual({ codes: [CODE], schemaId: 0 });
  });

  it("writeContract with a call-site dataSuffix keeps the tag last", async () => {
    const { wallet, sentData } = make();
    await wallet.writeContract({
      address: TO,
      abi,
      functionName: "transfer",
      args: [ACCOUNT, 5n],
      dataSuffix: "0xdead",
    });
    const [data] = sentData();
    expect(data!.endsWith("dead" + SUFFIX.slice(2))).toBe(true);
    expect(await decodeViaVerifyTx(data!)).toEqual({ codes: [CODE], schemaId: 0 });
  });

  it("writeContract with a call-site Schema 0 dataSuffix merges the codes", async () => {
    const { wallet, sentData } = make();
    await wallet.writeContract({
      address: TO,
      abi,
      functionName: "transfer",
      args: [ACCOUNT, 5n],
      dataSuffix: toDataSuffix("other_app"),
    });
    const [data] = sentData();
    expect(data!.split(ERC_8021_MARKER.slice(2)).length - 1).toBe(1);
    expect(await decodeViaVerifyTx(data!)).toEqual({ codes: ["other_app", CODE], schemaId: 0 });
  });

  it("keeps the rest of the client intact", () => {
    const { wallet } = make();
    expect(wallet.chain.id).toBe(celo.id);
    expect(typeof wallet.signMessage).toBe("function");
  });
});
