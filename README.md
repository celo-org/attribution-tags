# Celo Builder Codes

ERC-8021 builder-code attribution **on Celo**. One small suffix at the end of a transaction makes it identifiable as having come through your app.

Built for, in priority order: **MiniPay** apps, **Proof of Ship** cohort projects, and **Celo ecosystem** projects more broadly. Celo-only — ERC-8021 is the standard we conform to, nothing more.

## Pick the doc for your role

- **You're shipping an app on Celo and want your transactions attributed?** → [**BUILDERS.md**](BUILDERS.md)
- **You're writing a parser, indexer, or Dune model that reads tagged Celo transactions?** → [**INDEXERS.md**](INDEXERS.md)
- **You're integrating builder codes into MiniPay (app team)?** → [**docs/minipay-integration-spec.md**](docs/minipay-integration-spec.md)
- **You're on the MiniPay wallet team adding the wallet-level `minipay` claim?** → [**docs/minipay-wallet-integration.md**](docs/minipay-wallet-integration.md)

## What's in this repo

```
.
├── README.md                      (this overview)
├── BUILDERS.md                    (for app builders)
├── INDEXERS.md                    (for parsers, indexers, Dune models)
├── CLAUDE.md                      (project context, conventions)
├── sdk/                           (the npm package — @celo/builder-codes)
│   ├── src/index.ts
│   ├── tests/
│   ├── package.json
│   └── README.md                  (full SDK API reference)
├── docs/
│   ├── implementation-plan.md         (the original plan + May 7 update)
│   ├── minipay-attribution.md         (auto-derive design rationale, internal)
│   ├── minipay-integration-spec.md    (handover spec for MiniPay app teams)
│   ├── minipay-wallet-integration.md  (recommendation for the MiniPay wallet team)
│   └── integration-reports/
│       └── mondeto.md                 (first real consumer integration)
└── .claude/commands/              (Claude Code slash commands for testing)
```

## Status

The SDK is published on npm as [`@celo/builder-codes`](https://www.npmjs.com/package/@celo/builder-codes). The wire format and derivation algorithm are stable.

## Contact

Lena Hierzi (DevRel Lead, Celo Core Co) — file an issue or reach out on Telegram / Discord.

## License

MIT.
