# Claude Code custom commands

Project-specific slash commands. Type `/<name>` in Claude Code to invoke.

| Command | What it does |
|---|---|
| `/test-fixture [code]` | Sends a tagged tx on Celo Sepolia, prints the hash for sharing with Chidi as parser test data. Defaults to code `celo_test1234`. |
| `/check-airtable [query]` | Looks up codes in the Airtable distribution table. No arg = list recent 20. Pass a `celo_xxxxxxxx` code for an exact match, or any other string to search by display name or telegram. |
| `/verify-tx <hash>` | Fetches a tx from Celo Mainnet (falls back to Sepolia) and decodes its ERC-8021 builder code suffix. |
| `/decode <hex>` | Takes a raw hex string and parses it as an ERC-8021 dataSuffix. Useful for debugging without an RPC roundtrip. |

## Adding more

Each command is a markdown file in this directory. The body of the file is the prompt sent to Claude when the command is invoked. `$ARGUMENTS` is replaced with whatever the user types after the command name.

Lena's standing prefs (USDT-on-Celo for payments, name+title+date on docs, etc.) are in `../../CLAUDE.md` and apply automatically.
