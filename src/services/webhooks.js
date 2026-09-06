import { WebhookClient } from 'discord.js';

export async function sendBrandedWebhook(guild, state, key, payload = {}) {
  const saved = state.setup?.webhooks?.[key];
  const safePayload = {
    ...payload,
    allowedMentions: payload.allowedMentions ?? { parse: [] }
  };

  if (saved?.id && saved?.token) {
    const client = new WebhookClient({ id: saved.id, token: saved.token });
    try {
      await client.send({
        username: saved.name,
        avatarURL: guild.client.user.displayAvatarURL(),
        ...safePayload
      });
      return true;
    } catch {
      // Fall through to channel send if the webhook was removed or invalidated.
    } finally {
      client.destroy();
    }
  }

  const channel = saved?.channelId ? guild.channels.cache.get(saved.channelId) : null;
  if (channel?.isTextBased()) {
    await channel.send(safePayload).catch(() => null);
    return true;
  }
  return false;
}
