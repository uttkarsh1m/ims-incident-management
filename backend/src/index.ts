import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config';
import { initPostgres, closePostgres } from './db/postgres';
import { initMongo, closeMongo } from './db/mongo';
import { getRedisClient, closeRedis } from './db/redis';
import { signalRoutes } from './routes/signals';
import { workItemRoutes } from './routes/workItems';
import { dashboardRoutes, dashboardService } from './routes/dashboard';
import { websocketRoutes, broadcastDashboardUpdate } from './routes/websocket';
import { startSignalWorker, closeQueues } from './queue/SignalQueue';

const fastify = Fastify({
  logger: {
    level: config.server.nodeEnv === 'production' ? 'warn' : 'info',
  },
});

async function bootstrap(): Promise<void> {
  // ─── Register Plugins ───────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    errorResponseBuilder: (_request, context) => ({
      success: false,
      error: `Rate limit exceeded. Max ${context.max} requests per ${context.after}.`,
    }),
  });

  await fastify.register(websocket);

  // ─── Initialize Databases ───────────────────────────────────────────────────
  await initPostgres();
  await initMongo();
  getRedisClient(); // Establish connection

  // ─── Register Routes ────────────────────────────────────────────────────────
  await fastify.register(signalRoutes);
  await fastify.register(workItemRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(websocketRoutes);

  // ─── Start Queue Workers ────────────────────────────────────────────────────
  startSignalWorker();

  // ─── Metrics Reporter (every 5 seconds) ────────────────────────────────────
  const metricsInterval = setInterval(async () => {
    try {
      await dashboardService.computeAndLogMetrics(config.metrics.intervalMs);
      // Broadcast updated dashboard state to all WebSocket clients
      const state = await dashboardService.getDashboardState();
      broadcastDashboardUpdate(state);
    } catch (err) {
      console.error('[Metrics] Error computing metrics:', (err as Error).message);
    }
  }, config.metrics.intervalMs);

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    clearInterval(metricsInterval);
    await fastify.close();
    await closeQueues();
    await closePostgres();
    await closeMongo();
    await closeRedis();
    console.log('[Server] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ─── Start Server ───────────────────────────────────────────────────────────
  await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
  console.log(`[Server] IMS Backend running on port ${config.server.port}`);
  console.log(`[Server] Health check: http://localhost:${config.server.port}/health`);
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
