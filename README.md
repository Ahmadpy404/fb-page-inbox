# FB Page Unified Inbox

> **Self-hosted Unified Inbox & Automation Engine for Facebook Page Messenger**  
> Built with Node.js, Express, TypeScript, Prisma (SQLite), React, Vite, and Socket.IO.  
> Uses **ONLY** official Meta Graph API (v19.0) and Messenger Platform Webhooks. No scraping, no unofficial automation, and no personal credential access.

---

## 🌟 Key Features

1. **Unified Real-time Inbox**:
   - Live message streaming via WebSockets (Socket.IO) without page refresh.
   - Distinct message visualization for inbound customer messages, manual replies from page admins, and automated replies from bots.
   - Instant search & filtering by customer name, Page-Scoped ID (PSID), or message contents.
   - Unread badges and auto-scroll to latest incoming messages.
2. **Official Meta Graph API Integration**:
   - Secure webhook handshake verification (`hub.challenge` / `hub.verify_token`).
   - Cryptographic HMAC-SHA256 signature verification (`X-Hub-Signature-256`) against raw payloads using your App Secret.
   - Deduplication and echo handling (captures replies sent from Meta Business Suite / Mobile Messenger app without duplicate notifications).
   - Profile backfill fetching user names and profile avatars via Graph API.
3. **Keyword Auto-Reply Rules Engine**:
   - Create rules with match types: `Contains Substring`, `Exact Match`, or `Regular Expression`.
   - Live interactive pattern tester in UI to preview regex and substring matches in real time.
   - Priority-based rule execution with drag/click reordering.
   - Per-conversation mute toggle: take over any chat thread without bot interruption.
   - Global auto-reply master switch.
4. **Historical Backfill & Diagnostics**:
   - "Sync History" action button to backfill past conversations and message histories via Graph API `/me/conversations`.
   - Live token diagnostics and Facebook Page connectivity monitor.
5. **Comprehensive Test Suite**:
   - 100% automated test coverage with Vitest unit tests, Supertest API/webhook integration tests, and Playwright end-to-end smoke tests.

---

## 📁 Repository Structure

```
fb-page-unified-inbox/
├── .env.example              # Environment variables template
├── .gitignore                # Excludes .env, databases, and node_modules
├── docker-compose.yml        # Multi-container orchestration
├── Dockerfile                # Production multi-stage container build
├── package.json              # Root workspaces & test orchestration
├── playwright.config.ts      # End-to-end smoke test configuration
│
├── server/                   # Backend Express & Prisma API
│   ├── prisma/
│   │   └── schema.prisma     # SQLite database schema (Conversations, Messages, Rules, Settings)
│   ├── src/
│   │   ├── config.ts         # Environment validation (Zod)
│   │   ├── db.ts             # Prisma client singleton
│   │   ├── socket.ts         # Socket.IO realtime server
│   │   ├── services/
│   │   │   ├── graphApi.ts   # Official Graph API client (messages, profiles, backfill)
│   │   │   ├── webhook.ts    # HMAC-SHA256 signature verification & payload parser
│   │   │   ├── autoReply.ts  # Auto-reply rule engine & priority matcher
│   │   │   └── conversations.ts # Conversation & message ingestion logic
│   │   ├── routes/
│   │   │   ├── webhook.ts    # GET & POST /webhook/facebook
│   │   │   ├── conversations.ts # REST API for conversations & replies
│   │   │   ├── rules.ts      # REST API for keyword rules CRUD
│   │   │   └── settings.ts   # REST API for settings & Facebook diagnostics
│   │   ├── app.ts            # Express application setup with raw body verification
│   │   └── server.ts         # HTTP & Socket.IO entrypoint
│   └── tests/
│       ├── unit/             # Unit tests (config, webhook HMAC, auto-reply engine)
│       └── integration/      # Integration tests (webhook POST, REST APIs)
│
├── client/                   # Frontend React + Vite + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx
│   │   │   ├── Inbox/
│   │   │   │   ├── ConversationList.tsx
│   │   │   │   └── ChatWindow.tsx
│   │   │   ├── Rules/
│   │   │   │   └── RulesManager.tsx
│   │   │   └── Settings/
│   │   │       └── SettingsPanel.tsx
│   │   ├── services/
│   │   │   ├── api.ts        # Typed REST API client
│   │   │   └── socket.ts     # Realtime WebSocket subscriber
│   │   ├── styles/
│   │   │   └── index.css     # Modern glassmorphic design system
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vite.config.ts
└── tests/
    └── e2e/
        └── smoke.spec.ts     # Playwright E2E smoke test
```

