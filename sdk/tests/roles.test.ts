import { describe, it, expect } from "vitest";
import { Attribution } from "ox/erc8021";
import {
  toDataSuffix,
  toRoleDataSuffix,
  fromDataSuffix,
  ERC_8021_MARKER,
} from "../src/index.js";

// ERC-8021 Schema 2: [CBOR map {a,w,s}] [len:2] [schema:0x02] [marker:16].
// Emitted by x402 facilitators on settlement transactions; must stay
// wire-compatible with other Schema 2 implementations.

describe("toRoleDataSuffix wire format", () => {
  it("matches the canonical ox vector for an app-only tag", () => {
    // ox's documented Schema 2 example: { appCode: 'baseapp' }.
    // CBOR a1 61 61 67 62617365617070 = {"a": "baseapp"} (11 bytes).
    expect(toRoleDataSuffix({ app: "baseapp" })).toBe(
      "0xa161616762617365617070000b0280218021802180218021802180218021",
    );
  });

  it("ends with the schema byte 0x02 and the marker", () => {
    const suffix = toRoleDataSuffix({ app: "celo_b7k3p9da" });
    expect(suffix.endsWith(`02${ERC_8021_MARKER.slice(2)}`)).toBe(true);
  });

  it("is byte-identical to ox's Schema 2 encoding for all roles", () => {
    const ours = toRoleDataSuffix({
      app: "celo_b7k3p9da",
      wallet: "celo_facil",
      service: ["celo_agent"],
    });
    const theirs = Attribution.toDataSuffix({
      appCode: "celo_b7k3p9da",
      walletCode: "celo_facil",
      serviceCodes: ["celo_agent"],
    });
    expect(ours).toBe(theirs);
  });
});

describe("toRoleDataSuffix / fromDataSuffix round-trip", () => {
  it("round-trips all three roles", () => {
    const suffix = toRoleDataSuffix({
      app: "celo_b7k3p9da",
      wallet: "celo_facil",
      service: "celo_agent",
    });
    const parsed = fromDataSuffix(suffix);
    expect(parsed).toEqual({
      codes: ["celo_b7k3p9da", "celo_facil", "celo_agent"],
      schemaId: 2,
      app: "celo_b7k3p9da",
      wallet: "celo_facil",
      service: ["celo_agent"],
    });
  });

  it("round-trips a wallet-only tag (facilitator with no app code)", () => {
    const parsed = fromDataSuffix(toRoleDataSuffix({ wallet: "celo_facil" }));
    expect(parsed).toEqual({
      codes: ["celo_facil"],
      schemaId: 2,
      wallet: "celo_facil",
    });
  });

  it("round-trips multiple service codes", () => {
    const parsed = fromDataSuffix(
      toRoleDataSuffix({ app: "myapp", service: ["svc_one", "svc_two"] }),
    );
    expect(parsed?.service).toEqual(["svc_one", "svc_two"]);
    expect(parsed?.codes).toEqual(["myapp", "svc_one", "svc_two"]);
  });

  it("decodes a Schema 2 suffix appended to real calldata", () => {
    const callData = "0xa9059cbb000000000000000000000000"; // arbitrary prefix
    const suffix = toRoleDataSuffix({ app: "celo_b7k3p9da" });
    const parsed = fromDataSuffix(`${callData}${suffix.slice(2)}` as const);
    expect(parsed?.app).toBe("celo_b7k3p9da");
  });
});

describe("toRoleDataSuffix validation", () => {
  it("requires at least one role", () => {
    expect(() => toRoleDataSuffix({})).toThrow(/at least one/);
    expect(() => toRoleDataSuffix({ service: [] })).toThrow(/at least one/);
  });

  it("rejects invalid codes in any role", () => {
    expect(() => toRoleDataSuffix({ app: "Invalid Code" })).toThrow(/app/);
    expect(() => toRoleDataSuffix({ wallet: "with,comma" })).toThrow(/wallet/);
    expect(() => toRoleDataSuffix({ service: ["ok", ""] })).toThrow(/service/);
    expect(() => toRoleDataSuffix({ app: "a".repeat(33) })).toThrow(/app/);
  });
});

describe("backwards compatibility", () => {
  it("Schema 0 vectors are byte-for-byte unchanged", () => {
    // Pinned pre-0.4.0 outputs — if these move, existing tags break.
    expect(toDataSuffix("baseapp")).toBe(
      "0x62617365617070070080218021802180218021802180218021",
    );
    expect(toDataSuffix("celo")).toBe(
      "0x63656c6f040080218021802180218021802180218021",
    );
  });

  it("Schema 0 decode shape is unchanged (no role fields)", () => {
    const parsed = fromDataSuffix(toDataSuffix(["minipay", "celo_b7k3p9da"]));
    expect(parsed).toEqual({
      codes: ["minipay", "celo_b7k3p9da"],
      schemaId: 0,
    });
    expect(parsed && "app" in parsed).toBe(false);
  });

  it("still returns null for Schema 1", () => {
    const schema1 = Attribution.toDataSuffix({
      codes: ["celo_b7k3p9da"],
      codeRegistry: {
        address: "0x000000000000000000000000000000000000dEaD",
        chainId: 42220,
      },
    });
    expect(fromDataSuffix(schema1)).toBeNull();
  });

  it("returns null for a Schema 2 map with no codes", () => {
    // Metadata-only Schema 2 tag: structurally valid, nothing to credit.
    const suffix = Attribution.toDataSuffix({
      id: 2,
      metadata: { hello: "world" },
    } as Parameters<typeof Attribution.toDataSuffix>[0]);
    expect(fromDataSuffix(suffix)).toBeNull();
  });
});
