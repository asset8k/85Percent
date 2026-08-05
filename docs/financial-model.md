# Financial Model (V1)

This document describes the financial baseline used by Roster, Dashboard,
Scenarios, and Financials. Monetary values are stored and calculated as integer
pence. Display currency changes symbols only; it does not convert amounts.

## Valuation date

All point-in-time calculations use an explicit UTC date (`asOfDate`). For the
Financials API, this is the current UTC day when it falls within the selected
season; otherwise it is the selected season's 30 June end date. Tests must pass
the date explicitly and must not rely on the machine clock or timezone.

The valuation date determines which wage contract phase is active, current book
value, whether a signed extension accounting decision is effective, and the
roster-derived squad-cost baseline.

## Contract phases and wages

`Annual wage = weekly wage x 52`.

The active wage phase is the contract whose inclusive start/end date contains
the valuation date. A scheduled extension does not replace the current wage
before its start date. Archived phases are excluded.

## Registration amortisation and book value

The registration principal is the original acquisition fee. A known imported
carrying value is used instead only when it explicitly replaces the original
acquisition basis.

`Amortisation period = min(contract term, 5 years)`.

`Annual amortisation = registration principal / amortisation period`.

The five-year cap applies to player registration fees and manager compensation
fees. Current book value is the unamortised principal at the valuation date,
calculated on elapsed UTC calendar days within the capped period and clamped to
zero. It can never be negative. A free transfer has no registration
amortisation unless an explicit carried value is supplied.

## Agent fees

Agent fees are one-off contract fees, allocated evenly across the same capped
contract period:

`Annualised agent fees = agent fee / min(contract term, 5 years)`.

For an initial player contract, the acquisition agent fee is allocated once.
For a renewal, the renewal agent fee is allocated only for the active renewal
wage phase. Agent fees are not added to the registration principal and must
not be counted twice.

## Annual cost and squad costs

`Annual cost = annual wage + amortisation + annualised agent fees`.

Roster returns the canonical per-player result from the contract resolver.
Dashboard displays those same player figures. Financials in derived mode uses
the canonical roster-cost service, which also includes an active head coach:

`Head coach annual cost = annual wage + amortised compensation fee + annualised agent fees`.

Financials may be switched to manual squad costs. In that mode the saved manual
amount is the SCR baseline; roster changes do not overwrite it. Switching back
to derived mode restores the canonical roster total.

## Contract renewals

Wage timing and registration accounting timing are intentionally independent.

- The new wage begins at the extension phase start date.
- The extension accounting treatment begins at `extensionSignedDate`.

Two treatments are supported:

1. **Continue current schedule** retains the original registration
   amortisation schedule. A same-wage renewal may therefore have no immediate
   annual-cost change.
2. **Spread remaining book value over extended term** calculates the book value
   at `extensionSignedDate`, then re-amortises it from that date until the new
   contract end, subject to the five-year cap. This can change amortisation
   immediately while the new wage remains scheduled.

The signed date and treatment are persisted with the extension and consumed by
the canonical read model after a fresh database read.

## SCR, thresholds, and allowance

`SCR = squad costs / football-related revenue x 100`.

For clubs using the owner-equity top-up, the permitted one-year amount is added
to the SCR revenue denominator.

`Green threshold = adjusted revenue x 85%`.

`Red threshold = adjusted revenue x (85% + current allowance)`.

The allowance is additive. With a 30% allowance, red starts at 115%, not at
85% multiplied by 1.30. The current allowance starts at 30% and may reduce
after an 85% breach. Amber is above green through the red threshold; red is
strictly above the red threshold.

Use `%` for an SCR value, for example `103.7%`. Use `pp` for a difference
between SCR values, for example `+2.4 pp`.

## Scenarios and projected SCR

The baseline is the Financials current squad-cost value and adjusted revenue.
Only saved scenarios marked **included** are flattened into the active
projection. Their actions are applied once as cost/revenue deltas:

`Projected SCR = projected squad costs / projected revenue x 100`.

Disabling or deleting an included scenario removes its actions from the active
projection. An unsaved scenario is a dry run only and does not change the
baseline. Current SCR remains the baseline; projected SCR includes included
scenarios.

## Source of truth

- Pure calculations: `packages/engine`.
- Canonical player contract resolution:
  `apps/admin/backend/services/player-registration.ts`.
- Canonical derived roster total, including head coach:
  `apps/admin/backend/services/roster-costs.ts`.
- Financials API supplies the authoritative SCR baseline to Dashboard and
  Scenarios.
