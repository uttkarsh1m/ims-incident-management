import { v4 as uuidv4 } from 'uuid';
import { checkDebounce, claimDebounceSlot, refreshDebounceIfUnchanged, incrementSignalCounter } from '../db/redis';
import { config } from '../config';
import { RawSignal, IngestSignalRequest } from '../types';

export class SignalService {
  /**
   * Persist a raw signal to MongoDB (Data Lake).
   * Uses upsert on signal_id so retries are idempotent — the same signal
   * is never written twice even if the job is retried by BullMQ.
   */
  async persistSignal(
    request: IngestSignalRequest,
    workItemId: string,
    signalId: string = uuidv4()
  ): Promise<RawSignal> {
    const signal: RawSignal = {
      signal_id: signalId,
      component_id: request.component_id,
      component_type: request.component_type,
      severity: request.severity,
      message: request.message,
      metadata: request.metadata ?? {},
      timestamp: new Date(),
      work_item_id: workItemId,
    };

    const { getSignalsCollection } = await import('../db/mongo');
    const collection = await getSignalsCollection();

    // Upsert by signal_id — safe to call multiple times on retry
    await collection.updateOne(
      { signal_id: signalId },
      { $setOnInsert: signal },
      { upsert: true }
    );

    await incrementSignalCounter();
    return signal;
  }

  /**
   * Patch the work_item_id on an already-persisted signal.
   * Called when a debounce loser needs to correct the id written in Step 1.
   */
  async updateSignalWorkItemId(signalId: string, workItemId: string): Promise<void> {
    const { getSignalsCollection } = await import('../db/mongo');
    const collection = await getSignalsCollection();
    await collection.updateOne(
      { signal_id: signalId },
      { $set: { work_item_id: workItemId } }
    );
  }

  /**
   * Check debounce window for a component.
   * Returns existing work_item_id if within window, null otherwise.
   */
  async checkDebounce(componentId: string): Promise<string | null> {
    return checkDebounce(componentId);
  }

  /**
   * Atomically claim the debounce slot for a component.
   * Uses Redis SET NX PX — race-condition safe.
   *
   * @returns true  → slot claimed, caller must create the Work Item
   *          false → slot already taken, caller must increment existing Work Item
   */
  async claimDebounceSlot(componentId: string, workItemId: string): Promise<boolean> {
    return claimDebounceSlot(componentId, workItemId, config.debounce.windowMs);
  }

  /**
   * Atomically refresh the debounce TTL only if the key still holds the
   * expected work_item_id. Returns the work_item_id on success, null if
   * the key rotated (new incident claimed the slot between our GET and PEXPIRE).
   */
  async refreshDebounceIfUnchanged(
    componentId: string,
    expectedWorkItemId: string
  ): Promise<string | null> {
    return refreshDebounceIfUnchanged(componentId, expectedWorkItemId, config.debounce.windowMs);
  }

  /**
   * Fetch raw signals for a work item from MongoDB.
   */
  async getSignalsForWorkItem(
    workItemId: string,
    limit = 100
  ): Promise<RawSignal[]> {
    const { getSignalsCollection } = await import('../db/mongo');
    const collection = await getSignalsCollection();
    return collection
      .find({ work_item_id: workItemId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Fetch recent signals across all components.
   */
  async getRecentSignals(limit = 200): Promise<RawSignal[]> {
    const { getSignalsCollection } = await import('../db/mongo');
    const collection = await getSignalsCollection();
    return collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }
}
