# Integration Report — Mondeto

**Date:** 2026-05-08
**SDK version:** `@celo-org/builder-codes@0.1.0` (local tarball)
**Consumer:** Mondeto (Next.js 14 + wagmi 2 + viem 2 + Privy, pnpm + Turborepo monorepo)
**Outcome:** Working end-to-end. One real on-chain transaction tagged and decoded successfully.

---

## What was integrated

The buy-pixel flow in Mondeto issues two writes (USDT `approve` + `Mondeto.buyPixels`) via wagmi's `useWriteContract`. The integration appends an ERC-8021 attribution suffix to both via wagmi's built-in `dataSuffix` parameter — no manual calldata assembly needed.

**Codes used:** `["minipay", codeFromHostname(window.location.hostname)]`

**Files touched in the consumer repo:**
- `apps/web/package.json` — `pnpm add` of the tarball
- `apps/web/src/lib/builderCode.ts` *(new, 16 lines)* — caches the suffix, SSR-guarded
- `apps/web/src/hooks/useBuyPixels.ts` — passes `dataSuffix` on both `writeContractAsync` calls

The helper:

```ts
import { toDataSuffix, codeFromHostname } from '@celo-org/builder-codes'
import type { Hex } from 'viem'

let cached: Hex | null = null

export function getBuilderCodeSuffix(): Hex | undefined {
  if (typeof window === 'undefined') return undefined
  if (cached) return cached
  try {
    const codes = ['minipay', codeFromHostname(window.location.hostname)]
    cached = toDataSuffix(codes) as Hex
    return cached
  } catch (e) {
    console.warn('builder-codes suffix failed:', e)
    return undefined
  }
}
```

---

## On-chain verification

A live `buyPixels` transaction on Celo Sepolia carried this calldata:

```
0x1dc8055b
  0000…0020                                      ← offset
  0000…0001                                      ← array length (1)
  0000…1793                                      ← pixel id 6035
  6d696e697061792c63656c6f5f3439393630646535     ← "minipay,celo_49960de5"
  15                                             ← codes length (21 bytes)
  00                                             ← schema id 0
  80218021802180218021802180218021               ← ERC-8021 marker
```

`codeFromHostname("localhost")` resolved to `celo_49960de5`. The marker, length byte, schema byte, and codes string all decode cleanly with `fromDataSuffix`. The tx was accepted and executed normally — no gas overhead concern, no contract revert.

---

## What worked well

- **Install was a non-event.** `pnpm add /path/to/tgz` resolved `ox` automatically. No tsconfig changes, no Next.js webpack config tweaks. ESM-only package consumed cleanly by Next 14 + Webpack.
- **`Hex.Hex` from `ox` is structurally compatible with viem's `Hex`** — a single `as Hex` cast is enough; no shape mismatch at runtime.
- **The wagmi `dataSuffix` integration point is the right abstraction.** Consumers don't need to know the ERC-8021 byte layout to ship attribution. One-line API + one wagmi parameter.
- **`codeFromHostname` removes the registration step entirely** for self-attributing apps. Real-world MiniPay teams will appreciate not needing to coordinate with an off-chain registry to ship a suffix.
- **`peerDependenciesMeta.viem.optional = true`** lets the type-only viem imports stay in `verifyTx` without forcing the dep on consumers who only tag.
- **Type-check passed first try** with no `any` casts beyond the documented `Hex` interop.

---

## Friction / suggestions

1. **README example uses `npm install`.** Mondeto is a pnpm + Turborepo workspace, so the install command had to be translated to `pnpm add`. Worth showing both, or noting "use your package manager's tarball install". Minor.

2. **Tarball installs hard-code an absolute path** in `package.json` (`"file:/Users/lenahierzi/…"`), which is fine for a personal test but unshareable. The README could note that `npm pack` + tarball is for local-test workflows only, and that publishing to npm or a workspace `link:` is the path for actual integration.

3. **SSR-safety isn't called out.** `codeFromHostname(window.location.hostname)` is browser-only. In a Next.js App Router project, calling it during render in a server component would throw. The integration guide for Next.js consumers should suggest the `typeof window === 'undefined'` guard or memoization in a client-only module. This bit me on the first attempt; the fix is one line, but the docs should preempt it.

4. **`fromDataSuffix` returning `null` on bad input is good**, but the schema-id check could be tighter — currently it returns whatever `Attribution.getSchemaId` produces, including for non-zero schemas the SDK doesn't know about. Consumers verifying their own tx can't tell from the return type whether they're on an expected schema. A `expectedSchemaId?: number` arg or an explicit `schemaId === 0` filter would make consumer code shorter.

5. **No exported type for the cached suffix shape.** The SDK exports `DecodedSuffix` but not a named type for the `toDataSuffix` return (it's `Hex.Hex` from ox). Consumers using viem will reach for `viem`'s `Hex` and cast — works fine, but a re-exported `BuilderCodeSuffix = Hex.Hex` alias would document the intent.

6. **`codeFromHostname` strips `www.` but nothing else.** Mondeto runs on Vercel preview URLs (`mondeto-fe-git-feat-x.vercel.app`), which would each get a distinct code. That's probably the right behavior, but the `minipay-attribution.md` design doc doesn't say so explicitly — worth a sentence on whether preview/staging hostnames are expected to attribute distinctly, and if so, how teams should aggregate them.

---

## Severity summary

| Issue | Severity |
|---|---|
| README pnpm/npm wording | docs nit |
| Tarball install path is absolute | docs nit |
| SSR-safety not documented | docs gap (real bite) |
| `fromDataSuffix` schema-id ergonomics | minor API |
| Missing `BuilderCodeSuffix` type re-export | minor API |
| Preview-URL behavior under-specified | docs gap |

Nothing blocking. The SDK shipped a working integration in well under an hour of consumer-side work, including the cache-clear + dev-server cycle from the dep install.

---

## Verbatim integration diff (for reproducibility)

```diff
# apps/web/package.json
+ "@celo-org/builder-codes": "file:/path/to/celo-org-builder-codes-0.1.0.tgz",

# apps/web/src/lib/builderCode.ts (new file, see body above)

# apps/web/src/hooks/useBuyPixels.ts
+ import { getBuilderCodeSuffix } from '@/lib/builderCode'
  …
+ const dataSuffix = getBuilderCodeSuffix()
  …
  await writeContractAsync({
    address: usdtAddress, abi: USDT_ABI,
    functionName: 'approve', args: [MONDETO_ADDRESS, generousApprove],
+   dataSuffix,
  })
  …
  await writeContractAsync({
    address: MONDETO_ADDRESS, abi: MONDETO_ABI,
    functionName: 'buyPixels', args: [bigIds],
+   dataSuffix,
  })
```
