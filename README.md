# 👑 Kingdom Core

**The system behind Kingdom Carries.**

Kingdom Core is the Discord runtime and service layer used by Kingdom Carries. The repository also serves **Kingdom Nexus**, the authenticated web control plane, and the optional private HTTP bridge consumed by the Kingdom Carries HQ website.

This README documents the code that is deployed by the current repository. It intentionally does not list retired slash commands or roadmap-only website actions.

## Discord application

- **Application ID:** `1546171480952283166`
- **Install URL:** `https://discord.com/oauth2/authorize?client_id=1546171480952283166&permissions=1374389534294&scope=bot%20applications.commands`

The install URL uses the same permission integer as the public Kingdom Core website. Individual commands still perform their own user-permission checks, and Discord role hierarchy can further limit moderation actions.

## Slash commands deployed by `npm run deploy`

`src/deploy-commands.js` currently registers exactly five top-level commands:

### `/setup3`

Curates the Kingdom server category layout.

- Administrator-only command.
- `/setup3 preview:true` analyses the live layout without moving or creating anything.
- `/setup3` applies the curated organisation.
- Requires the bot to have **View Channel** and **Manage Channels**.
- Carries, Market & Treasury, and Knights are treated as protected zones by the current organiser.
- Channel permission overwrites are preserved when a channel is moved.
- Ambiguous channels are left in place instead of being guessed into a category.
- The command does not delete channels.

Always run the preview first on a server whose current structure matters.

### `/uipgrade`

Rebuilds configured Kingdom presentation surfaces with the current UI layer.

- Administrator-only command.
- Requires **View Channel**, **Read Message History**, **Send Messages** and **Manage Messages** for the bot.
- Human conversation/history, announcement/news channels, community chat, Dungeon Quest chat, media/showcase, active tickets/carry tickets and security/audit logs are protected from the presentation purge targets in the current implementation.

### `/mod`

Discord moderation actions with Discord permission checks and role-hierarchy enforcement.

Subcommands:

- `/mod timeout`
- `/mod untimeout`
- `/mod kick`
- `/mod ban`
- `/mod unban`

Where a configured moderation-log channel exists in Kingdom state, successful actions are written there.

### `/value`

Kingdom Market Intelligence (KMI) item valuation and fair-trade checking.

- `mode: Market Value` values an item.
- `mode: Is This Fair?` compares requested gold with the current KMI estimate.
- Supports item autocomplete and optional item screenshots.
- POT, upgrade and base values can be supplied to improve the estimate.
- If KMI does not have enough reliable observations, the command reports that instead of inventing a price.

### `/dq`

Unified Dungeon Quest systems command for the Kingdom DQ intelligence layer.

It exposes:

- **Genome** — searchable Dungeon Quest entities, observations, strategies and recorded runs.
- **Digital Twin** — empirical run simulation that improves as real run evidence accumulates.
- **Oracle** — decision ranking for progression, speed, gold, XP and safety objectives.
- **Sentinel** — anomaly detection over recorded Dungeon Quest evidence.
- **DQ Asset Bank** — verified deposits, internal balances, transfers, withdrawal requests and reserve/liability health.

Important: Genome/Twin/Oracle/Sentinel begin with truthful empty state for a new guild. They learn from real `/dq record-run` input and KMI observations rather than fabricated seed statistics. Asset Bank credits are created only after an operator verifies the physical in-game asset was actually received.

## Kingdom Nexus

The native Nexus server is implemented in `src/nexus/platform.js` and the browser application lives in `web/nexus/`.

### Public endpoint

- `GET /health` — returns `{ ok, product, version, guildId }` when Nexus is ready.

### Discord authentication

- `GET /auth/discord`
- `GET /auth/discord/callback`
- `GET /auth/logout`
- `GET /api/me`

Authenticated sessions are revalidated before protected Nexus API access.

The current production authentication policy restricts Nexus Discord sessions to the **owner of the configured Kingdom Carries guild**. This keeps the control plane private while the member-facing HQ remains available to normal guild users.

### Authenticated read surfaces

The current Nexus exposes authenticated reads for products, status, live operations, intelligence, Sentinel, network summary, launcher, Companion, creators, the OpenAPI document and the JavaScript SDK. Live operations also expose a Server-Sent Events stream at `/api/live/stream`.

Privileged reads include identity administration, applications, Vault, Studio layouts and audit records. Privileged mutations use CSRF checks plus the Nexus authorization layer.

The production public URL configured by `.env.example` is:

`https://kingdom-nexus.davidtennyson846.workers.dev`

## Kingdom Carries HQ bridge

`src/services/platformApiV4.js` is the private HTTP bridge used by the public HQ website when `ENABLE_PLATFORM_API=true`.

Public/read endpoints include:

- `/health`
- `/api/overview`
- `/api/carries`
- `/api/houses`
- `/api/marketplace`
- `/api/leaderboard`

Token-protected endpoints include carry creation, member profile reads/writes, personal carry history and administrative configuration/security actions. The HQ Worker keeps the private bridge token server-side and exposes only sanitized web responses.

## Nexus products implemented in this repository

The canonical product catalog is `src/nexus/catalog.js`. It currently defines the following runtime surfaces:

- Kingdom Core
- Kingdom Platform
- Kingdom Mobile
- Kingdom Desktop Control Centre
- Kingdom Network
- Kingdom Cloud
- Kingdom Identity
- Kingdom Launcher
- Kingdom Companion
- Kingdom Live
- Kingdom TV
- Kingdom Creator Platform
- Kingdom API
- Kingdom SDK
- Kingdom Studio
- Kingdom Sentinel
- Kingdom Vault
- Kingdom Intelligence
- Kingdom AI
- Kingdom Nexus

The catalog is the source of truth for product names and advertised capabilities. Website copy should be updated from that catalog rather than from old mock-dashboard text.

## Storage and runtime

The default runtime uses existing Kingdom Core JSON state plus local Vault snapshots. PostgreSQL and Redis adapters are optional; they are not required by the default configuration.

Dungeon Quest state is isolated per guild under `DQ_DATA_DIR` (default `data/dq`). New guild state is intentionally empty until real evidence is recorded.

Node.js **20+** is required.

## Install

```bash
npm install
cp .env.example .env
```

Add the Discord bot token to `.env`. For immediate guild-scoped command deployment, set `GUILD_ID` to the intended guild ID.

Deploy the current slash-command registry:

```bash
npm run deploy
```

Start the runtime:

```bash
npm start
```

## Validation

Syntax/runtime checks:

```bash
npm run check
```

Focused self-tests are also available:

```bash
npm run selftest:setup3
npm run selftest:uipgrade
npm run selftest:carry-sessions
npm run selftest:nexus
npm run selftest:dq
npm run selftest:v4
npm run selftest:v5
npm run selftest:v10
```

Production dependency audit:

```bash
npm run audit:prod
```

## Security notes

- Keep `TOKEN`, Discord OAuth secrets, session secrets and private API tokens out of browser code and source control.
- Nexus privileged writes require an authenticated/authorized session and CSRF validation.
- The public HQ Worker must never forward its private Core API token to the browser.
- `/setup3` and `/uipgrade` are administrator-only because they can change server structure or presentation content.
- `/mod` additionally checks the relevant Discord moderation permission and bot role hierarchy before taking action.
- DQ Asset Bank staff actions should only be approved after physical in-game settlement has been verified.
