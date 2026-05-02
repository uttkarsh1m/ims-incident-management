import { v4 as uuidv4 } from 'uuid';
import { queryWithRetry, withTransaction } from '../db/postgres';
import { getRedisClient, CACHE_KEYS } from '../db/redis';
import { WorkItemStateMachine } from '../patterns/state/WorkItemStateMachine';
import {
  WorkItem,
  WorkItemStatus,
  ComponentType,
  SignalSeverity,
  RCARecord,
  SubmitRCARequest,
  RootCauseCategory,
} from '../types';

export class WorkItemService {
  /**
   * Create a new Work Item and register its first signal atomically.
   * Both the work_items INSERT and the signal_work_items INSERT happen in
   * one transaction — consistent with the loser path which uses
   * recordSignalAndIncrement (also a single transaction).
   */
  async createWorkItem(
    componentId: string,
    componentType: ComponentType,
    severity: SignalSeverity,
    workItemId: string = uuidv4(),
    firstSignalId?: string
  ): Promise<WorkItem> {
    const now = new Date();

    const workItem = await withTransaction(async (client) => {
      const result = await client.query<WorkItem>(
        `INSERT INTO work_items
           (work_item_id, component_id, component_type, severity, status, signal_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'OPEN', 1, $5, $5)
         ON CONFLICT (work_item_id) DO UPDATE
           SET updated_at = work_items.updated_at
         RETURNING *`,
        [workItemId, componentId, componentType, severity, now]
      );

      if (firstSignalId) {
        await client.query(
          `INSERT INTO signal_work_items (signal_id, work_item_id)
           VALUES ($1, $2)
           ON CONFLICT (signal_id) DO NOTHING`,
          [firstSignalId, workItemId]
        );
      }

      return result.rows[0];
    });

    // Invalidate AFTER the transaction commits — not inside it.
    // If the transaction rolls back, the cache is not evicted unnecessarily.
    await this.invalidateDashboardCache();
    return workItem;
  }

