import { FastifyInstance } from 'fastify';
import { DashboardService } from '../services/DashboardService';
import { ApiResponse } from '../types';

const dashboardService = new DashboardService();

export { dashboardService };

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/dashboard
   * Returns real-time dashboard state from Redis cache (hot-path).
   */
  fastify.get('/api/dashboard', async (_request, reply) => {
    const state = await dashboardService.getDashboardState();
    return reply.send({ success: true, data: state } satisfies ApiResponse);
  });

  /**
   * GET /health
   * Health check endpoint for load balancers and monitoring.
   */
  fastify.get('/health', async (_request, reply) => {
    const checks = await runHealthChecks();
    const allHealthy = Object.values(checks).every((v) => v === 'ok');
    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  });
}

async function runHealthChecks(): Promise<Record<string, string>> {
  const checks: Record<string, string> = {};

  // PostgreSQL
  try {
    const { getPool } = await import('../db/postgres');
    await getPool().query('SELECT 1');
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
  }

  // MongoDB
  try {
    const { getMongoDb } = await import('../db/mongo');
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    checks.mongodb = 'ok';
  } catch {
    checks.mongodb = 'error';
  }

  // Redis
  try {
    const { getRedisClient } = await import('../db/redis');
    await getRedisClient().ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  return checks;
}
