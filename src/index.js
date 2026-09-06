import 'dotenv/config';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials
} from 'discord.js';
import { execute as executeSetup } from './commands/setup.js';
import { execute as executeSetup2 } from './commands/setup2.js';
import { execute as executeMod } from './commands/mod.js';
import { handleApplicationLinkButton, handleApplicationLinkModal } from './services/applicationLinks.js';
import {
  handleCarryTicketButton,
  handleCarryTicketModal,
  handleCarryTicketSelect
} from './services/carryTickets.js';
import { handleButton, handleModal, handleSelect } from './services/interactions.js';
import { handleLevelReactionAdd, handleLevelReactionRemove } from './services/levelRoles.js';
import { handleQueueButton, handleQueueSelect } from './services/queueV2.js';
import { handleAuditLogEntry, handleMessageSpam } from './services/security.js';
import { handleTicketControlButton, handleTicketControlSelect } from './services/ticketControlV2.js';

const token = process.env.TOKEN;
if (!token) {
  console.error('Missing TOKEN. Copy .env.example to .env and add the Discord bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
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

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleLevelReactionAdd(reaction, user);
  } catch (error) {
    console.error('Level reaction add error:', error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleLevelReactionRemove(reaction, user);
  } catch (error) {
    console.error('Level reaction remove error:', error);
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
      if (interaction.customId === 'kc:carry:join' || interaction.customId.startsWith('kc2:carry:')) {
        const handled = await handleCarryTicketButton(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc2:apps:')) {
        await handleApplicationLinkButton(interaction);
        return;
      }
      if (interaction.customId.startsWith('kc2:tickets:')) {
        const handled = await handleTicketControlButton(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc:carry:') || interaction.customId.startsWith('kc:qv2:')) {
        await handleQueueButton(interaction);
        return;
      }
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('kc2:carry:')) {
        const handled = await handleCarryTicketSelect(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc2:tickets:')) {
        const handled = await handleTicketControlSelect(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc:carry:') || interaction.customId.startsWith('kc:qv2:')) {
        await handleQueueSelect(interaction);
        return;
      }
      await handleSelect(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('kc2:carry:')) {
        const handled = await handleCarryTicketModal(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc2:apps:')) {
        const handled = await handleApplicationLinkModal(interaction);
        if (handled !== false) return;
      }
      await handleModal(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = {
      content: `Kingdom Core hit an unexpected error: ${String(error?.message ?? error).slice(0, 1500)}`,
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