  /**
   * Record a signal against a work item and increment its counter atomically.
   *
   * Uses a Postgres junction table (signal_work_items) as the idempotency
   * ledger. Both the INSERT and the UPDATE run inside a single transaction:
   *
   *   INSERT INTO signal_work_items (signal_id, work_item_id)
   *   VALUES ($1, $2)
   *   ON CONFLICT (signal_id) DO NOTHING
   *   → returns 1 row if new, 0 rows if already counted
   *
   *   If 1 row inserted → UPDATE work_items SET signal_count = signal_count + 1
   *   If 0 rows inserted → skip the UPDATE
   *
   * This eliminates the cross-system atomicity gap that existed when Redis SADD
   * was used as the guard: SADD committed but DB crashed → count permanently lost.
   * Now both the "seen" record and the counter live in the same Postgres transaction.
   *
   * @returns true  → signal was new, counter incremented
   *          false → signal already counted, counter unchanged (idempotent retry)
   */
  async recordSignalAndIncrement(
    workItemId: string,
    signalId: string
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      // Try to claim this signal_id in the junction table
      const insertResult = await client.query(
        `INSERT INTO signal_work_items (signal_id, work_item_id)
         VALUES ($1, $2)
         ON CONFLICT (signal_id) DO NOTHING`,
        [signalId, workItemId]
      );

      const isNew = insertResult.rowCount === 1;

      if (isNew) {
        // Increment only if the signal was genuinely new
        await client.query(
          `UPDATE work_items
           SET signal_count = signal_count + 1, updated_at = NOW()
           WHERE work_item_id = $1`,
          [workItemId]
        );
      }

      return isNew;
    });
  }

  /**
   * @deprecated Use recordSignalAndIncrement instead.
   * Kept for any callers that don't have a signal_id available.
   */
  async incrementSignalCount(workItemId: string): Promise<void> {
    await queryWithRetry(
      `UPDATE work_items
       SET signal_count = signal_count + 1, updated_at = NOW()
       WHERE work_item_id = $1`,
      [workItemId]
    );
  }

  /**
   * Transition Work Item status using the State Machine.
   * Runs entirely inside a single transaction with SELECT FOR UPDATE to
   * prevent a concurrent transition from reading stale status between
   * our read and our write.
   */
  async transitionStatus(
    workItemId: string,
    nextStatus: WorkItemStatus
  ): Promise<WorkItem> {
    const updated = await withTransaction(async (client) => {
      const lockResult = await client.query<WorkItem>(
        `SELECT * FROM work_items WHERE work_item_id = $1 FOR UPDATE`,
        [workItemId]
      );

      const current = lockResult.rows[0];
      if (!current) {
        throw new Error(`Work item not found: ${workItemId}`);
      }

      WorkItemStateMachine.validateTransition(current.status, nextStatus);

      if (nextStatus === 'CLOSED') {
        const rcaResult = await client.query<RCARecord>(
          `SELECT * FROM rca_records WHERE work_item_id = $1`,
          [workItemId]
        );
        const rca = rcaResult.rows[0];
        if (!rca) {
          throw new Error(
            'Cannot close work item: RCA is missing. Submit an RCA before closing.'
          );
        }
        if (!rca.fix_applied?.trim() || !rca.prevention_steps?.trim()) {
          throw new Error(
            'Cannot close work item: RCA is incomplete. fix_applied and prevention_steps are required.'
          );
        }
      }

      const updateResult = await client.query<WorkItem>(
        `UPDATE work_items
         SET status = $1, updated_at = NOW()
         WHERE work_item_id = $2
         RETURNING *`,
        [nextStatus, workItemId]
      );

      return updateResult.rows[0];
    });

    // Invalidate AFTER commit — not inside the transaction.
    await this.invalidateDashboardCache();
    return updated;
  }

  /**
   * Submit RCA and calculate MTTR. Transactional.
   */
  async submitRca(
    workItemId: string,
    request: SubmitRCARequest
  ): Promise<RCARecord> {
    const workItem = await this.getWorkItemById(workItemId);
    if (!workItem) {
      throw new Error(`Work item not found: ${workItemId}`);
    }

    if (workItem.status === 'CLOSED') {
      throw new Error('Cannot submit RCA for a closed work item.');
    }

    const incidentStart = new Date(request.incident_start);
    const incidentEnd = new Date(request.incident_end);

    if (incidentEnd <= incidentStart) {
      throw new Error('incident_end must be after incident_start.');
    }

    // MTTR in minutes
    const mttrMinutes =
      (incidentEnd.getTime() - incidentStart.getTime()) / 60000;

    const rcaId = uuidv4();

    const rca = await withTransaction(async (client) => {
      // Upsert RCA (allow re-submission before closing)
      const result = await client.query<RCARecord>(
        `INSERT INTO rca_records
           (rca_id, work_item_id, incident_start, incident_end,
            root_cause_category, fix_applied, prevention_steps,
            mttr_minutes, submitted_by, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (work_item_id)
         DO UPDATE SET
           incident_start       = EXCLUDED.incident_start,
           incident_end         = EXCLUDED.incident_end,
           root_cause_category  = EXCLUDED.root_cause_category,
           fix_applied          = EXCLUDED.fix_applied,
           prevention_steps     = EXCLUDED.prevention_steps,
           mttr_minutes         = EXCLUDED.mttr_minutes,
           submitted_by         = EXCLUDED.submitted_by,
           submitted_at         = NOW()
         RETURNING *`,
        [
          rcaId,
          workItemId,
          incidentStart,
          incidentEnd,
          request.root_cause_category as RootCauseCategory,
          request.fix_applied,
          request.prevention_steps,
          mttrMinutes,
          request.submitted_by,
        ]
      );
      return result.rows[0];
    });

    await this.invalidateDashboardCache();
    return rca;
  }

  async getWorkItemById(workItemId: string): Promise<WorkItem | null> {
    const rows = await queryWithRetry<WorkItem>(
      `SELECT * FROM work_items WHERE work_item_id = $1`,
      [workItemId]
    );
    return rows[0] ?? null;
  }

  async getRcaForWorkItem(workItemId: string): Promise<RCARecord | null> {
    const rows = await queryWithRetry<RCARecord>(
      `SELECT * FROM rca_records WHERE work_item_id = $1`,
      [workItemId]
    );
    return rows[0] ?? null;
  }

  async listWorkItems(
    status?: WorkItemStatus,
    limit = 50,
    offset = 0
  ): Promise<WorkItem[]> {
    if (status) {
      return queryWithRetry<WorkItem>(
        `SELECT * FROM work_items WHERE status = $1
         ORDER BY
           CASE severity WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
           created_at DESC
         LIMIT $2 OFFSET $3`,
        [status, limit, offset]
      );
    }
    return queryWithRetry<WorkItem>(
      `SELECT * FROM work_items
       ORDER BY
         CASE severity WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
         created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  async getActiveIncidents(): Promise<WorkItem[]> {
    return queryWithRetry<WorkItem>(
      `SELECT * FROM work_items
       WHERE status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')
       ORDER BY
         CASE severity WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
         created_at DESC`,
      []
    );
  }

  private async invalidateDashboardCache(): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(CACHE_KEYS.DASHBOARD_STATE);
    } catch {
      // Non-fatal: cache miss will trigger a fresh DB read
    }
  }
}
