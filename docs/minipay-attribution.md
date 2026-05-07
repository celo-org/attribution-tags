# MiniPay attribution: auto-derive flow

**Lena Hierzi, DevRel Lead, Celo Core Co — 7 May 2026**

## What MiniPay is asking for

Strip out the back-and-forth and Vinay's request is one sentence: **no human in the loop, no registration, no key delivery.** The mini-app developer should never have to talk to anyone or fill out anything specifically for builder codes. From his perspective, every extra step is a coordination tax he has to pay across hundreds of developers — and most of his developers are not in direct touch with anyone at Celo.

His preferred shape: drop a single SDK package into a mini app, the SDK reads `window.location.hostname` at runtime, derives a deterministic code from that hostname, and starts tagging. No backend call, no key, no Airtable, no form. The same code from `mondeto.app` produces the same suffix every time, anywhere in the world, without any service in between.

He raised one technical constraint: **don't derive from just the top-level domain.** Some mini apps live on shared hosts like `mondeto.vercel.app` or `app.blockfall.xyz`, so we have to use the full hostname (subdomain included) — otherwise every Vercel-hosted app collides into one code.

He also raised an integrity concern earlier in the call ("people may try to fake this"). At the SDK layer this is unsolvable, but at the attribution layer we only credit codes whose hostname is in MiniPay's approved-app list. **MiniPay's existing intake form *is* the registration. We don't need a second one.**

This is a meaningfully different design from the Talent Protocol / Airtable path. Both can coexist — but for MiniPay, throw out the form.

## Cryptographic options considered

**1. Plain hash of hostname.** `code = "celo_" + sha256(hostname)[0..4]`. Deterministic, runs in the browser, no server, no key. The hostname is not recoverable from the code (one-way function). Anyone can compute the same code by running the same hash on the same hostname. Zero secrets, zero infrastructure.

**2. HMAC with a server-side secret.** Same shape but with a secret key. External parties can't pre-compute codes for arbitrary hostnames. But the secret has to live somewhere — client-side it leaks the moment anyone inspects the SDK; server-side we're back to the API call Vinay didn't want. And once any tagged tx is on-chain, the code is public anyway, so attackers just copy real codes from the chain instead of computing them. The HMAC buys very little.

**3. Domain-bound cryptographic proof.** App proves it controls the domain via a signed challenge. Solves spoofing properly but is significant engineering; overkill for an MVP.

**Decision: plain hash.** The "can't fake codes" property is unachievable as long as on-chain data is public — that's a property of the medium, not the encoding. Defense moves to the attribution layer: the Dune model only credits a code if the corresponding hostname is in MiniPay's approved-app list. Anyone tagging fake codes from outside the approved list is invisible to the dashboard.

## Derivation algorithm

1. Take `window.location.hostname`
2. Lowercase it
3. Strip leading `www.` (so `www.mondeto.app` and `mondeto.app` are the same app)
4. SHA-256 of the bytes
5. Take the first 4 bytes (8 hex chars — 4.3 billion possible codes, collision probability negligible up to hundreds of thousands of apps)
6. Prefix with `celo_`

Result for `mondeto.app` looks like `celo_b057492a`. Same input, same output, anywhere it runs. Subdomains produce different codes (so `mondeto.vercel.app` ≠ `app.blockfall.xyz`, per Vinay's constraint).

The full multi-code suffix every MiniPay mini app sends becomes: **`minipay,celo_b057492a`** — platform-level attribution to MiniPay plus app-level attribution to the app, in a single tag, derived entirely automatically.

## Pinned hash vectors (for testing)

| hostname              | code            |
|-----------------------|-----------------|
| `mondeto.app`         | `celo_b057492a` |
| `celo.org`            | `celo_8549372f` |
| `minipay.io`          | `celo_51e51934` |
| `app.mondeto.app`     | `celo_1a8ba29d` |
| `mondeto.vercel.app`  | `celo_04168799` |

If the implementation produces these values for these hostnames, derivation is correct.

These vectors are independently verified against `shasum -a 256` (see `sdk/tests/hostname.test.ts`).

## How to test on any random app

Three concrete things to do once the demo HTML is deployed:

1. **Open it on three different domains** — the live deploy URL, `localhost`, and a custom domain. Confirm each gets a different code.
2. **Type real mini app domains into the "try another" box** — `mondeto.app`, `bitgifty.com`, etc. Pre-populate the Dune lookup table with these once MiniPay's intake list is shared.
3. **Test idempotence** — same hostname twice, with/without `www.`, different cases. All produce the same code. That's the property that lets MiniPay drop the SDK in once and never touch it again.

## Open questions

- **Two intake paths share a namespace.** Auto-derive (MiniPay) and explicit-form (Proof of Ship) both produce `celo_xxxxxxxx`. When Chidi sees `celo_b057492a`, how does he know which lookup table to check? Easiest answer: check both, prefer the explicit registration if present. 10-min sync with him before he starts coding.

- **MiniPay's approved-app list location.** Vinay said he'll share his intake form output. Cleanest path: he adds Lena and Chidi as collaborators on whatever sheet/Airtable the form feeds into; Chidi pulls hostnames, computes SHA-256 prefixes, builds the MiniPay lookup table. Pin down before Friday.

- **MiniPay-side change is even smaller than estimated.** They don't need the full SDK — just `toDataSuffix` (or hardcode the encoding) and prepend `minipay,` to every tx the wallet signs. The mini app's own SDK handles the auto-derive for the app code. ~1 hour of their work, easier yes.
