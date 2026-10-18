As a **billing admin**, I want to export invoices as CSV, so that finance can reconcile them in their own tools.

### Acceptance criteria

1. An **Export CSV** button on the invoices page
2. The file has one row per invoice, with these columns:
   - `invoice_id`, `customer`, `issued_at` (ISO 8601), `total`
   - `currency`, as the three-letter code
3. Exports over 10,000 rows run in the background, and the user gets an email at you@example.com when it's ready

### Out of scope

* PDF export
* Scheduling exports

### Notes

The existing endpoint `GET /api/v2/invoices?format=json` already pages; reuse it. See the [API guide](https://docs.imagile.dev/api/invoices#export) and ticket PAY-311.

Estimate: 5 points.
