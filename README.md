# Celo Builder Codes

ERC-8021 builder-code attribution **on Celo**. One small suffix at the end of a transaction makes it identifiable as having come through your app.

Built for, in priority order: **MiniPay** apps, **Proof of Ship** cohort projects, and **Celo ecosystem** projects more broadly. Celo-only — ERC-8021 is the standard we conform to, nothing more.

## Pick the doc for your role

- **You're shipping an app on Celo and want your transactions attributed?** → [**BUILDERS.md**](BUILDERS.md)
- **You're writing a parser, indexer, or Dune model that reads tagged Celo transactions?** → [**INDEXERS.md**](INDEXERS.md)

## What's in this repo

```
.
├── README.md                      (this overview)
├── BUILDERS.md                    (for app builders)
├── INDEXERS.md                    (for parsers, indexers, Dune models)
├── CLAUDE.md                      (project context, conventions)
├── sdk/                           (the npm package — @gigahierz/builder-codes)
│   ├── src/index.ts
│   ├── tests/
│   ├── package.json
│   └── README.md                  (full SDK API reference)
├── docs/
│   ├── implementation-plan.md     (the original plan + May 7 update)
│   ├── minipay-attribution.md     (auto-derive design rationale)
│   └── integration-reports/
│       └── mondeto.md             (first real consumer integration)
└── .claude/commands/              (Claude Code slash commands for testing)
```

## Status

Pre-release. The SDK is published as `@gigahierz/builder-codes@0.1.0-rc.1` on the `next` tag while we wait for `@celo-org` publish rights. Once those land, the package will be republished as `@celo-org/builder-codes@0.1.0` and `@gigahierz/builder-codes` will be deprecated with a redirect message. The wire format and the derivation algorithm are stable; only the npm name changes.

## Contact

Lena Hierzi (DevRel Lead, Celo Core Co) — file an issue or reach out on Telegram / Discord.

## License

MIT.
