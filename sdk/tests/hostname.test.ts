import { describe, it, expect } from "vitest";
import { codeFromHostname, toDataSuffix } from "../src/index.js";

describe("codeFromHostname — pinned vectors", () => {
  // These five vectors are independently verified against
  // `printf "%s" <hostname> | shasum -a 256`. If any of them ever
  // changes value, the derivation algorithm has drifted and every
  // already-tagged tx in the wild will silently re-attribute.
  const vectors: ReadonlyArray<readonly [string, string]> = [
    ["mondeto.app", "celo_b057492a"],
    ["celo.org", "celo_8549372f"],
    ["minipay.io", "celo_51e51934"],
    ["app.mondeto.app", "celo_1a8ba29d"],
    ["mondeto.vercel.app", "celo_04168799"],
  ];

  for (const [hostname, expected] of vectors) {
    it(`${hostname} → ${expected}`, () => {
      expect(codeFromHostname(hostname)).toBe(expected);
    });
  }
});

describe("codeFromHostname — normalization", () => {
  it("is case-insensitive", () => {
    expect(codeFromHostname("Mondeto.App")).toBe("celo_b057492a");
    expect(codeFromHostname("MONDETO.APP")).toBe("celo_b057492a");
  });

  it("treats www. and bare domain as the same app", () => {
    expect(codeFromHostname("www.mondeto.app")).toBe("celo_b057492a");
    expect(codeFromHostname("mondeto.app")).toBe("celo_b057492a");
  });

  it("only strips a leading www., not www. anywhere else", () => {
    // app.www.mondeto.app is a different host than mondeto.app
    expect(codeFromHostname("app.www.mondeto.app")).not.toBe("celo_b057492a");
  });

  it("treats subdomains as distinct apps", () => {
    expect(codeFromHostname("mondeto.app")).not.toBe(
      codeFromHostname("app.mondeto.app"),
    );
    expect(codeFromHostname("mondeto.vercel.app")).not.toBe(
      codeFromHostname("app.blockfall.xyz"),
    );
  });

  it("is idempotent", () => {
    expect(codeFromHostname("mondeto.app")).toBe(codeFromHostname("mondeto.app"));
  });
});

describe("codeFromHostname — validation", () => {
  it("rejects empty input", () => {
    expect(() => codeFromHostname("")).toThrow();
  });

  it("rejects non-strings", () => {
    expect(() => codeFromHostname(undefined as unknown as string)).toThrow();
    expect(() => codeFromHostname(null as unknown as string)).toThrow();
  });

  it("rejects strings with characters outside hostname charset", () => {
    expect(() => codeFromHostname("with space.app")).toThrow();
    expect(() => codeFromHostname("path/segment.app")).toThrow();
    expect(() => codeFromHostname("with,comma.app")).toThrow();
  });

  it("output passes the SDK's own code validation", () => {
    // The derived code must be a legal input to toDataSuffix, otherwise
    // the very flow this helper exists for would throw downstream.
    const code = codeFromHostname("mondeto.app");
    expect(() => toDataSuffix(code)).not.toThrow();
    expect(() => toDataSuffix(["minipay", code])).not.toThrow();
  });
});
