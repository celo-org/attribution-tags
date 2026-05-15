# MiniPay Builder-Code Integration Spec

**Lena Hierzi, DevRel Lead, Celo Core Co — 13 May 2026**
**Status:** Draft for MiniPay review

## 1. Summary

This document captures the decisions from a recent design review and proposes a concrete onboarding flow for integrating ERC-8021 builder-code attribution with MiniPay mini apps. The headline shift from the original scoping: **no manual key issuance**. Suffixes are derived deterministically from the app's hostname, client-side, with zero MiniPay or Celo involvement at integration time.

The full design rationale lives in [`minipay-attribution.md`](minipay-attribution.md). This doc is the externally-shareable version: what an app team needs to do, end to end.

## 2. Resolved decisions

**Hostname-based derivation, computed client-side.** The SDK reads `window.location.hostname` and derives the suffix via SHA-256. The full hostname is hashed (including subdomain), not the eTLD+1. `melorize.vercel.app` and `someotherapp.vercel.app` produce different suffixes; `app.blockfall.xyz` and `blockfall.xyz` also differ. Path and query string are **not** included.

**No manual key issuance.** The original flow (form → server issues key → developer copies it in) is dropped. Developers add one line of SDK code; the suffix appears automatically. This removes a class of integration errors and removes MiniPay from the critical path.

**Off-chain integrity check at the attribution layer, not the SDK.** Attribution credits a code only if its hostname is in MiniPay's approved-app list. Spoofed codes from outside that list are invisible to the dashboard. The SDK's job is to label transactions; integrity moves to the indexing/dashboard layer where the approved-app list is enforced. This makes the SDK simple and the attribution defensible without cryptographic theatre.

**Optional ground-truth log at the distribution server.** The Vercel server that hosts the SDK docs / registration form logs origin headers on every fetch, building a `hostname → suffix → first-seen` mapping. Used for spot-checking and dispute resolution, not gating.

## 3. Technical specification

### 3.1 Suffix derivation

```
suffix = "celo_" + first_12_hex_chars(SHA-256(normalise(hostname)))
```

Normalisation rules (applied identically in the SDK and on the server):

- Lowercase, trim whitespace
- Strip leading `www.` so `www.mondeto.app` and `mondeto.app` collapse to the same suffix
- No protocol, no path, no query, no port, no trailing dot

Output format: `celo_` + 12 lowercase hex characters. Derivation is deterministic and public — anyone can compute any app's suffix from its hostname. This is intentional.

### 3.2 Reference implementation

The canonical implementation is `codeFromHostname` in [`sdk/src/index.ts`](../sdk/src/index.ts). The relevant slice:

```ts
export function codeFromHostname(hostname: string): string {
  let normalized = hostname.toLowerCase();
  if (normalized.startsWith("www.")) normalized = normalized.slice(4);
  const digest = OxHash.sha256(Bytes.fromString(normalized), { as: "Hex" });
  return `celo_${digest.slice(2, 14)}`;
}
```

For the on-the-wire ERC-8021 encoding (length, schema byte, marker), see [`sdk/src/index.ts`](../sdk/src/index.ts)'s `toDataSuffix` — it wraps `ox/erc8021`'s reference encoder.

### 3.3 Pinned test vectors

If a reimplementation produces these values for these hostnames, the derivation is correct. All independently verified against `shasum -a 256` (and against the vector tests in [`sdk/tests/hostname.test.ts`](../sdk/tests/hostname.test.ts)).

| Hostname | Suffix |
|---|---|
| `mondeto.app` | `celo_b057492a5aa5` |
| `celo.org` | `celo_8549372f8229` |
| `minipay.io` | `celo_51e519342b9a` |
| `app.mondeto.app` | `celo_1a8ba29dac7a` |
| `mondeto.vercel.app` | `celo_04168799c492` |

Sanity check from any shell:

```bash
printf "%s" "mondeto.app" | shasum -a 256 | cut -c1-12
# → b057492a5aa5
```

### 3.4 Decision: 12-char namespace

The namespace is `celo_xxxxxxxxxxxx` — 12 hex chars after the `celo_` prefix, 48 bits of entropy. Birthday-bound collision probability gets meaningful around ~2.3 million registered apps, which is comfortable headroom for MiniPay scale.