---

## 🛠️ Meta Developer Console Step-by-Step Setup Guide

Follow these steps to connect your Facebook Page:

### 1. Create a Meta App
1. Go to [Meta for Developers](https://developers.facebook.com/) and log in.
2. Click **My Apps** > **Create App**.
3. Select **Business** or **Other** > **Business** as the app type.
4. Give your app a name (e.g., `My Page Inbox`) and provide your contact email.

### 2. Add Messenger Product
1. On the App Dashboard, find **Messenger** in the product list and click **Set Up**.
2. Under **Messenger > Settings**, scroll to **Access Tokens**.
3. Click **Add or remove Pages** and select your Facebook Page.
4. Click **Generate Token** next to your Page. Copy this token—this is your `PAGE_ACCESS_TOKEN`.

### 3. Retrieve Your App Secret
1. In the left navigation menu, go to **App settings > Basic**.
2. Click **Show** next to **App Secret**. Copy this value—this is your `APP_SECRET`.

### 4. Configure Webhooks
1. In development, start an HTTPS tunnel (e.g., via ngrok):
   ```bash
   ngrok http 3000
   ```
   Copy the public forwarding HTTPS URL (e.g., `https://abc1234.ngrok-free.app`).
2. Go back to **Messenger > Settings > Webhooks** in the Meta Developer Dashboard.
3. Click **Add Callback URL**:
   - **Callback URL**: `https://<your-ngrok-url>/webhook/facebook`
   - **Verify Token**: Enter any secure string you choose (e.g., `my_secret_verify_token_123`). This must match `VERIFY_TOKEN` in your `.env`.
4. Click **Verify and Save**. (The backend must be running to reply to Meta's verification challenge).
5. In the **Subscription Fields** for your Page, click **Edit** and enable:
   - ✅ `messages`
   - ✅ `message_echoes`
   - ✅ `messaging_postbacks`

### 5. Development Mode Testing & Permissions
- In **Development Mode**, the app will immediately work for anyone who is an **Admin, Developer, or Tester** of the Meta App or the Facebook Page.
- To test with another Facebook account, go to **App roles > Roles > Testers** and invite their account.
- *Note:* **App Review** (`pages_messaging` permission) is **only required** if you plan to make this app publicly available to arbitrary Facebook users who aren't testers/admins of your app. For personal use on your own Page, Development Mode works out of the box.

---

## 🚀 Quick Start / Local Development

### 1. Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)

### 2. Setup Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` with your Meta credentials:
```env
PORT=3000
DATABASE_URL="file:./dev.db"
APP_SECRET="your_meta_app_secret"
PAGE_ACCESS_TOKEN="your_facebook_page_access_token"
VERIFY_TOKEN="your_custom_verify_token"
GRAPH_API_BASE_URL="https://graph.facebook.com/v19.0"
CLIENT_PORT=5173
```

### 3. Install Dependencies & Initialize Database
```bash
npm install
npm run prisma:generate
npm run prisma:push
```

### 4. Start Development Servers
Start both backend (port 3000) and frontend (port 5173) concurrently:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Automated Testing

Run the full automated test suite (unit, integration, and E2E smoke tests):

```bash
# Run all tests (Unit + Integration + Playwright E2E)
npm test

# Run backend tests only (Vitest)
npm run test:backend

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run Playwright E2E smoke test
npm run test:e2e
```

---

## 🐳 Docker Deployment

To build and run the unified inbox in a Docker container:

```bash
docker-compose up -d --build
```
The application will be accessible at `http://localhost:3000`.

---

## 🔒 Security & Privacy Notes

- **Zero Scraping / No Unofficial Automation**: Only official Facebook Graph API endpoints (`graph.facebook.com`) and standard webhooks are used.
- **HMAC Verification**: Every incoming webhook POST is cryptographically validated using `crypto.timingSafeEqual` and your `APP_SECRET`.
- **Environment Isolation**: `.env` and SQLite database files are excluded from git.
- **Human Takeover / Muting**: Admins can mute auto-reply rules for any individual conversation directly from the inbox thread.
