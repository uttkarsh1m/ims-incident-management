import { getRedisClient, CACHE_KEYS, getAndResetSignalCounter } from '../db/redis';
import { queryWithRetry } from '../db/postgres';
import { DashboardState, WorkItemSummary } from '../types';

const CACHE_TTL_SECONDS = 10;

export class DashboardService {
  private signalsPerSec = 0;

  /**
   * Get dashboard state — served from Redis cache (hot-path).
   * Falls back to PostgreSQL on cache miss.
   */
  async getDashboardState(): Promise<DashboardState> {
    const redis = getRedisClient();

    // Try cache first
    const cached = await redis.get(CACHE_KEYS.DASHBOARD_STATE);
    if (cached) {
      return JSON.parse(cached) as DashboardState;
    }

    // Cache miss — build from DB
    const state = await this.buildDashboardState();

    // Write back to cache with TTL
    await redis.set(
      CACHE_KEYS.DASHBOARD_STATE,
      JSON.stringify(state),
      'EX',
      CACHE_TTL_SECONDS
    );

    return state;
  }

  private async buildDashboardState(): Promise<DashboardState> {
    const [activeIncidents, counts] = await Promise.all([
      queryWithRetry<WorkItemSummary>(
        `SELECT work_item_id, component_id, component_type, severity, status,
                signal_count, created_at, updated_at
         FROM work_items
         WHERE status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')
         ORDER BY
           CASE severity WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
           created_at DESC
         LIMIT 100`,
        []
      ),
      queryWithRetry<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count
         FROM work_items
         WHERE status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')
         GROUP BY status`,
        []
      ),
    ]);

    const countMap = counts.reduce(
      (acc, row) => {
        acc[row.status] = parseInt(row.count, 10);
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      active_incidents: activeIncidents,
      total_open: countMap['OPEN'] ?? 0,
      total_investigating: countMap['INVESTIGATING'] ?? 0,
      total_resolved: countMap['RESOLVED'] ?? 0,
      signals_per_sec: this.signalsPerSec,
      last_updated: new Date(),
    };
  }

  /**
   * Update the signals/sec metric (called by metrics reporter).
   */
  updateSignalsPerSec(value: number): void {
    this.signalsPerSec = value;
    // Invalidate cache so next read picks up new metric
    const redis = getRedisClient();
    redis.del(CACHE_KEYS.DASHBOARD_STATE).catch(() => {});
  }

  /**
   * Called every METRICS_INTERVAL_MS to compute and log throughput.
   */
  async computeAndLogMetrics(intervalMs: number): Promise<void> {
    const count = await getAndResetSignalCounter();
    const perSec = Math.round((count / intervalMs) * 1000);
    this.signalsPerSec = perSec;

    const [totalRows] = await queryWithRetry<{ total: string }>(
      `SELECT COUNT(*) as total FROM work_items WHERE status != 'CLOSED'`,
      []
    );

    console.log(
      `[METRICS] Signals/sec: ${perSec} | Active Work Items: ${totalRows?.total ?? 0} | ` +
        `Interval signals: ${count} | ${new Date().toISOString()}`
    );
  }
}
