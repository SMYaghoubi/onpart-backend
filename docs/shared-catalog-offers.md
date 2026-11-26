# Shared catalog and reviewed supplier offers — draft implementation

This change is not a production release. It requires the paired frontend changes before enabling the new buyer flow. No production data was used for implementation or tests.

## Behavior

- Keep the existing manager/partner catalog and product image management. A canonical product ID appears once in `/shop`; `/product?id=…` displays the reviewed offers for that ID. Existing IDs are never automatically merged based on names or similar images.
- Sellers select an existing item from their permitted catalog and submit their own base price and real quantity through the current single-item, Excel or paste-list workflow. Existing requests to add missing catalog items and replacement images still require management review.
- Management's existing per-batch/per-row markup determines the final offer price. Store that price against the supplier's inventory, independently from the legacy product-level summary price. The buyer is charged the selected final price, with no additional platform fee added at checkout.
- Only active products and approved, enabled sellers in Shahriar with a current reviewed brand permission, a reviewed positive price and available unreserved quantity can be bought. Buyers still require approval under the existing role-separated authentication. Buyer location is unrestricted within the existing nationwide account/address flow.
- Buyer responses whitelist master product fields and anonymous offer labels. They do not return seller IDs, shop names, contact information or supplier costs. The seller's order endpoint continues to return only its own paid order lines and agreed base prices, without buyer identity or address. Management retains the actual supplier assignment for fulfillment.
- The cart retains one selected offer per product. Explicitly selecting another replaces that product's earlier offer. The UI explains this. Changes in offer version, price, eligibility or available quantity require review; the server never silently chooses a cheaper or different seller.
- Orders snapshot the exact selected supplier, base price, final price and product labels. Market-order lines cannot be edited by management after creation; cancel and create a new order if the buyer needs a different quote. Existing legacy/manual order editing remains unchanged.
- Reserve the seller's units transactionally when the buyer submits the order. Unpaid orders hold inventory until management or the buyer cancels through the existing workflow. There is no automatic timeout in this phase. Repeated checkout requests with the same request key and identical contents return the same order; changing contents with the same key is rejected.
- Sellers deliver paid order items to ON PART's Shahriar hub. Management records actual receipt of selected lines in the existing order detail modal. This operation is idempotent and consumes the physical stock once. Shipping is blocked until every line has been received. The only method for these new orders is post, with postage paid separately by the recipient at destination. No postage amount is fabricated or added as a free-shipping amount.
- A cancellation before receipt frees the reservation. Receipt is a physical event: cancellation or deletion afterwards does not fabricate replacement inventory at the seller. Returned hub goods require operational review; automated returns are outside this change.
- No wallet, withdrawals, payment gateway, settlement calculation, shipping-provider integration or public seller profile is introduced here.

## Additive migration and transition

Migration `024_shared_catalog_offers.sql` adds final offer price/token/revision, cart quote fields, order request/policy fields and a reservation table. Initialization uses a database-specific advisory lock and can safely replay. Existing prices, supplier assignments, catalog items, orders and photos are not backfilled or merged.

Historical product-level prices cannot reliably reconstruct each seller's price and markup. Existing inventory starts with `final_price=NULL` and cannot become a market offer until explicitly submitted and approved. The supplier product row provides an activation action for this purpose. A real positive quantity is required for a buyable offer. Old cart rows remain visible and require explicit offer selection; they cannot become zero-price orders.

Before a future release: prepare and approve the initial Shahriar offers, verify seller cities/brand scopes, coordinate paired backend/frontend deployment, back up the normal application database, and complete visual QA on desktop and mobile. The development preview is a standalone local document using clearly labeled synthetic data, never a connected or published shop.

## Validation

- Backend: `node --test test/*.test.js` (MySQL tests opt in separately).
- Frontend: `node --test test/*.test.js`.
- Real isolated MySQL: set `ONPART_TEST_MYSQL_BIN` to an absolute local `mysqld` path, optionally `ONPART_TEST_MYSQL_LIB_DIR`, then run `node scripts/test-marketplace-mysql.cjs` from the backend. The runner starts a new disposable local server; the tests additionally check the explicit server ID before creating UUID-named schemas. It never uses production connection environment variables.

The integration tests exercise existing supplier submission and management approval, multiple offers, Shahriar/approval/scope filtering, buyer and seller privacy, chosen-supplier snapshots, stale quotes, concurrent stock safety, order/receipt idempotency, partial/full payment, partial hub receipt, post-only shipment, rollback and legacy order behavior.

A browser render was not available in the implementation environment. DOM/interaction and responsive-rule tests do not replace final visual inspection; no screenshots are represented as verified browser output.


## Persistent public seller codes

Migration 025 adds a separate immutable allocation table. Each approved supplier receives one random unique code such as `OP-482731`, independent of its private account ID, mobile number, and per-product offer tokens. The same code appears on all that supplier's offers and its cart label. Approved accounts receive missing codes during marketplace initialization, management lookup or their own authenticated account read; new approvals allocate their code inside the approval transaction. Existing allocations are reused after reapproval or price/profile updates.

Codes appear read-only in the supplier account, and management can view and search them in the existing suppliers screen. Hub receipt rows show both the management-only supplier name and its public code. Buyer responses expose the public code with the label “فروشنده تأییدشده”; private seller/contact fields remain excluded. Allocations survive account deletion so an old public code cannot identify a different seller later. Unique constraints and collision retries protect concurrent allocation. No code editing or public code-to-identity lookup endpoint is added.
