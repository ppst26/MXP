# Known residuals after P4b

Recorded because the execution workspace is deleted at merge and this is
otherwise only in a review note.

## RESOLVED: /submission is the wrong commit endpoint for this account

Committing a KTB order has two endpoints, and they are not interchangeable:

```
POST .../transfer-order/{id}/submission     400  code 80000 / 20000
POST .../transfer-order/{id}/confirmation   200  money moves
```

The refusal code depends on the route: `80000` for a same-bank transfer,
`20000` for an interbank one. Both are in `commitRefusalCodes`.

**This account's `/submission` refuses every order and `/confirmation`
accepts it.** That holds on both lanes — the bulk lane behaves identically —
and it is the whole of the failure that cost a night of diagnosis.

### How it was found, and why it took so long

Nine single transfers were attempted between 00:20 and 10:19 on 2026-08-30,
across two recipients and two banks, at three `client_version` values, from
two independent client implementations. All nine failed at `/submission`
with `80000` and none moved money. Every checkable cause was excluded: the
maintenance window, the transfer route, the payee, the balance, the fee, the
effective date, the transfer limit, the entitlements, the PIN, the payload,
the masked account number, and finally our own code — the reference client
`apiappnextbiz`, driven with our device credentials, failed the same way.

Two facts broke it open:

1. **The account holder's manual transfers in the KTB Business app succeeded**
   on the same account the same night. The account was never the problem.
2. **A bulk transfer succeeded through our own API** at 10:23, and its wire
   trace showed `/submission` failing with `80000` and `/confirmation`
   succeeding immediately after. The bulk lane already carried a fallback,
   ported from the Node client with the comment *"Submission and confirmation
   are not interchangeable across order states, and the Node client found
   that out the hard way."*

**The answer had been in the repository since the port.** The Node client hit
this and fixed it — on the bulk lane only. The transfer lane never got the
same treatment because the Node client never needed it. The failure was not
the bank, the account, the credentials, or the payload; it was a fallback
that existed on one lane and not the other.

Confirmed by measurement at 11:15 on 2026-08-30: with the fallback added, a
single transfer committed through `/confirmation` and the balance moved.

### The gate, and why it is narrow

The fallback is a second attempt to move the same money, so `isBankRefusal`
in `internal/service/transfer/commit.go` admits only an HTTP 400 whose code is
in `commitRefusalCodes` — `80000` and `20000`, the two the bank actually uses.
Everything else is relayed untouched.

| Failure | Why it must not fall back |
|---|---|
| 5xx | The bank may have committed the order and failed to say so |
| 5xx carrying a refusal code | The code alone is not the signal — the call is still ambiguous |
| transport error, timeout, cancellation | Says nothing about the bank's state |
| 401 | A dead token, not a refused order — that retry belongs to `session.Do` |
| 400 with a business code | The bank refusing on the merits; the other endpoint refuses it too, and retrying hides the explanation |

**Why an allow-list rather than "any 400".** The two endpoints demonstrably do
not validate the same things — `/submission` refuses this account outright and
`/confirmation` does not — and what else `/submission` checks is unknown.
Falling back on an unrecognised 400 would skip those checks blind, which is
how an order gets committed twice or past a bank limit. The list's one
weakness is that a new route's code fails closed and silently, so
`logUnknownCommitRefusal` reports any unrecognised 400 at commit with the code
and the order id — everything a one-line fix needs. It stays quiet for codes
that already have a defined outcome, so the line that means "nobody has seen
this before" is not buried among ones that do.

The same gate was applied to the bulk lane, which previously fell back on
**any** error including 5xx and timeouts. On a bulk run that is the most
expensive mistake in the service: it pays every recipient in the batch twice.
Closing it is the larger of the two changes, even though the transfer-lane
fallback is the one that unblocked the rail.

If the bank ever refuses with a code that is not listed, the gate closes and
commits fail outright. That is the safe direction: a failed payout is
recoverable, a doubled one is not.

Six mutations are killed by the tests: always-fall-back, never-fall-back,
drop-the-status-check, drop-the-map-lookup, accept-any-4xx, and gutting
`logUnknownCommitRefusal`'s body.

### The 10 orphaned DRAFT orders

The nine failed attempts left ten `DRAFT` instructions at the bank, visible
at `GET /v1/instructions/pending-tasks` with `availableActions: [EDIT,
DISCARD]` and no `APPROVE`. They never entered the approval workflow and
never moved money — positive confirmation that `/submission` committed
nothing. They are litter and should be discarded.

## Two traps found while verifying, both live

**`isCompleted` does not mean the transfer succeeded.** On a bulk item it was
`true` at submission time, while `bulkItemStatus` still read *"ส่งเพื่อ
ดำเนินการเรียบร้อย"* — submitted for processing. Forty minutes later the
status became *"รายการสำเร็จ"*. `isCompleted` means the item is complete and
valid within the package, not that the money arrived. **A payout worker that
settles on `isCompleted` releases a merchant's reservation for money that has
not moved yet.** That is precisely the hazard named at the end of this file.

`bulkItemStatus` is the honest signal, but it is a Thai display string, not a
stable code. Before P4c settles anything on it, look for a code field —
`GET /v1/instructions/{refNo}/activity-log` is the obvious place — and pin
whatever is found.

