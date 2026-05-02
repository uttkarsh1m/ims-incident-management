import { Queue, Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { SignalJobData, WorkItemJobData } from '../types';
import { WorkItemService } from '../services/WorkItemService';
import { SignalService } from '../services/SignalService';
import { AlertContext } from '../patterns/alerting/AlertContext';
import { markJobProcessed, isJobProcessed, claimAlertSlot } from '../db/redis';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

// ─── Signal Queue (raw signal persistence) ────────────────────────────────────

let signalQueue: Queue<SignalJobData> | null = null;
let workItemQueue: Queue<WorkItemJobData> | null = null;

export function getSignalQueue(): Queue<SignalJobData> {
  if (!signalQueue) {
    signalQueue = new Queue<SignalJobData>(config.queue.signalQueueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 200,
          // Max cumulative backoff with 3 attempts: 200 + 400 + 800 = 1.4s
          // Must stay well under the debounce window (10s) so retries still
          // find the debounce key in Redis. Do not raise attempts above 6
          // or delay above 500 without also raising DEBOUNCE_WINDOW_MS.
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return signalQueue;
}
export function getWorkItemQueue(): Queue<WorkItemJobData> {
  if (!workItemQueue) {
    workItemQueue = new Queue<WorkItemJobData>(config.queue.workItemQueueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 300 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return workItemQueue;
}

// ─── Workers ──────────────────────────────────────────────────────────────────

const signalService = new SignalService();
const workItemService = new WorkItemService();

let signalWorker: Worker<SignalJobData> | null = null;
let workItemWorker: Worker<WorkItemJobData> | null = null;

export function startSignalWorker(): Worker<SignalJobData> {
  if (signalWorker) return signalWorker;

  signalWorker = new Worker<SignalJobData>(
    config.queue.signalQueueName,
    async (job: Job<SignalJobData>) => {
      const { signal } = job.data;

      // ── Idempotency gate ─────────────────────────────────────────────────
      // Skips the entire job if all side-effects already completed on a
      // prior attempt. Guards against double-alert and double Work Item creation.
      if (await isJobProcessed(signal.signal_id)) {
        return;
      }

      // ── Step 1: Persist raw signal to MongoDB FIRST ──────────────────────
      // Idempotent: $setOnInsert upsert on signal_id — safe on every retry.
      const candidateWorkItemId = uuidv4();
      signal.work_item_id = candidateWorkItemId;

      await signalService.persistSignal(
        {
          component_id: signal.component_id,
          component_type: signal.component_type,
          severity: signal.severity,
          message: signal.message,
          metadata: signal.metadata,
        },
        candidateWorkItemId,
        signal.signal_id
      );

      // ── Step 2: Atomically claim the debounce slot (SET NX PX) ───────────
      const claimed = await signalService.claimDebounceSlot(
        signal.component_id,
        candidateWorkItemId
      );

      let workItemId: string;

      if (claimed) {
        // ── Step 3a: Winner — create Work Item + register first signal ──
        // Both the work_items INSERT and signal_work_items INSERT happen in
        // one transaction, consistent with the loser path.
        const workItem = await workItemService.createWorkItem(
          signal.component_id,
          signal.component_type,
          signal.severity,
          candidateWorkItemId,
          signal.signal_id        // ← first signal registered atomically
        );
        workItemId = workItem.work_item_id;

        // ── Step 4a: Fire alert — at-least-once, loss-proof ────────────
        //
        // Three-state Redis key: missing → "pending" → "delivered"
        //
        // claimAlertSlot sets key = "pending" (NX, 5s TTL).
        // If the key is already "delivered", returns false → skip.
        // If the key is "pending" (prior attempt failed and TTL expired),
        // NX succeeds again → retry the alert.
        //
        // We await the alert here with a 4s timeout (under the 5s pending TTL).
        // On success: confirmAlertDelivered promotes key to "delivered" (long TTL).
        // On failure: key expires after 5s → next retry re-claims and re-fires.
        //
        // This closes the loss scenario:
        //   Before: claimAlertSlot → "1" (attempted) → executeAlert fails
        //           retry: key = "1" → skipped → alert permanently lost ✗
        //   After:  claimAlertSlot → "pending" → executeAlert fails
        //           key expires after 5s → retry re-claims → fires again ✓
        const alertSlotClaimed = await claimAlertSlot(workItemId);
        if (alertSlotClaimed) {
          try {
            // executeAlert dispatches the alert AND calls confirmAlertDelivered
            // internally (inside AlertContext) immediately after dispatch succeeds.
            // This minimises the crash window to microseconds — the gap between
            // the external system receiving the alert and the Redis SET.
            // That window is irreducible: exactly-once delivery to an external
            // webhook is not achievable (two-generals problem).
            // The pending key TTL (5s) ensures that if the process crashes in
            // that window, the key expires and the next retry re-fires.
            await Promise.race([
              AlertContext.executeAlert(signal.component_type, {
                work_item_id: workItemId,
                component_id: signal.component_id,
                component_type: signal.component_type,
                severity: signal.severity,
                message: signal.message,
                // BullMQ serializes Date to string in job data — convert back
                timestamp: new Date(signal.timestamp),
              }),
              new Promise<never>((_, reject) =>
                // Timeout at 25s — under the 30s pending TTL so the key
                // doesn't expire before confirmAlertDelivered can run.
                setTimeout(() => reject(new Error('Alert dispatch timeout')), 25_000)
              ),
            ]);
          } catch (err: unknown) {
            // Alert failed or timed out. pending key expires in ≤5s.
            // Next retry re-claims the slot and re-fires.
            console.error(
              `[Alert] Dispatch failed for ${signal.component_id} (will retry): ${(err as Error).message}`
            );
          }
        }
      } else {
        // ── Step 3b: Loser — read winner's id ────────────────────────────
        const existingId = await signalService.checkDebounce(signal.component_id);
        if (!existingId) {
          // The debounce key expired in the tiny window between claimDebounceSlot
          // returning false and this GET. Extremely rare (requires Redis eviction
          // or a >10s stall between the two Redis calls).
          // Move the job to delayed rather than failing it — this doesn't consume
          // a retry attempt and avoids noisy "job failed" log entries.
          await job.moveToDelayed(Date.now() + 100);
          return;
        }
        workItemId = existingId;

        // ── Refresh debounce TTL — atomic with value guard ───────────────
        // refreshDebounceIfUnchanged runs a Lua script:
        //   GET key → if value == existingId → PEXPIRE → return value
        //             if value ≠ existingId  → skip    → return nil
        //
        // This closes the race where the key expires and a new winner claims
        // it between our GET (existingId) and the PEXPIRE call:
        //
        //   T0: existingId = GET → "work-item-aaa"
        //   T1: key expires
        //   T2: new winner: SET NX → "work-item-bbb"
        //   T3: plain PEXPIRE → extends "work-item-bbb" (wrong incident)
        //       AND we'd increment "work-item-aaa" with this signal (wrong)
        //
        // With the Lua guard:
        //   T3: GET → "work-item-bbb" ≠ "work-item-aaa" → returns null
        //       → moveToDelayed: retry will re-enter as a fresh winner/loser
        const confirmedId = await signalService.refreshDebounceIfUnchanged(
          signal.component_id,
          existingId
        );
        if (!confirmedId) {
          // Key rotated between our GET and the Lua script — a new incident
          // has been created. Delay and retry so this signal is processed
          // against the correct (new) work item.
          await job.moveToDelayed(Date.now() + 100);
          return;
        }
        workItemId = confirmedId;

        // ── Step 4b: Record signal + increment atomically in Postgres ────
        // Retry up to 3 times with a short delay — under burst load the
        // winner's createWorkItem transaction may not have committed yet
        // when the loser tries to insert into signal_work_items (FK violation).
        let recorded = false;
        for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
          try {
            await workItemService.recordSignalAndIncrement(workItemId, signal.signal_id);
            recorded = true;
          } catch (err: unknown) {
            const isFk = err instanceof Error && err.message.includes('foreign key');
            if (isFk && attempt < 2) {
              await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
            } else {
              throw err;
            }
          }
        }
      }

      // ── Step 5: Patch signal's work_item_id if this worker was the loser ─
      // $set is idempotent — safe to run on every retry.
      if (workItemId !== candidateWorkItemId) {
        await signalService.updateSignalWorkItemId(signal.signal_id, workItemId);
      }

      // ── Step 6: Mark job fully processed ─────────────────────────────────
      // The idempotency gate at the top reads this key.
      // All steps above are now individually idempotent, so even if we crash
      // here and the gate never gets set, the retry is still correct.
      await markJobProcessed(signal.signal_id, config.debounce.windowMs);
    },
    {
      connection,
      concurrency: config.queue.concurrency,
    }
  );

  signalWorker.on('failed', (job: Job<SignalJobData> | undefined, err: Error) => {
    console.error(`[SignalWorker] Job ${job?.id} failed: ${err.message}`);
  });

  signalWorker.on('error', (err: Error) => {
    console.error(`[SignalWorker] Worker error: ${err.message}`);
  });

  console.log('[SignalWorker] Started with concurrency:', config.queue.concurrency);
  return signalWorker;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    signalWorker?.close(),
    workItemWorker?.close(),
    signalQueue?.close(),
    workItemQueue?.close(),
  ]);
}
