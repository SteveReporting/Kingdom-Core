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
import { execute as executeMod } from './commands/mod.js';
import { handleApplicationLinkButton, handleApplicationLinkModal } from './services/applicationLinks.js';
import {
  handleCarryTicketButton,
  handleCarryTicketModal,
  handleCarryTicketSelect
} from './services/carryTickets.js';
import { handlePartyButton, handlePartyModal, handlePartySelect } from './services/carryPartiesV3.js';
import {
  handleCommunityV4Button,
  handleCommunityV4Modal,
  handleCommunityV4Select,
  runCommunityMaintenance
} from './services/communityV4.js';
import { startExternalInfra } from './services/externalInfraV4.js';
import { handleButton, handleModal, handleSelect } from './services/interactions.js';
import { handleLevelReactionAdd, handleLevelReactionRemove } from './services/levelRoles.js';
import {
  handlePlatformV4CompleteButton,
  handlePlatformV4CompleteModal,
  handlePlatformV4CompleteSelect,
  runPlatformV4CompleteMaintenance
} from './services/platformV4Complete.js';
import {
  handleV4Button,
  handleV4CommendButton,
  handleV4DecisionButton,
  handleV4Modal,
  handleV4Select
} from './services/platformV4Interactions.js';
import { startPlatformApi } from './services/platformApiV4.js';
import { runV4Maintenance, trackPlatformEvent } from './services/platformV4Runtime.js';
import { handleQueueButton, handleQueueSelect } from './services/queueV2.js';
import { handleAuditLogEntry, handleMessageSpam } from './services/security.js';
import { handleV4AuditEvent } from './services/securityV4.js';
import { updateServerStats } from './services/serverStatsVerification.js';
import { handleTicketControlButton, handleTicketControlSelect } from './services/ticketControlV2.js';

const token = process.env.TOKEN;
if (!token) {
  console.error('Missing TOKEN. Copy .env.example to .env and add the Discord bot token.');
  process.exit(1);
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions
];
if (String(process.env.ENABLE_MEMBER_STATS_INTENT).toLowerCase() === 'true') {
  intents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Kingdom Core online as ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    activities: [{ name: 'over the Kingdom', type: ActivityType.Watching }],
    status: 'online'
  });

  for (const guild of readyClient.guilds.cache.values()) {
    updateServerStats(guild).catch(() => null);
    runV4Maintenance(guild).catch(() => null);
    runPlatformV4CompleteMaintenance(guild).catch(() => null);
    runCommunityMaintenance(guild).catch(() => null);
  }

  startPlatformApi(readyClient).catch((error) => console.error('Platform API startup error:', error));
  startExternalInfra(readyClient).catch((error) => console.error('External infrastructure startup error:', error));

  const timer = setInterval(() => {
    for (const guild of readyClient.guilds.cache.values()) {
      updateServerStats(guild).catch(() => null);
      runV4Maintenance(guild).catch(() => null);
      runPlatformV4CompleteMaintenance(guild).catch(() => null);
      runCommunityMaintenance(guild).catch(() => null);
    }
  }, 300_000);
  timer.unref?.();
});

client.on(Events.GuildMemberAdd, async (member) => {
  await updateServerStats(member.guild).catch(() => null);
  await trackPlatformEvent(member.guild.id, 'member.joined', { userId: member.id, accountCreatedAt: member.user.createdAt.toISOString() }).catch(() => null);
});

client.on(Events.GuildMemberRemove, async (member) => {
  await updateServerStats(member.guild).catch(() => null);
  await trackPlatformEvent(member.guild.id, 'member.left', { userId: member.id }).catch(() => null);
});

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  try {
    await handleAuditLogEntry(entry, guild, client.user?.id);
    await handleV4AuditEvent(entry, guild, client.user?.id);
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
      if (interaction.commandName === 'mod') {
        await executeMod(interaction);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('kc4x:')) {
        const handled = await handlePlatformV4CompleteButton(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4c:')) {
        const handled = await handleCommunityV4Button(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4:')) {
        let handled = await handleV4DecisionButton(interaction);
        if (handled !== false) return;
        handled = await handleV4CommendButton(interaction);
        if (handled !== false) return;
        handled = await handleV4Button(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc3:party:') || interaction.customId === 'kc2:carry:open' || interaction.customId === 'kc:carry:join') {
        const handled = await handlePartyButton(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc2:carry:')) {
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
      if (interaction.customId.startsWith('kc4x:')) {
        const handled = await handlePlatformV4CompleteSelect(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4c:')) {
        const handled = await handleCommunityV4Select(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4:')) {
        const handled = await handleV4Select(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc3:party:')) {
        const handled = await handlePartySelect(interaction);
        if (handled !== false) return;
      }
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
      if (interaction.customId.startsWith('kc4x:')) {
        const handled = await handlePlatformV4CompleteModal(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4c:')) {
        const handled = await handleCommunityV4Modal(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc4:')) {
        const handled = await handleV4Modal(interaction);
        if (handled !== false) return;
      }
      if (interaction.customId.startsWith('kc3:party:')) {
        const handled = await handlePartyModal(interaction);
        if (handled !== false) return;
      }
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
