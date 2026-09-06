# 👑 Kingdom Core

**The system behind the realm.**

Kingdom Core is the all-in-one Discord operating platform for **Kingdom Carries**, a Dungeon Quest community.

The bot intentionally uses one administrative setup command: **`/setup`**.

Running `/setup` installs, migrates or repairs the complete Kingdom Core platform. It is designed for existing servers as well as fresh installs: existing roles, channels, panels and stored state are reused wherever possible rather than intentionally wiping the guild.

## Application

- **Name:** Kingdom Core
- **Application ID:** `1546171480952283166`
- **Invite with Administrator:**
  `https://discord.com/oauth2/authorize?client_id=1546171480952283166&permissions=8&scope=bot%20applications.commands`

> Administrator is requested because `/setup` manages roles, categories, channels, permission overwrites, webhooks and server security. The command itself is restricted to server administrators.

## Commands

Kingdom Core deliberately keeps the slash-command surface small:

- `/setup` — install, migrate and repair the complete platform
- `/mod` — moderation controls

The old `/setup2`, `/setup3` and `/setup4` commands have been retired. Their systems are now included automatically in `/setup`.

## Compact server structure

`/setup` consolidates Kingdom-managed areas into seven main categories instead of creating a separate category for every subsystem:

1. **👑 START HERE** — welcome, rules, verification and server information
2. **🏰 COMMUNITY** — chat, progression, Houses, events and public Kingdom systems
3. **⚔️ CARRIES** — carry desk, live queue, parties and private carry missions
4. **💰 MARKET & TREASURY** — marketplace, treasury, trading and economy systems
5. **🕯️ SUPPORT & APPLICATIONS** — support, applications and private petitions
6. **🛡️ KNIGHTS** — carrier operations, trials, training and service controls
7. **👑 STAFF HQ** — staff operations, security, analytics and platform control

Existing Kingdom Core channels are moved into the consolidated layout while retaining their channel-level permission overwrites. Obsolete empty Kingdom categories are removed. Safe empty duplicate managed channels are removed automatically; populated duplicates are preserved rather than deleting messages or staff history.

## Systems installed by `/setup`

### Roles and progression

- Crown and leadership hierarchy
- Staff and moderation hierarchy
- Royal Vanguard / Knight carrier hierarchy
- Trial carrier role
- Member progression roles
- Dungeon Quest level roles
- Houses
- Notification roles

### Carry operations

- Free carry request system
- Private carry tickets
- Grouped compatible requests
- Live queue
- Carrier claiming and assignment
- Ready checks
- Carry state machine
- Return-to-pool / recovery flow
- Completion tracking
- Demand and wait-time forecasting
- Carrier workload, service time and coverage

### Carrier / Knight systems

- Carrier profiles
- Trial progression
- 5 successful supervised-run requirement
- Service tracking
- Reputation and commendations
- Skill / coverage systems
- Carrier document library and control surfaces

### Member and Kingdom systems

- Member identity records
- Kingdom XP and progression
- Prestige
- Houses and House standings
- Daily / weekly / Kingdom quests
- Achievements and contribution tracking
- Referrals
- Mentor network
- Verification and level intelligence

### Community and events

- Royal Calendar
- Event creation and RSVP
- Team building / tournament foundations
- Notification routing
- Royal Archives / knowledge tools
- Community maintenance systems

### Marketplace and treasury

- Marketplace listings
- Search and market intelligence
- Watchlists
- Treasury inventory
- Treasury requests and approvals
- Item lending / loan ledger
- Economy audit history

### Applications and support

- Application hub
- Staff / carrier / creator application workflows
- Structured review metrics and scoring
- Private support petitions
- Ticket ownership
- SLA / escalation tracking
- Resolution summaries

### Staff, analytics and security

- Royal Control Plane
- Carry operations dashboard
- Application command centre
- Ticket command centre
- Analytics command centre
- Security command centre
- Audit ledger
- Approved bot and webhook registry
- Permission drift / digital twin
- Emergency lockdown and repair systems
- AutoMod and spam protection

### Platform / website integration

- Optional HTTP platform API
- Live WebSocket updates
- Public operational snapshot
- Carry, marketplace, leaderboard and House data surfaces
- Optional PostgreSQL and Redis adapters
- Background maintenance / workflow engine
- Runtime diagnostics and platform assurance

## Idempotent migration behaviour

`/setup` is safe to rerun as a repair/migration command. It will:

- find and reuse existing Kingdom roles and channels
- add missing systems
- repair permission matrices
- refresh pinned control panels
- preserve existing Kingdom state in `data/<guild-id>.json`
- merge compatible duplicate carry parties
- consolidate Kingdom-managed categories
- remove only safe empty duplicate channels automatically
- preserve populated duplicates rather than deleting message history
- verify the final role hierarchy at the end

It does **not** intentionally wipe the server or delete arbitrary user-created content.

## Security model

The bot account can have Discord Administrator so it has enough authority to build and repair the platform, but `/setup` is restricted to server administrators.

Kingdom Core does **not** contain `eval`, arbitrary remote code execution, remote shell functionality or token logging.

## Requirements

- Node.js 20+
- A Discord bot token for application `1546171480952283166`

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your bot token. For immediate guild-scoped command deployment, set `GUILD_ID` to the Kingdom Carries server ID.

## Register commands

```bash
npm run deploy
```

With `GUILD_ID` set, `/setup` and `/mod` are registered to that guild immediately. With it blank, they are registered globally.

## Start

```bash
npm start
```

Then, as a server administrator, run:

```text
/setup
```

## Updating an existing deployment

On the server running Kingdom Core:

```bash
git pull
npm install
npm run check
npm run deploy
pm2 restart kingdom-core --update-env
pm2 save
```

After the restart, run `/setup` once in Discord. The unified setup performs the migration and category consolidation.

## Hosting

Kingdom Core has no mandatory paid API or database dependency. It can run on an existing Linux/VPS host with JSON persistence, while PostgreSQL and Redis remain optional infrastructure upgrades.
