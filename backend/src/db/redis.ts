import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Cache keys for dashboard state
 */
export const CACHE_KEYS = {
  DASHBOARD_STATE: 'dashboard:state',
  DEBOUNCE_PREFIX: 'debounce:',
  METRICS_SIGNALS_COUNT: 'metrics:signals:count',
  METRICS_LAST_RESET: 'metrics:last_reset',
} as const;

/**
 * Check if a component is in debounce window.
 * Returns the existing work_item_id if debouncing, null otherwise.
 */
export async function checkDebounce(
  componentId: string
): Promise<string | null> {
  const redis = getRedisClient();
  const key = `${CACHE_KEYS.DEBOUNCE_PREFIX}${componentId}`;
  const workItemId = await redis.get(key);
  return workItemId;
}

/**
 * Atomically claim the debounce slot for a component using SET NX PX.
 *
 * @returns true if the slot was claimed (caller should create Work Item),
 *          false if already claimed (caller should increment existing Work Item)
 */
export async function claimDebounceSlot(
  componentId: string,
  workItemId: string,
  ttlMs: number
): Promise<boolean> {
  const redis = getRedisClient();
  const key = `${CACHE_KEYS.DEBOUNCE_PREFIX}${componentId}`;
  const result = await redis.set(key, workItemId, 'PX', ttlMs, 'NX');
  return result === 'OK';
}

/**
 * Atomically read the debounce key's value and refresh its TTL, but ONLY if
 * the value matches the expected work_item_id. This prevents extending the
 * TTL of a rotated key (new incident) when we intended to extend the old one.
 *
 * Uses a Lua script so GET + PEXPIRE happen atomically with a value guard.
 *
 * Scenario this fixes:
 *   T0: Worker reads existingId = "work-item-aaa"
 *   T1: Key expires
 *   T2: New winner sets key = "work-item-bbb" (new incident)
 *   T3: Worker calls PEXPIRE → would extend "work-item-bbb"'s TTL (wrong)
 *
 * With the Lua script:
 *   T3: GET key → "work-item-bbb" ≠ "work-item-aaa" → PEXPIRE skipped
 *       Returns null → caller knows the key rotated → moveToDelayed
 *
 * @returns the work_item_id if the key still holds the expected value and
 *          the TTL was refreshed, null if the key rotated or expired.
 */
export async function refreshDebounceIfUnchanged(
  componentId: string,
  expectedWorkItemId: string,
  ttlMs: number
): Promise<string | null> {
  const redis = getRedisClient();
  const key = `${CACHE_KEYS.DEBOUNCE_PREFIX}${componentId}`;

  // Lua script: GET key, if value == expected then PEXPIRE, return value
  const script = `
    local key = KEYS[1]
    local expected = ARGV[1]
    local ttl = ARGV[2]
    local current = redis.call('GET', key)
    if current == expected then
      redis.call('PEXPIRE', key, ttl)
      return current
    end
    return nil
  `;

  const result = await redis.eval(script, 1, key, expectedWorkItemId, ttlMs);
  return result as string | null;
}

/**
 * Alert slot states:
 *   "pending"   → claimAlertSlot won, alert is being attempted
 *   "delivered" → alert was successfully dispatched
 *
 * On retry:
 *   key missing  → no attempt yet, claim it
 *   "pending"    → previous attempt failed mid-flight, retry the alert
 *   "delivered"  → alert already sent successfully, skip
 */
const ALERT_PENDING   = 'pending'   as const;
const ALERT_DELIVERED = 'delivered' as const;

/**
 * How long the "pending" state is held.
 *
 * Must be:
 *   > total BullMQ retry budget (200 + 400 + 800ms = 1.4s)
 *   > alert dispatch timeout (25s)
 *   > realistic process crash + restart time (~10–15s)
 *
 * 30s satisfies all three. Do not lower below 26s (dispatch timeout + margin).
 */
const ALERT_PENDING_TTL_MS  = 30_000;

/**
 * How long the "delivered" state is held.
 * Long enough to cover all retry attempts after a successful dispatch.
 * 5 minutes is conservative — no retry will run this late.
 */
const ALERT_DELIVERED_TTL_MS = 5 * 60 * 1000;

/**
 * Attempt to claim the alert slot for a work item.
 *
 * Uses SET NX so only one worker can be in the "pending" state at a time.
 * If the key is already "delivered", returns false (skip).
 * If the key is "pending" (prior attempt failed and TTL expired),
 * SET NX succeeds and the alert is retried.
 *
 * @returns true  → slot claimed as "pending", caller must fire the alert
 *          false → already "delivered", caller must skip
 */
export async function claimAlertSlot(workItemId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `alert:sent:${workItemId}`;

  // Fast path: already delivered — no SET needed
  const current = await redis.get(key);
  if (current === ALERT_DELIVERED) return false;

  const result = await redis.set(key, ALERT_PENDING, 'PX', ALERT_PENDING_TTL_MS, 'NX');
  return result === 'OK';
}

/**
 * Promote the alert slot from "pending" to "delivered" after the alert
 * was successfully dispatched. This prevents retries from re-firing the alert.
 */
export async function confirmAlertDelivered(workItemId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.set(`alert:sent:${workItemId}`, ALERT_DELIVERED, 'PX', ALERT_DELIVERED_TTL_MS);
}
/**
 * Mark a job as fully processed (all side-effects complete).
 * Used to make the worker idempotent on BullMQ retries.
 * TTL is set to 2× the debounce window — long enough to cover all retry attempts.
 */
export async function markJobProcessed(signalId: string, ttlMs: number): Promise<void> {
  const redis = getRedisClient();
  await redis.set(`processed:${signalId}`, '1', 'PX', ttlMs * 2);
}

/**
 * Check if a job has already been fully processed.
 */
export async function isJobProcessed(signalId: string): Promise<boolean> {
  const redis = getRedisClient();
  const val = await redis.get(`processed:${signalId}`);
  return val === '1';
}

export async function incrementSignalCounter(): Promise<void> {
  const redis = getRedisClient();
  await redis.incr(CACHE_KEYS.METRICS_SIGNALS_COUNT);
}

/**
 * Get and reset signal counter for metrics calculation.
 */
export async function getAndResetSignalCounter(): Promise<number> {
  const redis = getRedisClient();
  const count = await redis.getdel(CACHE_KEYS.METRICS_SIGNALS_COUNT);
  return count ? parseInt(count, 10) : 0;
}
