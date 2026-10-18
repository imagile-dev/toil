## Problem

Nightly export to the data warehouse fails with a **timeout** after the *October* schema change. Reported by @jdoe in the ops channel.

## Steps

1. Trigger the job from [Jenkins](https://jenkins.imagile.dev/job/warehouse-export/)
2. Wait for the `extract` stage
   - It hangs at 63%
   - The worker logs show the query below
3. Kill the job after 30 minutes

```sql
SELECT o.id, o.total, c.region
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.updated_at > :since;
```

### Affected tables

| Table | Rows | Index on updated\_at |
| --- | --- | --- |
| orders | 48,200,113 | no |
| customers | 1,902,554 | yes |

> **Workaround**
>
> Run the export with `--since` set to yesterday; it finishes in about 12 minutes.

> Adding the index needs a maintenance window: ~~approved for Saturday~~ pending DBA sign-off.

Do not rerun the full backfill without checking disk space first.

Screenshot of the stuck stage: ![](stage-hang.png)

---

```
2026-10-15T02:14:07Z WARN extract: batch 63 of 100 exceeded 600s
```
