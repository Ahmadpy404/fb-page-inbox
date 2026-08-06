# FB Page Unified Inbox — Project Rules & Guidelines

## 1. Messaging & Meta Graph API Policies
- **No Paid Ads / Sponsored Messages**: Do not suggest paid ad solutions when messaging outside the 24-hour window.
- **Resilient Tag Waterfall**: Always use the multi-tier messaging tag fallback mechanism (`CONFIRMED_EVENT_UPDATE` -> `POST_PURCHASE_UPDATE` -> `ACCOUNT_UPDATE` -> outbound) for organic zero-cost delivery.
- **Sequential Anti-Ban Pacing**: All bulk broadcast operations must send messages sequentially with throttled delays (0.8s – 4.0s) to protect Facebook pages from rate-limiting and account restrictions.

## 2. Frontend & Styling Architecture
- **Vanilla CSS System**: All styling must be defined in `client/src/styles/index.css` following the established dark glassmorphism and cyan/blue neon design system.
- **Real-Time HUD**: Real-time state updates (broadcast progress, new chat messages) must be driven via Socket.io events.

## 3. Backend & Database Standards
- **Prisma Schema Consistency**: Ensure all message records use the exact schema fields (`direction: 'outbound_manual' | 'inbound' | 'outbound_auto'`).
- **Database Safety**: Never commit SQLite binaries or temporary WAL files (`dev.db-wal`, `dev.db-shm`) to git.

## 4. Deployment & CI/CD
- **Render REST API**: Render deploy endpoint returns HTTP 202 Accepted for valid deploy triggers. Monitor until status becomes `[LIVE]`.