**`GET /accounts/cashflow` serves a stale balance.** It returned
`totalAssets: 22.35` in the same second `GET /accounts/overview` returned
`18.35`; `22.35` was the balance before the previous night's transfers. Only
`overview` may be used for a money decision.

## Tracking a payout is already possible, and already exposed

The rail answers all of these today, and the routes exist:

| Route | Answers |
|---|---|
| `GET /devices/{alias}/bulk-orders/{id}/items` | per-recipient status |
| `GET /devices/{alias}/bulk-orders/{id}/items/{itemId}` | one recipient in detail |
| `GET /devices/{alias}/instructions/submitted` | everything committed, both channels |
| `GET /devices/{alias}/instructions/{refNo}` | one instruction |
| `GET /devices/{alias}/instructions/{refNo}/activity-log` | its status history |

`packageRefNo` from the bulk summary equals `instructionRefNo` in the
instruction lists — that is the key that joins a payout row to the bank's
own record. The transfer lane returns the same key directly, as
`instructionRefNo` inside `transfer_details`.

Nothing in P4b uses any of this yet. P4c should.

## The live `PollTransfer` body, finally captured

P4b shipped with the poll allow-list resting on a Node-era test stub. The
real body, from the successful transfer at 11:15 on 2026-08-30:

```json
{
  "sourceOrderId": "…",
  "isPollingEnabled": true,
  "isPollingFinished": false
}
```

**It carries no `status` field at all.** The allow-list checks for `SUCCESS`
and `FAILED`, so this body classifies as `Unknown` — the safe direction, and
the correct one, because a first poll immediately after commit genuinely does
not know the outcome. But it means the poll never returns a definite answer
on the first call, and P4c cannot treat one poll as settlement. The fields to
build on are `isPollingFinished` and, once finished, whatever the terminal
body carries. **That terminal body has still not been captured** — it needs a
poll issued well after a commit, not immediately after one.

## CLOSED: the lane asymmetry

`runBulk` had no token-expiry suppression. A token expiry part-way through
re-ran the whole closure through `session.Do` and created a **second bulk
order** — which on this lane is a second batch, every recipient in it paid
twice. It was not a double payment while nothing used the lane, because the
abandoned order was never confirmed; it became the payout path's defect the
moment bulk was chosen as the payout lane.

Closed on 2026-08-30. One detail is worth carrying: **`runBulk` opens the
order before it resolves any payee**, where `runTransfer` resolves first. So
the guard sits immediately after the order id exists, and `CreateBulkOrder`
itself is the only step still "before the order exists". Both directions are
pinned by tests.

That ordering has a second consequence nobody has acted on: a bulk run with
an unresolvable payee still leaves an orphan order at the bank, because the
order is opened before anything is validated. It costs nothing but litter
today. If P4c batches many payouts into one order, one bad recipient
stranding the whole batch's order is worth designing around.

## Test-coverage gaps, in what they cost

- **The backoff schedule is unpinned beyond "not zero".** Collapsing
  `backoffFor` to always return the first interval survives everything: the
  only assertions are `> 30s` with `Attempts = 1`. The 5-minute second step
  and growth-with-attempts at all are untested, as are the clamp branches.
  One table-driven test closes it.
- **A dropped `RecordConfirmed` error is unpinned.** `fakeSendRepo.confirmErr`
  exists and no test sets it. Asymmetric with `OnOrderCreated`, whose failure
  path is pinned. The outcome classification stays correct either way, so the
  cost is a silently lost database write on the confirmation path.
- **Nothing enforces that `RecoverUnsent` stays ungated.** Its doc says it is
  deliberately not gated on `send_enabled` or on the account being ACTIVE —
  adding such a gate survives every test.
- **`confirmed_at` surviving an `Unknown` outcome is proven at unit level
  only.** The integration test for that path uses a pre-confirmation failure,
  which is spec §6's state 2, not state 3 — and state 3 is the realistic one,
  since the rail only returns `Unknown` after `ConfirmTransfer`.
- **`SetReservedFee` (from P4a) never proves it writes inside its caller's
  transaction.** P4b closed the identical gap for `MarkTerminal` with a
  rollback test; the same one-test fix applies.

## Deliberately unreachable

`MarkTerminal`'s `REJECTED` branch has no caller. `settle` refuses that status
explicitly, so it cannot be reached by accident. The spec does not name it for
P4c either. It is the closest thing to dead code on the branch, kept because
the repository method is the one place a terminal status is written and
excluding one of the three would be the surprising choice.

## Two facts worth carrying into P4c

- **`-p 1` is load-bearing** for this repo's integration suite. The payout
  packages truncate shared tables, and without it you get "no rows in result
  set" failures that look exactly like real defects. Two reviewers hit this.
- **The poll success token still rests on weak evidence.** `SUCCESS` and
  `FAILED` are the only statuses treated as definite, and both come from a
  Node-era test stub. The first live body has since been captured — see *The
  live `PollTransfer` body, finally captured* above — and it carries no
  `status` field at all, so it classifies as `Unknown`. That is the safe
  direction, but it means the allow-list is still unvalidated: **the terminal
  poll body, for both the same-bank and the interbank recipient, must be
  captured and the allow-list re-checked against it before
  `payout.send_enabled` is ever turned on.** The hazard is a polling envelope
  whose `status` means "the poll call succeeded" rather than "the transfer
  completed" — that would produce a false `Completed`, which releases a
  merchant's reservation for money that never arrived.
