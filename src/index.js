import 'dotenv/config';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags
} from 'discord.js';
import { execute as executeSetup } from './commands/setup.js';
import { handleButton, handleModal } from './services/interactions.js';

const token = process.env.TOKEN;
if (!token) {
  console.error('Missing TOKEN. Copy .env.example to .env and add the Discord bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Kingdom Core online as ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    activities: [{ name: 'over the Kingdom', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      await executeSetup(interaction);
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: 'Kingdom Core hit an unexpected error. Nothing was intentionally deleted or reset.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

client.login(token);
