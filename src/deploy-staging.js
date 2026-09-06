import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as setupCommand } from './commands/setup.js';
import { data as setup2Command } from './commands/setup2.js';
import { data as setup3Command } from './commands/setup3.js';
import { data as setup4Command } from './commands/setup4.js';
import { data as modCommand } from './commands/mod.js';

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID || '1546171480952283166';
const stagingGuildId = process.env.STAGING_GUILD_ID?.trim();

if (!token) {
  console.error('Missing TOKEN in .env');
  process.exit(1);
}
if (!stagingGuildId) {
  console.error('Missing STAGING_GUILD_ID in .env. Set it to a separate development Discord server before using deploy:staging.');
  process.exit(1);
}

const commands = [setupCommand, setup2Command, setup3Command, setup4Command, modCommand].map((x) => x.toJSON());
const rest = new REST({ version: '10' }).setToken(token);

try {
  await rest.put(Routes.applicationGuildCommands(clientId, stagingGuildId), { body: commands });
  console.log(`Deployed ${commands.length} command(s) to STAGING guild ${stagingGuildId}.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
