Send a tagged transaction on Celo Sepolia and report the result so it can be shared with Chidi for parser validation.

Use the SDK in `sdk/` (build it first if `dist/` doesn't exist).

Steps:

1. Read `PRIVATE_KEY` and `CELO_SEPOLIA_RPC_URL` from `.env`. If `.env` doesn't exist or either var is missing, abort with a message telling the user what to set. Default RPC: `https://forno.celo-sepolia.celo-testnet.org`.

2. Determine the code(s) to use:
   - If `$ARGUMENTS` is empty, use `celo_test1234`.
   - If `$ARGUMENTS` contains a comma, split on comma and pass as an array (multi-code).
   - Otherwise pass as a single code.
   - Validate every code matches `/^[a-z0-9_]{1,32}$/` before encoding.

3. Compute the dataSuffix using `toDataSuffix` from `@celo-org/builder-codes` (or the local SDK source if not yet published).

4. Build a viem `WalletClient` on Celo Sepolia using the private key. Send a self-transfer of `0.001 CELO` to the wallet's own address, with the dataSuffix appended to (or used as) the calldata.

5. Wait for one confirmation.

6. Print:
   - Tx hash
   - Code(s) used
   - Encoded suffix (hex)
   - Block explorer link: `https://celo-sepolia.blockscout.com/tx/{hash}`
   - A copy-pasteable Telegram message for Chidi:
     ```
     Parser test fixture on Celo Sepolia:
     hash: {hash}
     codes: {codes}
     expected suffix at end of input: {suffix}
     explorer: https://celo-sepolia.blockscout.com/tx/{hash}
     ```

7. If the wallet has insufficient balance, suggest the user request Sepolia CELO from `https://faucet.celo.org/celo-sepolia` and stop — do not attempt the send.
