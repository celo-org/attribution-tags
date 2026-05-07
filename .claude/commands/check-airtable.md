Query the Airtable codes lookup table.

Read `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, and `AIRTABLE_TABLE_NAME` from `.env`. If any are missing, abort.

Use the same Airtable URL pattern as `distribution-server/src/pages/api/claim.ts`:
```
https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_NAME}
```

Auth header: `Authorization: Bearer {AIRTABLE_API_KEY}`.

Behavior based on `$ARGUMENTS`:

- **Empty:** list the 20 most recently created rows. For each, print: `code | display_name | telegram | created_at`. Sort descending by `created_at`.

- **Matches `/^celo_[a-z0-9]{8}$/`:** treat as exact code lookup. Use Airtable's `filterByFormula={code}='<value>'` with `maxRecords=1`. Print all fields of the matching row, or `not found` if none.

- **Anything else:** treat as a substring search across `tp_display_name` and `telegram`. Use `filterByFormula=OR(SEARCH(LOWER('<q>'), LOWER({tp_display_name})), SEARCH(LOWER('<q>'), LOWER({telegram})))` with appropriate escaping. Print up to 20 matches as a table, or `no matches` if none.

Always sanitize `$ARGUMENTS` before interpolating into the formula — single quotes must be escaped, no shell metacharacters.

Never print or expose API keys, even in error messages.
