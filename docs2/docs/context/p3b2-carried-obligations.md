# Carried into P3b-2 from P3b-1

## Blocking, before the SUSPENSE sweep is written

**Backfill the eight legacy `DEBIT`/`UNMATCHED` rows.** P3b-1 changed ingestion so a debit is stored `IGNORED`, but the rows ingested before that change are still `UNMATCHED` in the `maxpay` dev database. `db/migrations/000011_statement_lines.up.sql:57-60` asserts without qualification that "nothing but a credit is ever in here" — true of every row the branch writes, false of the table.

The spec's SUSPENSE sweep posts a row still `UNMATCHED` after a timeout to `HOUSE_SUSPENSE`. Run over these rows it posts eight historical bank fees and payout debits into the house suspense account.

Fix either by a data migration setting `match_status = 'IGNORED'` where `direction = 'DEBIT' AND match_status = 'UNMATCHED'`, or by filtering the sweep on `direction = 'CREDIT'`. The first is better; the migration comment then becomes true.

## Interfaces P3b-1 does not provide and the matcher needs

- **An oldest-first read.** Spec §7 requires the matcher to work over `UNMATCHED` credits "oldest first"; `statement.Repository.List` orders `occurred_at DESC, id DESC` and `ListQuery` has no ordering option. Add a method.
- **A transaction-aware write path.** §7 requires the row's status, the deposit's status, the ledger entry and the webhook job to commit together. `InsertIfNew` uses `r.DB.ExecContext` directly rather than a tx-aware executor; check what `repository/base` offers before assuming the write path composes.

## Things P3b-1 leaves in good shape

- `bank_statement_lines.amount` and `deposits.deposit_amount` are both `NUMERIC(20,4)`, so exact-amount comparison needs no conversion.
- `counterparty_account` and `counterparty_bank` are populated **unmasked** in real data (`0611287194` / `004`). The spec braced for masked digits; TRANSFER matching can be an equality check.
- `match_status` already admits all five spec values, so no CHECK has to be widened.
- `InsertIfNew` collapses a unique violation to `(false, nil)` outside any transaction, so the matcher can run concurrently with ingestion without fighting it.

## Two parked diagnosability items, if you touch these files

- A `ValidateLine` refusal is logged without the row's fingerprint — `readRow` returns the validator's error unwrapped. One line: `fmt.Errorf("row %s: %w", line.Fingerprint, err)`.
- The one-replica constraint for statement polling is in `README.md` and the producer's doc comment, but not on `polling_enabled` in `config.yaml.example` or `internal/shared/config.go`, where the switch is actually thrown.
