# Celo Builder Codes — Claude Code Context

## What this project is

A lean ERC-8021 builder-code attribution system for Celo. Audience, in priority order: MiniPay apps, Proof of Ship cohort projects, Celo ecosystem projects more broadly. Celo-only — do not pitch interop with other chains as a feature. Two ship pieces:

1. **SDK** (`sdk/`) — npm package `@celo-org/builder-codes`. Wraps `ox/erc8021` so any Celo app can tag transactions with one line.
2. **Distribution server** (`distribution-server/`) — Next.js form on Vercel. Builders enter Talent Protocol passport ID, Telegram, email; backend validates against TP API, generates a random `celo_xxxxxxxx` code, stores it in Airtable, returns the code.

Chidi (separate workstream, Dune dbt model) reads the Airtable lookup as a Dune-uploaded dataset and joins it against on-chain attributed transactions. Nothing in this repo touches Dune; the bridge is the Airtable.

**Public messaging note: do not mention payouts or rewards anywhere user-facing.** Internal roadmap only.

## Deadlines

- Chidi's dbt model: Fri 8 May 2026
- SDK + distribution server: Wed 13 May 2026
- Target use: May 2026 Proof of Ship cohort

## Key decisions already made

- **Code format:** `celo_xxxxxxxx` — 5-byte prefix + 8 lowercase alphanumeric chars (excluding `0`, `1`, `o`, `l`).
- **Code generation:** server-side, random, collision-checked against Airtable.
- **No on-chain registry.** Codes live in Airtable only. NFT registry is a future phase, intentionally out of scope.
- **No Wagmi sub-export, no viem sub-export, no React hooks.** Single entry point; three exports: `toDataSuffix`, `fromDataSuffix`, `verifyTx`.
- **npm scope:** `@celo-org` (matches `celopedia-skills` and other Celo packages).
- **Wire format:** ERC-8021 Schema 0. Suffix layout (reading left-to-right): `[code:N][length:1][schema:1][marker:16]`. **Length comes AFTER the code, not before** — this is what makes parsing-from-end clean. Marker constant: `0x80218021802180218021802180218021`. Multi-code via comma-delimited list inside the code field.

## Not in scope (do not build)

- NFT registry / Solidity contract
- On-chain payout distributor
- Public claim UI beyond the form
- Leaderboard frontend
- Smart-wallet `wallet_sendCalls` / ERC-5792 capability work
- Agent attribution helpers
- Any messaging that promises rewards or payouts

These are deferred. Don't add them when iterating.

## Conventions

- Lena's standing prefs: documents include her name (Lena), title (DevRel Lead, Celo Core Co), and creation date at the top.
- All payments referenced in any agreement = USDT on Celo.
- Talent Protocol API: `X-API-KEY` header. Base URL `https://api.talentprotocol.com/api/v2`. Endpoint we use: `/passports/{id}` (accepts numeric ID, wallet address, or username).
- The verifier function fetches a tx via viem and decodes the suffix; if no marker present, returns null. No throwing.
- Vector tests are the source of truth for wire-format correctness. The canonical ERC-8021 reference vector — `toDataSuffix("baseapp")` → `0x62617365617070070080218021802180218021802180218021` — is the conformance check used by every ERC-8021 implementation (it's the example string in the ox docs); if ours doesn't match, something is wrong with the `ox` import. This is a standard-conformance check, not a positioning statement — never frame builder-codes as "Base-compatible."

## Layout

```
.
├── CLAUDE.md                          # this file
├── README.md                          # human-facing overview
├── docs/
│   ├── implementation-plan.md         # the sharable plan
│   └── integration-guide.md           # the 1-pager builders read
├── sdk/                               # @celo-org/builder-codes
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   ├── src/index.ts
│   ├── tests/vectors.test.ts
│   └── README.md
└── distribution-server/               # Next.js Vercel app
    ├── package.json
    ├── README.md
    └── src/
        ├── pages/api/claim.ts
        └── lib/
            ├── code-gen.ts
            └── talent-protocol.ts
```

## How to work in this repo

- SDK changes: `cd sdk && npm install && npm test` to run vectors.
- Server changes: `cd distribution-server && npm install && npm run dev`.
- Need a tagged tx fixture for Chidi? Run `/test-fixture` (see `.claude/commands/`) — it sends a tagged self-transfer on Sepolia and prints the hash + a copy-pasteable Telegram message.

## Custom slash commands

In `.claude/commands/`:
- `/test-fixture [code]` — generate a Sepolia tagged tx fixture
- `/check-airtable [query]` — query the codes lookup table
- `/verify-tx <hash>` — decode the suffix on a real Celo tx
- `/decode <hex>` — parse an ERC-8021 suffix offline

See `.claude/commands/README.md` for details.

## Open questions still on the table

- npm scope `@celo-org` confirmed. Publish access? (Confirm with whoever publishes `celo-org/celopedia-skills`.)
- Talent Protocol API key — Lena has one or needs to request from the TP team?
- Domain for the distribution server — `builder-codes.celo.org` (subdomain) vs. Vercel default URL for the test phase. Decision pending; default to Vercel URL until subdomain is wired.
- Whether to ask Talent Protocol to use `proofofship` as a fixed platform code on PoS-tagged actions.
