import { describe, it, expect, vi } from "vitest";

// Regression guard for the `ox` floor. `serviceCodes` (the ERC-8021 Schema 2
// `s` key) only landed in ox 0.14.12: older versions' `getSchemaId` checks
// `appCode` / `walletCode` / `codeRegistry` only and ignores the explicit
// `id`, so a service-only tag falls through to the Schema 0 encoder (empty
// suffix) and an app+service tag silently drops the service codes.
//
// package.json pins `ox >= 0.14.12`, but a consumer can still force an older
// ox with an override or a stale transitive pin. This file mocks ox back to
// the pre-0.14.12 behaviour and asserts toRoleDataSuffix fails loudly instead
// of emitting a corrupt tag. Kept in its own file so the mock stays isolated.
vi.mock("ox/erc8021", async (importOriginal) => {
  const original = await importOriginal<typeof import("ox/erc8021")>();
  return {
    ...original,
    Attribution: {
      ...original.Attribution,
      toDataSuffix(attribution: Record<string, unknown>) {
        const hasAppOrWallet =
          "appCode" in attribution || "walletCode" in attribution;
        // Pre-0.14.12: no app/wallet code means Schema 0, and Schema 0 reads
        // `codes` — which a role attribution never has.
        if (!hasAppOrWallet)
          return original.Attribution.toDataSuffix({ codes: [] });
        // Pre-0.14.12: Schema 2 is selected, but the CBOR builder never reads
        // `serviceCodes`.
        const { appCode, walletCode } = attribution as {
          appCode?: string;
          walletCode?: string;
        };
        return original.Attribution.toDataSuffix({
          ...(appCode !== undefined && { appCode }),
          ...(walletCode !== undefined && { walletCode }),
        });
      },
    },
  };
});

const { toRoleDataSuffix } = await import("../src/index.js");

describe("ox floor guard", () => {
  it("throws instead of emitting an empty Schema 0 tag for a service-only tag", () => {
    expect(() => toRoleDataSuffix({ service: "celo_agent" })).toThrow(
      /ox >= 0\.14\.12/,
    );
  });

  it("throws instead of silently dropping service codes", () => {
    expect(() =>
      toRoleDataSuffix({ app: "celo_x", service: ["celo_agent"] }),
    ).toThrow(/ox >= 0\.14\.12/);
  });

  it("still encodes app / wallet tags, which old ox handles correctly", () => {
    expect(() =>
      toRoleDataSuffix({ app: "celo_x", wallet: "celo_facil" }),
    ).not.toThrow();
  });
});
