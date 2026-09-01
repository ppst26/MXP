# Known residuals after P3b-2

Recorded because the execution workspace is deleted at merge and this is
otherwise only in a conversation. Nothing here blocks anything; all of it was
seen, judged and deliberately left.

## Two comments that assert something untrue

Both are the same class as the four the final review caught — and the argument
for fixing them is this branch's own history, which shows how long a
confidently wrong comment survives here.

- `internal/adapter/repository/deposit/repository.go:364` says the `EXPIRED`
  half of the candidate predicate is "served by `deposits_account_status_amount`
  (000013)". **No such index exists.** Migration 000013 creates only
  `statement_lines_deposit`. The reality is a sequential scan of `deposits` per
  credit row, inside the matcher's transaction. The report discloses the
  equivalent `ListAgeing` scan honestly; this comment asserts the opposite about
  a hotter query. Either correct it, or widen `deposits_pending_amount` and make
  it true.
- `internal/service/matcher/suspense.go:54` refers to
  `MarkCompletedByAttribution`, a method the final fix wave deliberately did not
  build — a reader will grep for it and find nothing.

## Carried from Task 7, found by the final review

`statement.Service.Attribute` never checks that `dep.BankAccountID ==
row.BankAccountID`. An admin can attribute a credit that landed in account A to
a deposit created against account B; the ledger then posts against
`row.BankAccountID`, so the books balance around the wrong story.

## Worth doing before P4 builds on them

- **`journal_entries_reference` is not unique** (`000009_ledger.up.sql:79`).
  Every ledger idempotency guarantee today rests on a guarded UPDATE upstream
  rather than on the database, and `FindEntryByReference`'s own doc admits its
  `ORDER BY id ASC LIMIT 1` is defensive. The first posting path that is not
  fronted by such a guard makes double-posting reachable. Cheapest to make
  unique now, while the table is small.
- **Merchants have no declared amount bounds.** Spec §7's TRANSFER rule says
  "within the merchant's declared bounds if it declared any", and no
  `min_amount`/`max_amount` exists in the schema or the code. A TRANSFER deposit
  currently credits whatever arrives: a customer who declared 100 and sent
  100,000 is credited 100,000. Correct per spec-as-written; almost certainly not
  intended.
- **A retried webhook re-reads the deposit live**, so a retry can send a
  different body than the first attempt if anything ever touches the row. Either
  freeze the body at enqueue, or assert that a terminal deposit is immutable.

## Merchant-facing questions with no answer written down

- `walletId` is always sent as `""`. The webhook PRD lists it as a plain
  `string` with no "may be empty" note, unlike `bankAccountName` which carries
  one — so a merchant validating it non-empty rejects every callback. Either the
  merchant documentation says so explicitly, or the field is omitted rather than
  sent empty.
- `type` sends the deposit's real type, which can be `TRANSFER`, where the PRD
  says it is `"QR"` เสมอ. More truthful, and a merchant validating the literal
  will reject it.
- **`expired` is not terminal.** A deposit that expired and is later matched —
  by a late-ingested credit or by a human — sends `completed` afterwards.
  Merchants must be told, or they will treat the first callback as final.

## Eleven deferred minors

Each was judged Minor by a task reviewer, and the final review triaged two of
them into the fix wave. The nine that remain are: a doc citing a test name from
an earlier draft; the AMBIGUOUS outcome-before-write fix being unguarded because
the fake's error field is never set; a report's mutation count; no config test
for `SuspenseAfter`'s default or `NewSweeper`'s fallback; the secret being
unsealed twice per create; `webhookHash` not guarding an empty plaintext; an
unreachable `CredentialFromContext` branch and a dropped `rand` error; a stale
doc comment on the reversal guard's mechanism; and two packages each defining
their own `fakeLifecycle`.
