Fetch a Celo transaction and decode its ERC-8021 attribution suffix, if any.

`$ARGUMENTS` should be a 0x-prefixed transaction hash (66 chars total).

Steps:

1. Validate `$ARGUMENTS` matches `/^0x[a-fA-F0-9]{64}$/`. If not, ask the user to paste a valid tx hash and stop.

2. Try Celo Mainnet first using viem with RPC `https://forno.celo.org`:
   - `client.getTransaction({ hash })`.
   - If the tx exists, note the network as `celo` and continue.
   - If `getTransaction` throws or returns null, fall through.

3. Try Celo Sepolia with RPC `https://forno.celo-sepolia.celo-testnet.org`:
   - Same call.
   - If found, network = `celo-sepolia`. If still not found, report `tx not found on either network` and stop.

4. Once the tx is fetched, also call `client.getTransactionReceipt({ hash })` to get the success/failure status.

5. Decode the suffix using `fromDataSuffix(tx.input)` from `@celo/attribution-tags` (or the local SDK source).

6. Print a result block:
   ```
   Network: {celo | celo-sepolia}
   Tx hash: {hash}
   Status: {success | reverted}
   From: {from}
   To: {to}
   Value: {valueInCelo} CELO
   
   Attribution codes: {codes joined with ", "  | "(none — tx is not tagged)"}
   Schema: {schemaId | n/a}
   
   Explorer: https://{celoscan.io | celo-sepolia.blockscout.com}/tx/{hash}
   ```

7. If `fromDataSuffix` returned null but the calldata ends with what looks like the marker (`80218021…`), flag that the suffix is malformed and worth investigating.
