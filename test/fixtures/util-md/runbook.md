Payments service: on-call runbook
=================================

Owner: Payments platform team. Escalation: page the **secondary** after 15 minutes.

---

## 1. Is it us?

Check the dashboard first: [Payments overview](https://grafana.imagile.dev/d/payments/overview).
If the *error rate* is above 2% for five minutes, keep going.

* Card authorisations failing
  * Check the gateway status page
  * Check `payments-api` pods:

    ```bash
    kubectl -n payments get pods -l app=payments-api
    ```

* Refunds stuck in `PENDING`
  1. Find the oldest stuck refund
  2. Requeue it with the admin tool

## 2. Restart safely

> Never restart all replicas at once. The ledger writer holds a lease, and
> losing it mid-batch means a manual reconciliation.
>
> > If in doubt, ask in #payments-oncall before acting.

Steps:

1. Drain one pod: `kubectl drain` is *not* what you want here; use the rollout.
2. Run:

   ```bash
   kubectl -n payments rollout restart deployment/payments-api
   kubectl -n payments rollout status deployment/payments-api --timeout=5m
   ```

3. Watch the error rate for ten minutes.

## 3. After the incident

- [ ] Write the incident summary
  - [ ] Timeline
  - [ ] Customer impact
- [x] Hand over to the next on-call
- [ ] File follow-up tickets in PAY

| Alert | Threshold | First action |
|-------|:---------:|--------------|
| `PaymentsErrorRate` | > 2% for 5m | Section 1 |
| `LedgerLagHigh` | > 60s | Page secondary |
| `RefundQueueDepth` | > 500 | Section 1, refunds |

![Architecture diagram](https://wiki.imagile.dev/download/attachments/1234/payments-arch.png)

_Last reviewed: 2026-09-30._
