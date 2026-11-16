-- A made-up "read replica" of the payments service, for the demo recordings
-- (docs/demo-reset.md). Every date is relative to now(), so it is always fresh,
-- and setseed() makes the same rows every time. It carries the evidence three
-- tracked stories point at:
--   - refunds in JPY and KRW short by one minor unit (the rounding bug, and the
--     agent-ready formatAmount issue);
--   - the nightly reconciliation job failing about once a week on a lock that the
--     statement export holds (the "lock timeout" story);
--   - a merchant whose payout schedule changed mid-cycle, leaving a split payout
--     labelled with the wrong period (the long-titled bug).
-- Rebuilt from scratch on every run. A replica of a system that never existed,
-- kept exactly as current as the real ones.
DROP SCHEMA IF EXISTS payments CASCADE;
CREATE SCHEMA payments;
SET search_path = payments;
SELECT setseed(0.43);

CREATE TABLE merchants (
  id int PRIMARY KEY, name text NOT NULL, country text NOT NULL, currency text NOT NULL,
  risk text NOT NULL, payout_schedule text NOT NULL, schedule_changed_at timestamptz
);
INSERT INTO merchants VALUES
  (1, 'Northwind Coffee', 'US', 'USD', 'low', 'daily', NULL),
  (2, 'Fjord Outdoor', 'NO', 'NOK', 'low', 'daily', NULL),
  (3, 'Sakura Stationery', 'JP', 'JPY', 'medium', 'daily', NULL),
  (4, 'Lumen Games', 'GB', 'GBP', 'high', 'weekly', now() - interval '4 days'),
  (5, 'Harbor Books', 'US', 'USD', 'low', 'daily', NULL),
  (6, 'Seoul Street Eats', 'KR', 'KRW', 'medium', 'daily', NULL);

CREATE TABLE payments (
  id bigint PRIMARY KEY, merchant_id int NOT NULL REFERENCES merchants, created_at timestamptz NOT NULL,
  currency text NOT NULL, amount_minor bigint NOT NULL, status text NOT NULL, idempotency_key text NOT NULL
);
INSERT INTO payments
SELECT g, m.id, now() - (random() * interval '30 days'), m.currency,
       CASE WHEN m.currency IN ('JPY', 'KRW') THEN 300 + floor(random() * 30000) ELSE 500 + floor(random() * 25000) END,
       CASE WHEN random() < 0.95 THEN 'captured' ELSE 'failed' END,
       'idem_' || lpad(g::text, 6, '0')
FROM generate_series(1, 4000) g
JOIN merchants m ON m.id = 1 + (g % 6);

-- Duplicate captures: the same idempotency key captured twice, about once a day.
INSERT INTO payments
SELECT 100000 + row_number() OVER (), merchant_id, created_at + interval '31 seconds', currency, amount_minor, 'captured', idempotency_key
FROM payments WHERE id % 140 = 0 AND status = 'captured';

CREATE TABLE refunds (
  id bigint PRIMARY KEY, payment_id bigint NOT NULL REFERENCES payments, created_at timestamptz NOT NULL,
  currency text NOT NULL, requested_minor bigint NOT NULL, refunded_minor bigint NOT NULL, reason text NOT NULL
);
INSERT INTO refunds
SELECT row_number() OVER (), p.id, p.created_at + interval '2 days', p.currency, p.amount_minor / 2,
       CASE WHEN p.currency IN ('JPY', 'KRW') AND random() < 0.06 THEN p.amount_minor / 2 - 1 ELSE p.amount_minor / 2 END,
       (ARRAY['duplicate', 'fraudulent', 'requested_by_customer', 'product_not_received'])[1 + floor(random() * 4)::int]
FROM payments p WHERE p.status = 'captured' AND random() < 0.12;

