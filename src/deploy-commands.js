import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as uiUpgradeCommand } from './commands/uipgrade.js';
import { data as setup3Command } from './commands/setup3.js';
import { data as modCommand } from './commands/mod.js';
import { data as valueCommand } from './commands/value.js';
import { data as dqCommand } from './commands/dq.js';

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID || '1546171480952283166';
const guildId = process.env.GUILD_ID?.trim();

if (!token) {
  console.error('Missing TOKEN in .env');
  process.exit(1);
}

const commands = [
  uiUpgradeCommand.toJSON(),
  setup3Command.toJSON(),
  modCommand.toJSON(),
  valueCommand.toJSON(),
  dqCommand.toJSON()
];
const rest = new REST({ version: '10' }).setToken(token);

try {
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`Deployed ${commands.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
