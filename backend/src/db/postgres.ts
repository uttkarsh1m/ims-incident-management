import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      max: config.postgres.max,
      idleTimeoutMillis: config.postgres.idleTimeoutMillis,
      connectionTimeoutMillis: config.postgres.connectionTimeoutMillis,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Execute a query with automatic retry on transient failures.
 */
export async function queryWithRetry<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
  retries = 3,
  delayMs = 200
): Promise<T[]> {
  const db = getPool();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await db.query<T>(sql, params);
      return result.rows;
    } catch (err: unknown) {
      const isTransient =
        err instanceof Error &&
        (err.message.includes('connection') ||
          err.message.includes('timeout') ||
          err.message.includes('ECONNREFUSED'));

      if (attempt < retries && isTransient) {
        console.warn(
          `[PostgreSQL] Transient error on attempt ${attempt}/${retries}: ${(err as Error).message}. Retrying in ${delayMs}ms...`
        );
        await sleep(delayMs * attempt);
      } else {
        throw err;
      }
    }
  }
  throw new Error('[PostgreSQL] Max retries exceeded');
}

/**
 * Run multiple queries in a single transaction.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initPostgres(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      work_item_id   UUID PRIMARY KEY,
      component_id   VARCHAR(255) NOT NULL,
      component_type VARCHAR(50)  NOT NULL,
      severity       VARCHAR(10)  NOT NULL,
      status         VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
      signal_count   INTEGER      NOT NULL DEFAULT 1,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_work_items_status    ON work_items(status);
    CREATE INDEX IF NOT EXISTS idx_work_items_severity  ON work_items(severity);
    CREATE INDEX IF NOT EXISTS idx_work_items_component ON work_items(component_id);

    -- Junction table: one row per (signal, work_item) pair.
    -- INSERT ... ON CONFLICT DO NOTHING is the idempotency primitive for
    -- signal counting. If the row already exists the signal was already
    -- counted; if it's new we increment. Both happen in one transaction,
    -- so there is no cross-system atomicity gap between Redis and Postgres.
    CREATE TABLE IF NOT EXISTS signal_work_items (
      signal_id    VARCHAR(36)  NOT NULL,
      work_item_id UUID         NOT NULL REFERENCES work_items(work_item_id),
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (signal_id)
    );

    CREATE INDEX IF NOT EXISTS idx_swi_work_item ON signal_work_items(work_item_id);

    CREATE TABLE IF NOT EXISTS rca_records (
      rca_id               UUID PRIMARY KEY,
      work_item_id         UUID         NOT NULL REFERENCES work_items(work_item_id),
      incident_start       TIMESTAMPTZ  NOT NULL,
      incident_end         TIMESTAMPTZ  NOT NULL,
      root_cause_category  VARCHAR(50)  NOT NULL,
      fix_applied          TEXT         NOT NULL,
      prevention_steps     TEXT         NOT NULL,
      mttr_minutes         NUMERIC(10,2) NOT NULL,
      submitted_by         VARCHAR(255) NOT NULL,
      submitted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_rca_work_item UNIQUE (work_item_id)
    );
  `);
  console.log('[PostgreSQL] Schema initialized');
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
