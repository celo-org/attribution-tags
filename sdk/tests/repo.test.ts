import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { codeFromRepo, toDataSuffix } from "../src/index.js";

// Verbatim copy of the Celo Builders platform derivation
// (celo-org/celo-builders, src/utils/attribution.ts). If the platform
// changes, refresh this copy — the divergence test below exists so the SDK
// and the platform can never silently drift apart.
function deriveAttributionTag(seed: string): string {
  const normalized = seed.trim().toLowerCase();
  return `celo_${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 12)}`;
}

describe("codeFromRepo — pinned vectors", () => {
  // Independently verified with `printf "%s" <slug> | shasum -a 256 | cut -c1-12`.
  const vectors: ReadonlyArray<readonly [string, string]> = [
    ["gigahierz/trading-bot-updown", "celo_7b3c251337be"],
    ["icmelvin/myceloproject", "celo_4d19a013cc70"],
    ["icmelvin/2nd-celo-hackathon", "celo_3712ca0f1cdc"],
  ];

  for (const [slug, expected] of vectors) {
    it(`${slug} → ${expected}`, () => {
      expect(codeFromRepo(slug)).toBe(expected);
    });
  }
});

describe("codeFromRepo — normalization (matches the platform)", () => {
  it("is case-insensitive", () => {
    expect(codeFromRepo("icmelvin/MyCeloProject")).toBe("celo_4d19a013cc70");
    expect(codeFromRepo("ICMELVIN/MYCELOPROJECT")).toBe("celo_4d19a013cc70");
  });

  it("trims surrounding whitespace and newlines", () => {
    expect(codeFromRepo("  gigahierz/trading-bot-updown  ")).toBe("celo_7b3c251337be");
    expect(codeFromRepo("\tgigahierz/trading-bot-updown\n")).toBe("celo_7b3c251337be");
  });

  it("accepts a full GitHub URL and reduces it to owner/repo", () => {
    for (const url of [
      "https://github.com/GigaHierz/trading-bot-updown",
      "https://github.com/gigahierz/trading-bot-updown/",
      "https://github.com/gigahierz/trading-bot-updown.git",
      "http://www.github.com/gigahierz/trading-bot-updown",
      "github.com/gigahierz/trading-bot-updown",
      "https://github.com/gigahierz/trading-bot-updown/tree/main/src",
    ]) {
      expect(codeFromRepo(url)).toBe("celo_7b3c251337be");
    }
  });

  it("different repositories give different codes", () => {
    expect(codeFromRepo("icmelvin/myceloproject")).not.toBe(
      codeFromRepo("icmelvin/2nd-celo-hackathon"),
    );
  });
});

describe("codeFromRepo — never diverges from the platform derivation", () => {
  const inputs = [
    "gigahierz/trading-bot-updown",
    "icmelvin/MyCeloProject",
    "  Owner/Repo  ",
    "owner/repo.with.dots",
    "owner_name/repo-name",
    "OWNER/REPO\n",
    "celo-org/attribution-tags",
  ];

  for (const input of inputs) {
    it(`agrees with deriveAttributionTag(${JSON.stringify(input)})`, () => {
      expect(codeFromRepo(input)).toBe(deriveAttributionTag(input));
    });
  }
});

describe("codeFromRepo — validation", () => {
  it("rejects empty input and non-strings", () => {
    expect(() => codeFromRepo("")).toThrow();
    expect(() => codeFromRepo("   ")).toThrow();
    expect(() => codeFromRepo(undefined as unknown as string)).toThrow();
  });

  it("rejects inputs that are not owner/repo", () => {
    expect(() => codeFromRepo("just-a-repo")).toThrow();
    expect(() => codeFromRepo("owner/repo/extra")).toThrow();
    expect(() => codeFromRepo("owner name/repo")).toThrow();
    expect(() => codeFromRepo("https://gitlab.com/owner/repo")).toThrow();
  });

  it("output passes the SDK's own code validation", () => {
    const code = codeFromRepo("gigahierz/trading-bot-updown");
    expect(() => toDataSuffix(code)).not.toThrow();
  });
});
