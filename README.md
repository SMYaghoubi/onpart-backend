# OnPart Backend

Express and MySQL API for OnPart.

## Setup

1. Copy .env.example to .env and fill the required values.
2. Install dependencies with npm install.
3. Apply SQL files from migrations in numeric order.
4. Start locally with npm run dev.

## Quality checks

- npm test
- node --check server.js

## Important routes

- /health
- /api/auth
- /api/products
- /api/cart
- /api/orders
- /api/payments

## Cart guarantees

Cart rows are scoped to the authenticated user. Product identifiers and quantities are validated, duplicate replacement rows are rejected, and requested quantities cannot exceed current stock.

## Deployment

Liara supplies runtime environment variables. Do not commit .env. After deployment, verify /health, authentication, cart synchronization and order creation.

## Persistent upload storage

Bank logos, payment receipts, credit documents and user documents must be stored on an attached persistent disk. The database stores only their filenames/URLs.

1. Attach the disk to the backend application and determine its actual mount path in the Liara application configuration or console. Liara does not publish one fixed mount path for every application.
2. Set `UPLOAD_PATH` to that exact **absolute** writable path. Examples supported by the code are `/disks/uploads` and an explicitly configured `/app/uploads`; do not use an example unless it is the real mount.
3. Deploy/restart the backend and check `/health`. `storage.status` and `storage.writable` must be `ok`/`true`. `storage.persistence` reports `persistent-disk` for `/disks/...`; other explicit mounts are reported as `explicit-unverified` because the process cannot prove that a directory is backed by a disk.
4. Re-upload files that already return 404. Their bytes cannot be reconstructed from database URLs.

In production the server fails fast when `UPLOAD_PATH` is missing or not writable. It never falls back to `/tmp`. In development/test, `./uploads` remains available. If Liara mounts a disk named `uploads` at `/disks/uploads`, the server can detect that existing directory when `UPLOAD_PATH` is omitted; an explicit environment value always has priority.


## Bank-card encryption
Set `CARD_ENCRYPTION_KEY` to a long random production secret. Card numbers are encrypted with AES-256-GCM and API responses expose only masked values/last4. Keep the key stable across deployments. For local backward compatibility only, `JWT_SECRET` is used when this variable is absent; production should always use a separate key.

## Visitor statistics and access hardening

`/api/visitors/heartbeat` records a storefront page view and updates presence. Browser identifiers are hashed, page names are allowlisted, and no IP addresses, query strings, or form contents are saved. Multiple tabs share one browser identifier. Presence expires after 75 seconds without a visible-page heartbeat. Daily totals use Tehran midnight; history is retained for 35 days. `/api/visitors/summary` is management-only. Counts start at deployment, not retrospectively.

Migration `021_create_site_visits.sql` is idempotent. The visitors service also applies this single additive table migration on its first request. A database role without CREATE permission must have the migration applied before enabling analytics; a failure is reported as unavailable statistics and does not block orders.

Legacy biometric registration/authentication endpoints return 410 until a complete signed-assertion verifier is provided. Password and OTP authentication continue unchanged. Existing credential rows are preserved. Invoice listing defaults to the signed-in customer's own orders; management listing requires `?admin=1` and an active management session.

Credit approval locks the request and updates the balance in one transaction. A repeated approval is a no-op, and approved requests cannot be rejected or deleted. Approval amounts must be positive integers no greater than the requested amount. Notifications are best-effort after commit.