CREATE TABLE disputes (
  id int PRIMARY KEY, payment_id bigint NOT NULL REFERENCES payments, opened_at timestamptz NOT NULL,
  evidence_due date NOT NULL, status text NOT NULL, merchant_notified boolean NOT NULL
);
INSERT INTO disputes
SELECT row_number() OVER (), p.id, o, (o + interval '7 days')::date,
       CASE WHEN o > now() - interval '7 days' THEN 'needs_response' ELSE (ARRAY['won', 'lost'])[1 + floor(random() * 2)::int] END,
       false
FROM (SELECT id, created_at + interval '9 days' AS o FROM payments WHERE status = 'captured' AND id % 97 = 0) p
WHERE o < now();

CREATE TABLE payouts (
  id int PRIMARY KEY, merchant_id int NOT NULL REFERENCES merchants, scheduled_for date NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, amount_minor bigint NOT NULL, status text NOT NULL
);
INSERT INTO payouts
SELECT row_number() OVER (), m.id, d::date, (d - interval '1 day')::date, (d - interval '1 day')::date,
       20000 + floor(random() * 400000), CASE WHEN d::date < current_date THEN 'paid' ELSE 'scheduled' END
FROM merchants m, generate_series(current_date - 20, current_date + 2, interval '1 day') d
WHERE m.id <> 4 OR d < now() - interval '4 days';
-- Lumen Games moved from daily to weekly 4 days ago: the pending balance split in two,
-- and the second payout carries the old daily period.
INSERT INTO payouts (id, merchant_id, scheduled_for, period_start, period_end, amount_minor, status)
SELECT max(id) + 1, 4, current_date - 3, current_date - 4, current_date - 4, 81250, 'paid' FROM payouts;
INSERT INTO payouts (id, merchant_id, scheduled_for, period_start, period_end, amount_minor, status)
SELECT max(id) + 1, 4, current_date + 3, current_date - 4, current_date - 4, 264900, 'scheduled' FROM payouts;

CREATE TABLE job_runs (
  id serial PRIMARY KEY, job text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz,
  status text NOT NULL, rows_processed int, error text
);
-- The statement export starts at 01:55 and holds ledger_entries until about 02:20.
INSERT INTO job_runs (job, started_at, finished_at, status, rows_processed, error)
SELECT 'statement-export', d + interval '1 hour 55 minutes', d + interval '2 hours 18 minutes' + random() * interval '6 minutes', 'succeeded', 180000 + floor(random() * 20000), NULL
FROM generate_series(date_trunc('day', now()) - interval '30 days', date_trunc('day', now()) - interval '1 day', interval '1 day') d;
-- Reconciliation at 02:00: on the days the export runs long, it times out on the lock.
INSERT INTO job_runs (job, started_at, finished_at, status, rows_processed, error)
SELECT 'nightly-reconciliation', d + interval '2 hours',
       d + interval '2 hours' + CASE WHEN fail THEN interval '10 minutes' ELSE interval '14 minutes' END,
       CASE WHEN fail THEN 'failed' ELSE 'succeeded' END,
       CASE WHEN fail THEN NULL ELSE 52000 + floor(random() * 4000)::int END,
       CASE WHEN fail THEN 'canceling statement due to lock timeout: waiting for AccessExclusiveLock on relation ledger_entries held by statement-export' END
FROM (SELECT d, (extract(doy FROM d)::int % 7 = 3 OR d = date_trunc('day', now()) - interval '1 day') AS fail
      FROM generate_series(date_trunc('day', now()) - interval '30 days', date_trunc('day', now()) - interval '1 day', interval '1 day') d) x;

CREATE VIEW refund_shortfalls AS
SELECT r.currency, count(*) AS short_refunds, sum(r.requested_minor - r.refunded_minor) AS short_by_minor
FROM refunds r WHERE r.refunded_minor < r.requested_minor GROUP BY r.currency;

COMMENT ON SCHEMA payments IS 'Made-up demo data for Toil UI recordings: a payments product that does not exist.';
