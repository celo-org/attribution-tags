# Celo Attribution Tags

ERC-8021 attribution **on Celo**. One small suffix at the end of a transaction makes it identifiable as having come through your app.

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
└── sdk/                           (the npm package — @celo/attribution-tags)
    ├── src/index.ts
    ├── tests/
    ├── package.json
    └── README.md                  (full SDK API reference)
```

## Status

The SDK is published on npm as [`@celo/attribution-tags`](https://www.npmjs.com/package/@celo/attribution-tags). The wire format and derivation algorithm are stable.

## Contact

Lena Hierzi (DevRel Lead, Celo Core Co) — file an issue or reach out on Telegram / Discord.

## License

MIT.
