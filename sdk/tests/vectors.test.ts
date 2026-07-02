import { describe, it, expect } from "vitest";
import { Attribution } from "ox/erc8021";
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

  it("round-trips a joined code field longer than 32 bytes", () => {
    // Three codes whose comma-joined field is > 32 bytes. Legal on the
    // wire: 32 bounds a single code, the length byte bounds the field.
    const codes = ["proofofship", "celo_b7k3p9da", "celo_x4m2q8wf"] as const;
    const parsed = fromDataSuffix(toDataSuffix(codes));
    expect(codes.join(",").length).toBeGreaterThan(32);
    expect(parsed?.codes).toEqual([...codes]);
  });
});

describe("schema strictness", () => {
  it("returns null for a Schema 1 (custom registry) suffix", () => {
    const schema1 = Attribution.toDataSuffix({
      codes: ["celo_b7k3p9da"],
      codeRegistry: {
        address: "0x000000000000000000000000000000000000dEaD",
        chainId: 42220,
      },
    });
    expect(fromDataSuffix(schema1)).toBeNull();
  });

  it("returns null for an empty code field", () => {
    // [length:0x00][schema:0x00][marker] — structurally valid, no codes.
    const empty = `0x0000${ERC_8021_MARKER.slice(2)}` as const;
    expect(fromDataSuffix(empty)).toBeNull();
  });
});

describe("validation", () => {
  it("rejects invalid codes", () => {
    expect(() => toDataSuffix("Invalid Code")).toThrow();
    expect(() => toDataSuffix("with,comma")).toThrow();
    expect(() => toDataSuffix("")).toThrow();
    expect(() => toDataSuffix("a".repeat(33))).toThrow();
  });

  it("rejects a joined code field longer than 255 bytes", () => {
    // 8 codes × 32 chars + 7 commas = 263 bytes joined — over the
    // single length byte's capacity. Each code alone is valid.
    const codes = Array.from({ length: 8 }, (_, i) =>
      String.fromCharCode(97 + i).repeat(32),
    );
    expect(() => toDataSuffix(codes)).toThrow(/255/);
  });
});

describe("constants", () => {
  it("exposes the canonical marker", () => {
    expect(ERC_8021_MARKER).toBe("0x80218021802180218021802180218021");
  });
});
