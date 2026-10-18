# Release 4.12 — October 2026

This release ships the **invoice export** and retires the *old* PDF renderer. Owners: @abc12345 and the billing team.

> Customers on the Enterprise plan get the export a week early.

## What's new

- CSV export of invoices ([PAY-311](https://jira.imagile.dev/browse/PAY-311))
- Faster search:
  - results in under 200 ms for 95% of queries
  - typo tolerance for customer names
- ~~Dark mode~~ moved to 4.13

## Upgrade steps

1. Back up the database
2. Run the upgrade script:

   ```bash
   ./bin/upgrade --to 4.12 --dry-run
   ./bin/upgrade --to 4.12
   ```
3. Restart the workers

## Known issues

| Issue | Impact | Fix version |
| --- | --- | :-: |
| Export times out over 50k rows | Large tenants | 4.12.1 |
| Search ignores accents |  | 4.13 |

## Sign-off

- [x] QA sign-off
- [ ] Security review of the `export` endpoint

![Export dialog](https://wiki.imagile.dev/download/attachments/5678/export-dialog.png)

See also last month's notes.

---

Questions? Ask in `#billing-releases`.
