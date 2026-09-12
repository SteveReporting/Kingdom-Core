# Kingdom Carries production release runbook

This is the final production runbook for the current Kingdom Carries stack.

## Architecture

- **Oracle Ubuntu VM** — `Kingdom-Core`, Discord runtime, Kingdom Nexus origin, private HQ API, runtime JSON/Vault/DQ state.
- **Cloudflare Worker** — `kingdom-carries-hq`, member-facing website and server-side Discord OAuth/HQ proxy.
- **Cloudflare/secure edge** — public Kingdom Nexus route to the loopback Nexus origin.
- **Dedicated KMI service** — optional but required for `/value` and KMI-valued Asset Bank deposits. It must not share the Core platform API port.
- **GitHub** — source only. Production `.env`, DQ JSON state, Vault state and API/OAuth secrets must never be committed.

## Production state

Dungeon Quest state belongs under the configured `DQ_DATA_DIR` on the VM (default `data/dq`). It is live runtime data, not source data. Genome/Twin/Oracle/Sentinel begin empty and learn from real recorded runs and KMI observations. Never seed fabricated run times, prices or market observations merely to make dashboards look populated.

Back up the complete runtime data/Vault directories before major upgrades.

## Required Core `.env`

At minimum production needs:

```dotenv
TOKEN=<Discord bot token>
CLIENT_ID=1546171480952283166
GUILD_ID=<Kingdom Carries production guild ID>

ENABLE_PLATFORM_API=true
API_HOST=127.0.0.1
API_PORT=8787
API_ADMIN_TOKEN=<32+ character random secret shared only with HQ Worker>

KINGDOM_NEXUS_ENABLED=true
KINGDOM_NEXUS_HOST=127.0.0.1
KINGDOM_NEXUS_PORT=8791
DISCORD_OAUTH_CLIENT_SECRET=<Discord OAuth client secret>
KINGDOM_NEXUS_PUBLIC_URL=https://kingdom-nexus.davidtennyson846.workers.dev

DQ_DATA_DIR=data/dq
DQ_BANK_CREDIT_RATE=0.90
DQ_BANK_RESERVE_RATIO=0.15

# Configure only when the dedicated KMI service exists.
# It must not resolve to the same host+port as API_HOST/API_PORT.
KMI_API_URL=<dedicated private KMI URL>
KMI_API_KEY=<matching KMI key if enabled>
```

Do not paste real secret values into GitHub, Discord or documentation.

## Core deployment

From the Oracle VM:

```bash
cd ~/Kingdom-Core
git pull origin main
npm install
npm run release:check
npm run deploy
pm2 restart kingdom-core --update-env
pm2 save
pm2 logs kingdom-core --lines 100
```

`npm run release:check` runs syntax checks, all current self-tests, the production dependency audit and environment preflight. Do not continue if it reports a `FAIL` blocker.

## Discord layout

After the process is healthy:

```text
/setup3 preview:true
```

Inspect the preview before applying `/setup3`. Then run `/uipgrade` only when you intentionally want the presentation surfaces rebuilt.

## Discord production smoke test

Confirm all five top-level commands appear:

```text
/setup3
/uipgrade
/mod
/value
/dq
```

Test `/dq status`. Record controlled real runs before relying on Twin/Oracle/Sentinel recommendations. Do not accept real Asset Bank deposits until the approved physical asset custodians and staff review procedure are established.

## HQ Worker secrets

The `kingdom-carries-hq` Cloudflare Worker requires:

```text
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
SESSION_SECRET
KINGDOM_CORE_API_URL
KINGDOM_CORE_API_TOKEN
KINGDOM_GUILD_ID
```

`KINGDOM_CORE_API_TOKEN` must exactly match Core `API_ADMIN_TOKEN`. `KINGDOM_CORE_API_URL` must be a secure HTTPS route to the Core private API and must not expose the bearer token to browser code.

The Discord Developer Portal must contain the live HQ callback:

```text
https://<HQ production domain>/api/auth/discord/callback
```

## HQ release test

Use a normal member account and verify this complete path:

```text
Discord join
→ HQ Discord login
→ profile loads
→ Roblox/profile settings save
→ carry request submitted
→ private Discord carry ticket created
→ live queue reflects request
→ carrier/staff handles carry
→ carry completes
→ member history reflects completion
```

Also verify nickname changes only succeed where the Kingdom Core bot has **Manage Nicknames** and its role is above the target member's highest role.

## Nexus policy

Production Nexus Discord sessions are currently restricted to the owner of the configured Kingdom Carries guild. Keep Nexus as the private control plane for initial guild release. Normal members use HQ and Discord.

## Release gate

Release the guild only when:

- Kingdom Core GitHub CI is green.
- `npm run release:check` passes on the actual VM environment.
- PM2 shows `kingdom-core` online without repeated restarts/errors.
- the five slash commands are deployed to the production guild.
- HQ OAuth and the full carry request/history flow pass using a normal account.
- Nexus owner login works.
- DQ state directory and Vault/runtime state are backed up.
- KMI is either deliberately configured and tested, or `/value`/KMI-valued deposits are treated as unavailable until its dedicated service is deployed.
