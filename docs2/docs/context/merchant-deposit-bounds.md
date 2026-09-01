# Merchant deposit bounds

`merchants.min_deposit_amount` / `max_deposit_amount`, added by migration
`000015_merchant_deposit_bounds`. Both are nullable `NUMERIC(20,4)`, and
**NULL means unbounded** — every merchant that predates the columns carries
NULL on both sides and behaves exactly as it did before.

## What the envelope does

It is applied in two places, and the two must agree:

| Where | When | Effect |
|---|---|---|
| `Service.Create` (deposit) | a **QR** with a declared amount | 400 `ErrAmountOutOfBounds`, nothing written |
| `CandidatesForCounterparty` (SQL) | every incoming statement credit | the deposit is simply not offered as a candidate |

A **TRANSFER declares no amount** (`ValidateCreate` refuses one), so there is
nothing to check at creation; the envelope reaches it only through the
matcher.

Both bounds are **inclusive**. A payment landing exactly on the minimum or
the maximum is inside the envelope — that is the case a customer paying "the
maximum" actually produces.

### Why creation refuses rather than warns

The matcher filters by the same envelope. A QR issued for an amount outside
it would be paid by the customer and then never matched: the money lands,
falls to UNMATCHED, and ages into SUSPENSE for a human. Refusing the
request is strictly better than issuing a QR that cannot work.

### Why the matcher only filters

Out there the money has already moved. Filtering leaves the row UNMATCHED
rather than auto-crediting an amount nobody declared; the suspense sweep
then puts it in front of a human. Losing the money is never on the table.

### Why `CandidatesForAmount` (the QR path) does not filter

A QR was checked against the envelope at creation, so it is inside it by
construction. If the merchant later narrows its envelope, applying the new
one at match time would strand money already paid against a QR that was
legal when issued. A TRANSFER has no such claim -- it declared nothing --
which is why the counterparty path filters and this one does not.

## The three-way update convention

`UpdateData.MinDepositAmount` / `MaxDepositAmount` are `*decimal.Decimal`
with three meanings, because two are not enough — nil is already spoken for
by "absent", and a declared bound has to be revocable:

| Value | Meaning |
|---|---|
| `nil` | leave the stored bound alone |
| pointer to **zero** | **clear** the bound (stored as SQL NULL) |
| any other pointer | set the bound |

On the wire (`PATCH /api/v1/admin/merchants/:id`) the same three states are
an absent/empty string, `"0"`, and a numeric string. `parseOptionalBound`
maps one onto the other. `merchantResponse` omits an undeclared bound
rather than sending `"0"` — absent and zero are different things, and zero
is not a legal bound.

Creation deliberately declares no envelope: the two columns are absent from
the merchant INSERT column list, so a new merchant starts unbounded and an
envelope is a later, explicit decision.

## Validation

`merchants_deposit_bounds` CHECK (both bounds positive, `min <= max`) is the
authority. `ValidateUpdate` carries the same rule so the merchant gets a 400
naming its own field instead of a 500 from a constraint violation, and it
checks the envelope **the update would leave behind** — a one-sided change
is compared against the stored other side, and clearing one side in the same
call releases the constraint on the other.

`min == max` is legal: a merchant that accepts exactly one amount.
