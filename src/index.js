import 'dotenv/config';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags
} from 'discord.js';
import { execute as executeSetup } from './commands/setup.js';
import { execute as executeSetup2 } from './commands/setup2.js';
import { execute as executeMod } from './commands/mod.js';
import { handleButton, handleModal, handleSelect } from './services/interactions.js';
import { handleAuditLogEntry, handleMessageSpam } from './services/security.js';

const token = process.env.TOKEN;
if (!token) {
  console.error('Missing TOKEN. Copy .env.example to .env and add the Discord bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Kingdom Core online as ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    activities: [{ name: 'over the Kingdom', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  try {
    await handleAuditLogEntry(entry, guild, client.user?.id);
  } catch (error) {
    console.error('Security event error:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessageSpam(message);
  } catch (error) {
    console.error('Anti-spam event error:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        await executeSetup(interaction);
        return;
      }
      if (interaction.commandName === 'setup2') {
        await executeSetup2(interaction);
        return;
      }
      if (interaction.commandName === 'mod') {
        await executeMod(interaction);
        return;
      }
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = {
      content: 'Kingdom Core hit an unexpected error. Nothing was intentionally deleted or reset.',
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

client.login(token);
