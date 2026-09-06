# 👑 Kingdom Core

**The system behind the realm.**

Kingdom Core is the all-in-one Discord infrastructure bot for **Kingdom Carries**, a Dungeon Quest community. The bot is intentionally centered around one administrative command: **`/setup`**.

Running `/setup` builds or repairs the Kingdom Carries Discord structure without deleting existing server content.

## Application

- **Name:** Kingdom Core
- **Application ID:** `1546171480952283166`
- **Invite with Administrator:**
  `https://discord.com/oauth2/authorize?client_id=1546171480952283166&permissions=8&scope=bot%20applications.commands`

> Administrator is deliberately requested because `/setup` creates roles, categories, channels and permission overwrites. The command itself is restricted to server administrators.

## What `/setup` creates

### Leadership & staff
- 👑 The Crown
- ♛ Regent
- ⚜️ Royal Council
- ⚔️ Lord Commander
- 📜 Chancellor
- 🗝️ Steward
- 🛡️ Royal Guard
- 🏰 Castle Guard
- 🔭 Watchman
- ✒️ Royal Scribe
- 📯 Herald
- 🔮 Court Mage

### Carrier hierarchy
- 🏆 Royal Champion
- 🗡️ Knight Captain
- ⚔️ Royal Knight
- ⚔️ Knight
- 🛡️ Squire • Carrier Trial

### Member progression
Traveller → Citizen → Noble → Baron → Count → Duke → Prince → Champion of the Realm

### Houses
- 🐉 House Drakon
- 🦁 House Leonis
- 🦅 House Aether
- 🐺 House Fenrir

### Server areas
Arrival, The Kingdom, Carries, Progression, Market District, Community, Support, private Knights' Quarters, and private Royal Council.

### Interactive systems included now
- House selection
- Toggleable carry/event/market pings
- Free carry queue
- Carrier claim + completion flow
- Live carry queue message
- Completed carry feed
- Private support petitions/tickets
- Starter quest board
- Rules + welcome panels
- JSON persistence — **no paid database required**

## Security model

The bot account can have Discord Administrator so it has enough power to build the server, but `/setup` is restricted to server administrators. The setup process is **idempotent**: it creates missing pieces and repairs the foundation rather than deleting the server.

Kingdom Core does **not** contain `eval`, arbitrary code execution, remote shell functionality, or token logging.

## Requirements

- Node.js 20+
- A Discord bot token for application `1546171480952283166`

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your bot token.

For fast testing, add your test server ID to `GUILD_ID`.

## Register `/setup`

```bash
npm run deploy
```

With `GUILD_ID` set, the command is registered to that guild for immediate testing. With it blank, the command is registered globally.

## Start

```bash
npm start
```

Then, as a server administrator, run:

```text
/setup
```

## Free hosting

The bot itself has no paid API or database dependency. It can run anywhere that keeps a Node.js process alive, including your existing Linux/VPS host. State is kept in `data/<guild-id>.json`.

## Planned expansion

The foundation is structured for Kingdom XP, automated quests, achievements, Houses, campaigns, world bosses, carrier stats, marketplace, treasury and website/dashboard integration without turning the bot into a wall of slash commands.
