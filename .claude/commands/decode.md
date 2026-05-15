Decode a raw hex string as an ERC-8021 dataSuffix. Useful for debugging without an RPC roundtrip — e.g. when someone pastes calldata in a chat and you want to confirm the code.

`$ARGUMENTS` is a hex string. Accept it with or without `0x` prefix; normalize to lower-case with `0x` prefix before processing.

Steps:

1. Validate the input is hex. If not, abort with a message.

2. Call `fromDataSuffix(input)` from `@celo/builder-codes`.

3. If the result is `null`, print:
   ```
   No ERC-8021 marker found in the input.
   The marker is the constant 0x80218021802180218021802180218021 (16 bytes)
   and must appear at the very end of the calldata for the suffix to be valid.
   ```
   Then check whether the marker appears anywhere in the input but not at the end, and mention that if it's the case ("marker found at offset N, but calldata continues for M more bytes — suffix must be at the end").

4. If decoding succeeded, print:
   ```
   Codes: {comma-separated list}
   Schema: {schemaId}
   
   Byte breakdown (reading left-to-right):
     code:    {hex} ("{ascii}", {N} bytes)
     length:  {hex} ({N})
     schema:  {hex} ({schemaId})
     marker:  {hex}
   Total suffix: {N} bytes
   ```

5. If the input is shorter than 18 bytes, note that the suffix can't possibly fit (minimum 1 byte code + 1 length + 1 schema + 16 marker = 19 bytes, so anything shorter is too short).
