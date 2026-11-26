# Supplier orders, stage one

New order lines record the selected supplier ID, product code/name/brand and the supplier purchase-price basis at creation. Supplier identity comes from the product selected by management, never a client-supplied supplier ID or a brand permission. The existing single selected supplier per catalog product remains unchanged; this does not introduce competing offers or a multi-seller selector.

Editing a draft invoice preserves the supplier/cost/labels of retained lines. Added products receive new snapshots. Existing post-customer-approval editing restrictions remain. Manual management orders must select catalog products, send their IDs, and save their actual lines and snapshots atomically with the header. The server calculates the same row/overall discount arithmetic as the form instead of accepting an inconsistent header total. Free-text, unlinked rows are rejected with an explanation.

Migration 023 only adds nullable snapshot columns, a known-price flag and an index. It never backfills historical ownership or rewrites historical amounts. Like the existing supplier inventory schema initialization, the additive migration is initialized at startup (and retried lazily), using one MySQL connection and a database-specific advisory lock. The health response reports supplier_orders as pending/ok/unavailable and the release reports package version 1.0.3. Failures return an unavailable response and retry on a later request. Deploy with permission to apply the additive migration; no production migration has been run during development.

## Supplier API

- `GET /api/supplier-portal/orders?page=1&status=preparing`
- `GET /api/supplier-portal/orders/:id`

Both require a currently approved/enabled supplier session. They return only rows whose stored supplier ID matches that session. Brand permission does not grant order visibility. They do not disclose buyer identity, addresses, payment receipts, other sellers' items, or the total value of the mixed order.

Visibility starts in preparing/shipping/delivered after approved payment allocations cover the full order total (or the order total is zero). Paid cancelled orders remain identifiable as cancelled. Partially paid orders and orders that have not reached fulfilment are excluded. Legacy rows with unknown ownership are excluded, including when a retained legacy row is edited.

The displayed total is quantity times the seller's recorded supplier price, **not** a wallet credit, settlement amount or allocated commission. Missing supplier price remains null and displays a management-review message; the old sale-price fallback is not mislabeled as seller earnings. Coupons, refunds, commission allocation and settlement timing require the separate wallet phase. No wallet/payout tables or changes to payment allocation are included.

## Validation

Run relevant native Node tests plus `test/supplierOrders.mysql.test.js` with `ONPART_ORDERS_TEST_MYSQL=1` only against the explicitly identified disposable loopback test server (port 33078, server ID 760023). The test creates and drops its own schema. It covers mixed sellers, catalogue reassignment after ordering, draft editing, immutable costs, full/partial payment, supplier authentication/ownership, manual orders, legacy exclusion and migration replay. Frontend tests cover cards, escaping, pagination, filters, errors/retry and stale-response protection.

No live orders, user accounts, OTP messages or production database writes were used. Browser visual QA remains unverified in this environment: the local preview could not be reached by the supplied browser. Do not claim desktop/mobile screenshots were tested.
