import { describe, it, expect } from "vitest";
import { toDataSuffix, fromDataSuffix, ERC_8021_MARKER } from "../src/index.js";

describe("toDataSuffix wire format", () => {
  it("matches the canonical ERC-8021 vector for 'baseapp'", () => {
    // Verified against ox/erc8021's Attribution.toDataSuffix.
    // Layout: [code:7][length:0x07][schema:0x00][marker:16]
    expect(toDataSuffix("baseapp")).toBe(
      "0x62617365617070070080218021802180218021802180218021"
    );
  });

  it("matches the canonical vector for 'celo'", () => {
    // Layout: [code:4][length:0x04][schema:0x00][marker:16]
    expect(toDataSuffix("celo")).toBe(
      "0x63656c6f040080218021802180218021802180218021"
    );
  });

  it("encodes a celo_xxxxxxxx code correctly", () => {
    const suffix = toDataSuffix("celo_b7k3p9da");
    // length(1) + code(13) + schema(1) + marker(16) = 31 bytes = 62 hex
    expect(suffix.length).toBe(2 + 31 * 2);
    expect(suffix.endsWith("80218021802180218021802180218021")).toBe(true);
  });

  it("supports multi-code (platform + app)", () => {
    const suffix = toDataSuffix(["proofofship", "celo_b7k3p9da"]);
    const parsed = fromDataSuffix(suffix);
    expect(parsed?.codes).toEqual(["proofofship", "celo_b7k3p9da"]);
  });
});

describe("fromDataSuffix round-trip", () => {
  for (const codes of [
    ["celo"],
    ["celo_b7k3p9da"],
    ["baseapp"],
    ["proofofship", "celo_b7k3p9da"],
    ["minipay", "celo_xxxx1234"],
  ] as const) {
    it(`round-trips ${codes.join(",")}`, () => {
      const suffix = toDataSuffix(codes);
      const parsed = fromDataSuffix(suffix);
      expect(parsed?.codes).toEqual([...codes]);
      expect(parsed?.schemaId).toBe(0);
    });
  }

  it("returns null for non-tagged data", () => {
    expect(fromDataSuffix("0xdeadbeef")).toBeNull();
  });
});

describe("validation", () => {
  it("rejects invalid codes", () => {
    expect(() => toDataSuffix("Invalid Code")).toThrow();
    expect(() => toDataSuffix("with,comma")).toThrow();
    expect(() => toDataSuffix("")).toThrow();
    expect(() => toDataSuffix("a".repeat(33))).toThrow();
  });
});

describe("constants", () => {
  it("exposes the canonical marker", () => {
    expect(ERC_8021_MARKER).toBe("0x80218021802180218021802180218021");
  });
});
