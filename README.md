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


## Bank-card encryption
Set `CARD_ENCRYPTION_KEY` to a long random production secret. Card numbers are encrypted with AES-256-GCM and API responses expose only masked values/last4. Keep the key stable across deployments. For local backward compatibility only, `JWT_SECRET` is used when this variable is absent; production should always use a separate key.
