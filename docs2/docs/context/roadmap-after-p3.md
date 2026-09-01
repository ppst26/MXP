# Work plan after P3

Written 2026-08-29, the day P3a, P3b-1 and P3b-2 landed on `main`. Ordered by
what gets more expensive the longer it waits, not by what is most interesting.

## Where things stand

Money **in** is built: create a deposit, generate a PromptPay QR, poll the
bank's statement, decide whose money each credit is, post it, tell the
merchant, and let a human resolve what the matcher could not. Every gate is
green and none of it has ever run for real — every switch ships off, no deposit
has ever completed, and no webhook has ever been delivered.

Money **out** has both ends and no middle. The KTB transfer rail works
(`internal/service/transfer`, proven against the live bank), and P2b's ledger
already models the whole payout lifecycle — `PostPayoutCreated`,
`PostPayoutCompleted`, `PostPayoutFailed`, `PostPreFund`, `PostWithdrawal`,
`PostInternalTransfer`. **All six have zero callers.** There is no payout
domain, no payout service, and no merchant-facing payout API.

---

## 1. Three fixes that get more expensive every phase (do first)

None is urgent today. All three are cheapest now and compound later.

- **Make `journal_entries_reference` unique.** Every ledger idempotency
  guarantee currently rests on a guarded UPDATE somewhere upstream rather than
  on the database, and `FindEntryByReference`'s own doc admits its
  `ORDER BY id ASC LIMIT 1` is defensive. The payout phase adds posting paths;
  the first one not fronted by such a guard makes double-posting reachable. The
  table is small today and will not be later.
- **Give merchants declared amount bounds.** Spec §7's TRANSFER rule says
  "within the merchant's declared bounds if it declared any", and no
  `min_amount`/`max_amount` exists anywhere. A customer who declared 100 and
  sent 100,000 is credited 100,000.
- **Correct the two comments** in `docs/context/p3b2-residuals.md` — one claims
  an index that does not exist and hides a sequential scan per credit row.

## 2. Turn P3 on, one switch at a time

The order matters, because each loop acts on whatever is already in the table
the moment it starts.

1. `statement.polling_enabled` — watch rows land, check the parsers against
   real traffic, and watch `logs/ktb-wire.jsonl` for any sign of throttling.
   `poll_interval_active` at 10s was chosen for responsiveness, not measured
   against KTB's tolerance.
2. `deposit.matching_enabled` — with real rows present, confirm matches and
   `AMBIGUOUS` outcomes look right before anything can be credited automatically.
3. `deposit.expire_sweep_enabled`, then the suspense sweep last — these are the
   two that move money on a timer with nobody watching.

**Blocking, and not something an engineer can do:** `deposit.qr_enabled` stays
false until a human scans a generated payload with a real banking app, using a
**real registered corporate PromptPay id**, and confirms the recipient name and
amount. The development id is synthetic and would fail regardless of whether
the generator is correct. Until that happens no merchant can take a QR deposit.

## 3. Answer three merchant-facing questions before the first integration

Each has no answer written anywhere, and each is cheap now and a breaking
change later.

- `walletId` is always sent as `""`, and the PRD lists it as a plain string
  with no "may be empty" note. A merchant validating it non-empty rejects every
  callback.
- `type` sends the deposit's real type, which can be `TRANSFER`, where the PRD
  says it is `"QR"` เสมอ.
- **`expired` is not terminal.** A deposit that expired and is later matched —
  by a late-ingested credit or by a human — sends `completed` afterwards.

## 4. Payouts — the other half of the gateway

This is the largest remaining piece and roughly the size of all of P3.

**It starts with brainstorming and a spec, not a plan.** A new subsystem is
architectural: the questions below change the shape of the code, and answering
them in an implementation plan means answering them by accident.

What has to be decided before any of it is written:

- **Who approves a payout, and when.** The KTB rail already requires a stored
  PIN to approve a transfer order. Whether a merchant's request executes
  immediately, waits for a platform admin, or waits on a threshold is a product
  decision with a very different shape in each case.
- **Where the money comes from.** `PostPayoutCreated` reserves amount **plus
  fee** out of `merchant:operate` at creation, so a merchant cannot spend the
  fee twice — that part is settled. What is not settled is which corporate
  account actually pays, and what happens when its balance is short.
- **What a failure means.** A bank transfer can succeed, fail, or answer
  neither. `PostPayoutFailed` exists; the reconciliation that decides when to
  call it does not.
- **Bulk.** The rail supports bulk orders and caps recipients at 58 for a
  reason recorded in `config.yaml`. Whether merchants get bulk at all is a
  contract question.

**An operational prerequisite:** the pool holds four `INBOUND` accounts and
**no `OUTBOUND` or `VAULT` account at all**. Nothing can pay out until one is
attached and funded, and `pool.balance_refresh_enabled` — off today — is what
keeps an outbound account's balance fresh enough for routing to trust it.

Likely sub-phases, in the shape P3 used: create and reserve; execute against
the rail and reconcile; webhook and the admin surface.

## 5. After payouts

Smaller, because each builds on what exists: P5's webhook delivery history,
manual replay, inquiry APIs and per-merchant delivery configuration; a
reconciliation report; and a retention policy for statement rows, which needs
measurements rather than a guess made now.

One report is worth building early regardless: **suspense rows grouped by
`transactionCode`**. Only five counterparty grammars are known, from two
captures of one account, and every channel a real merchant's customers use will
first appear as unattributed credits. That report is the cheapest way to find
the next grammar worth adding.
