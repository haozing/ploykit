# Commercial Integrity

Commercial facts must have one authority: the host.

## Boundary

- Balances, credit reservations, entitlements, billing, orders, refunds, and checkout application are host primitives.
- A module may ask for a charge or read an entitlement; it must not become the ledger.
- Module data can store product records that reference commercial outcomes, but not the commercial truth itself.

## Use

- Use `ctx.metering.charge` or authorize/commit flows for metered work.
- Use `ctx.credits.reserve`, `ctx.credits.commitReservation`, and `ctx.credits.consume` for credit-backed work.
- Use `ctx.entitlements.has` to gate features.
- Use `ctx.commerce.applyCheckoutPaid` or refund APIs when mapping payment facts.
- Declare `Permission.MeteringWrite`, `Permission.CreditsConsume`, `Permission.CreditsRead`, `Permission.EntitlementsRead`, or `Permission.CommerceApply` as needed.

## Do Not

- Do not create balance, order, subscription, entitlement, or redeem-code authority tables in a module.
- Do not apply payment webhooks by directly granting module-owned benefits.
- Do not fake paid or unpaid state for UI convenience.
- Do not store host checkout secrets in module config.