(For context: the original prototype used 8 chars / 32 bits, where collisions start showing up around ~9k apps — too tight given MiniPay's developer base.)

## 4. Anti-faking — short version

On-chain data is public. Once a tagged tx is on-chain, anyone can copy the code and reuse it. Cryptographic suffixes (HMAC, signed attestations) don't help: as soon as a real tagged tx hits the chain, the code is public, so attackers harvest live codes instead of computing them.

The defense is at the **attribution layer**, not the SDK:

- MiniPay maintains an approved-app list (existing developer intake — no second registration needed)
- The Dune model credits a tx only if its decoded hostname is on that list
- Spoofed codes from outside the list still appear on-chain but never credit any app

Worst-case outcome of within-list spoofing (someone tagging txs with another approved app's suffix): inflated stats for the legitimate app. No funds move based on the SDK alone — anti-fraud lives in whatever distribution decisions MiniPay makes downstream, not in the SDK.

### 4.1 V2: stronger guarantees (out of scope for this spec)

Two complementary additions are worth scoping later:

- **MiniPay wallet-level attribute.** MiniPay prepends `minipay` to every tx through the MiniPay EOA. Apps stack their own suffix on top. A spoofer would need to fake both. Cheap upgrade, large security gain. See [`minipay-wallet-integration.md`](minipay-wallet-integration.md).
- **Signed attestation.** App holds a domain-bound key, signs each tx, attribution counts only when the signature verifies. Heavier; probably overkill for current scale.

## 5. Proposed onboarding flow

### Step 1 — Developer submits a registration form

Form fields:

- App name
- **App URL** (paste-anything: `mondeto.app`, `https://mondeto.app/`, `https://app.blockfall.xyz/play?ref=x` all work — server-side normalisation extracts the hostname)
- Contact email
- MiniPay developer-intake link (cross-reference against the existing MiniPay intake)

The form **echoes the derived hostname back** to the developer before submission:

> **Your app's URL**
> `https://mondeto.app/`
> _We'll register attribution for: **`mondeto.app`**_

This catches typos, accidental `www.` vs apex mismatches, accidentally pasted Vercel preview URLs, and developers copying the wrong subdomain. The echo-back uses the same normalisation function the SDK uses at runtime, so the form's display value, the Airtable record, and the SDK's auto-derived value all agree.

Hosted on the existing Vercel distribution server. Submissions written to Airtable.

Validation on submit:

- Extracted hostname is reachable and returns a 2xx
- MiniPay developer-intake has been completed (cross-reference against the existing intake list)

### Step 2 — Server auto-issues a confirmation email

Triggered by Airtable webhook → Vercel function → email provider.

Email contents:

```
Subject: Your Celo attribution suffix is ready

Hi [name],

Your app [hostname] is registered for builder-code attribution.

Your suffix: celo_b057492a5aa5

This suffix was derived from your hostname and will be automatically
applied by the SDK — you do not need to enter it manually.

To integrate:

  npm install @celo/builder-codes

  import { toDataSuffix, codeFromHostname } from '@celo/builder-codes';

  const suffix = toDataSuffix(codeFromHostname(window.location.hostname));
  // Append `suffix` to your tx.data field, or pass `dataSuffix: suffix`
  // to wagmi's writeContract.

Once integrated, send us a test transaction hash to confirm:
  https://[server]/verify?app=[app_id]&tx=0x...

Docs: [link]
```

### Step 3 — Developer integrates the SDK

One-line install, one-line call. Suffix is auto-derived; nothing to copy or paste.

### Step 4 — Developer submits proof-of-integration via tx hash

Developer sends a tx hash via the verification endpoint. The server:

1. Fetches the tx from a Celo RPC.
2. Calls `fromDataSuffix(tx.input)` to extract the embedded suffix.
3. Compares against `codeFromHostname(registered_hostname)`.
4. Marks the app as **verified** in Airtable on match; flags for review on mismatch.

### Step 5 — Ongoing attribution

The Dune dashboard (MVP) and custom indexer (V2) query transactions by suffix and roll up metrics per registered app. Verified apps appear in the public attribution dashboard.

## 6. Open questions for MiniPay

1. **Wallet-level attribute.** Can MiniPay add a wallet-claimed `minipay` code on every tx through the MiniPay wallet, on top of the app-level suffix? This would meaningfully harden V2 without changing the app integration. Concrete recommendation in [`minipay-wallet-integration.md`](minipay-wallet-integration.md).
2. **Suffix length.** Decided internally: 12 chars (`celo_xxxxxxxxxxxx`). Flagging here so MiniPay knows the namespace shape before any tooling on their side reads suffixes from chain.
3. **Existing intake form.** If MiniPay's existing developer intake is shared, our registration form can point at the same fields, or accept the MiniPay intake submission as the trigger directly.
4. **First test app.** Picking an already-live mini app for end-to-end testing rather than waiting on a new submission.

## 7. Pre-circulation checklist (internal)

### To verify

- **Pinned hash vectors.** Re-run the reference implementation against each row in section 3.3 once before publishing so the doc is self-consistent. Add 2–3 more vectors at the same time so MiniPay can sanity-check their own implementation against more than one data point.
- **SDK function signatures.** `toDataSuffix` / `fromDataSuffix` / `verifyTx` / `codeFromHostname` are reconciled against [`sdk/src/index.ts`](../sdk/src/index.ts). Confirm again before circulating.
- **ERC-8021 tail-marker format.** The decoder in the SDK assumes the suffix is appended at the tail of `tx.input` with marker `0x80218021…×8`. This matches the ERC-8021 reference vector — see `sdk/tests/vectors.test.ts`.

### To decide

- ~~**Suffix length.** Currently 8 hex chars.~~ **Decided: 12 chars.** SDK updated to match; vectors recomputed; tests pinned.
- **Verification endpoint shape.** Section 5 step 4 specifies a `GET /verify?app=...&tx=...`. A `POST` with a small developer-facing UI (paste tx hash → see verification result inline) might be friendlier. Pick one before building.
- **Talent Protocol passport gating.** Deferred to V2. Confirm this is the right call.

### Deliberately not included

- **Pure runtime derivation with no declared hostname.** Appealing for zero-touch onboarding but breaks the verification step (step 4) — there's nothing to compare the on-chain suffix against. The declared hostname exists for verification and dispute resolution, not for derivation itself; they're orthogonal.
- **Per-tx signed attestation.** Mentioned briefly in section 4.1 as a V2 option. Out of scope here.

## 8. Timeline

- **SDK MVP + reference implementation** — ready; pinned vectors documented and tested.
- **Vercel registration server + email flow** — next.
- **First test app integrated end-to-end** — target before the May 2026 Proof of Ship cohort.

## 9. Appendix: what changed from the original scoping doc

| Original | Updated |
|---|---|
| Manual key issuance via form + Airtable | Deterministic client-side derivation |
| Distribute keys per app via email | Auto-derived; email confirms only |
| Talent Protocol passport gating at issuance | Deferred to V2; not in critical path |
| `celo_xxxxxxxx` (8 hex) | `celo_xxxxxxxxxxxx` (12 hex) — decided |
| Server-side validation as gate | Server-side validation as ground-truth log |
