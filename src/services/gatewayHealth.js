const READY_STATUS = 0;

function describeClose(event) {
  if (!event) return 'unknown close';
  return `code=${event.code ?? 'unknown'} reason=${event.reason || 'none'} clean=${Boolean(event.wasClean)}`;
}

export function installGatewayHealth(client, options = {}) {
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
