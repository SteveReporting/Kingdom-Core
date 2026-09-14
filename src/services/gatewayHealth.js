import { Message } from 'discord.js';
import { installLiveKingdomPresence, CHANNEL_PERSONA_HANDLED } from './liveKingdomPresenceV2.js';
import { installLiveDQSystems } from './liveDqSystems.js';

const READY_STATUS = 0;
const ORIGINAL_MESSAGE_REPLY = Symbol.for('kingdom-core.original-message-reply');

function installSafeMessageReplies() {
  if (Message.prototype[ORIGINAL_MESSAGE_REPLY]) return;

  const originalReply = Message.prototype.reply;
  Object.defineProperty(Message.prototype, ORIGINAL_MESSAGE_REPLY, {
    value: originalReply,
    configurable: false,
    enumerable: false,
    writable: false
  });

  Message.prototype.reply = async function kingdomSafeReply(options) {
    // Dedicated channel personalities own their messages. This prevents older/global
    // assistants from producing a second reply in the same channel after the persona
    // has already handled it.
    if (this[CHANNEL_PERSONA_HANDLED]) return null;

    try {
      return await originalReply.call(this, options);
    } catch (error) {
      const unknownReference =
        error?.code === 10008 ||
        (error?.code === 50035 && (
          error?.rawError?.errors?.message_reference ||
          String(error?.message ?? '').includes('MESSAGE_REFERENCE_UNKNOWN_MESSAGE') ||
          String(error?.message ?? '').includes('Unknown message')
        ));

      if (!unknownReference || !this.channel?.isTextBased?.()) throw error;

      console.warn(`[Discord] Reply target ${this.id} disappeared; sending response normally in #${this.channel?.name ?? this.channelId}.`);
      return this.channel.send(options);
    }
  };
}

function describeClose(event) {
  if (!event) return 'unknown close';
  return `code=${event.code ?? 'unknown'} reason=${event.reason || 'none'} clean=${Boolean(event.wasClean)}`;
}

export function installGatewayHealth(client, options = {}) {
  installSafeMessageReplies();

  // Install dedicated live personalities first. Their MessageCreate listener marks
  // messages synchronously so general/global assistants do not double-answer them.
  installLiveKingdomPresence(client);
  installLiveDQSystems(client);

  const checkEveryMs = Number(options.checkEveryMs ?? 30_000);
  const startupGraceMs = Number(options.startupGraceMs ?? 90_000);
  const unhealthyRestartMs = Number(options.unhealthyRestartMs ?? 120_000);
  const startedAt = Date.now();
  let unhealthySince = null;
  let lastHealthyAt = null;

  client.on('shardReady', (shardId) => {
    lastHealthyAt = Date.now();
    unhealthySince = null;
    console.log(`[Gateway] shard ${shardId} ready.`);
  });

  client.on('shardResume', (shardId, replayedEvents) => {
    lastHealthyAt = Date.now();
    unhealthySince = null;
    console.log(`[Gateway] shard ${shardId} resumed (${replayedEvents ?? 0} replayed events).`);
  });

  client.on('shardDisconnect', (event, shardId) => {
    unhealthySince ??= Date.now();
    console.error(`[Gateway] shard ${shardId} disconnected: ${describeClose(event)}.`);
  });

  client.on('shardError', (error, shardId) => {
    unhealthySince ??= Date.now();
    console.error(`[Gateway] shard ${shardId} error:`, error);
  });

  client.on('error', (error) => {
    console.error('[Discord client error]', error);
  });

  const timer = setInterval(() => {
    const now = Date.now();
    const ready = client.isReady();
    const wsReady = client.ws.status === READY_STATUS;
    const healthy = ready && wsReady;

    if (healthy) {
      lastHealthyAt = now;
      unhealthySince = null;
      return;
    }

    if (now - startedAt < startupGraceMs) return;
    unhealthySince ??= now;
    const unhealthyFor = now - unhealthySince;

    console.error(
      `[Gateway watchdog] unhealthy for ${Math.round(unhealthyFor / 1000)}s ` +
      `(clientReady=${ready}, wsStatus=${client.ws.status}, ping=${client.ws.ping}, ` +
      `lastHealthy=${lastHealthyAt ? new Date(lastHealthyAt).toISOString() : 'never'}).`
    );

    if (unhealthyFor >= unhealthyRestartMs) {
      console.error('[Gateway watchdog] Discord session did not recover. Exiting so PM2 can restart Kingdom Core.');
      clearInterval(timer);
      process.exit(75);
    }
  }, checkEveryMs);
  timer.unref?.();

  process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled rejection]', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[Uncaught exception]', error);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    console.log(`[Process] ${signal} received; closing Discord connection.`);
    clearInterval(timer);
    try {
      client.destroy();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return timer;
}
