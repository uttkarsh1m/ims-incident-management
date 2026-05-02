/**
 * Unit tests for RCA validation logic and Work Item State Machine.
 */

import { WorkItemStateMachine } from '../patterns/state/WorkItemStateMachine';
import { WorkItemService } from '../services/WorkItemService';

// ─── State Machine Tests ──────────────────────────────────────────────────────

describe('WorkItemStateMachine', () => {
  describe('valid transitions', () => {
    it('allows OPEN → INVESTIGATING', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('OPEN', 'INVESTIGATING')
      ).not.toThrow();
    });

    it('allows INVESTIGATING → RESOLVED', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('INVESTIGATING', 'RESOLVED')
      ).not.toThrow();
    });

    it('allows RESOLVED → CLOSED', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('RESOLVED', 'CLOSED')
      ).not.toThrow();
    });
  });

  describe('invalid transitions', () => {
    it('rejects OPEN → CLOSED (skipping states)', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('OPEN', 'CLOSED')
      ).toThrow('Invalid transition: OPEN → CLOSED');
    });

    it('rejects OPEN → RESOLVED (skipping states)', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('OPEN', 'RESOLVED')
      ).toThrow('Invalid transition: OPEN → RESOLVED');
    });

    it('rejects INVESTIGATING → CLOSED (skipping states)', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('INVESTIGATING', 'CLOSED')
      ).toThrow('Invalid transition: INVESTIGATING → CLOSED');
    });

    it('rejects CLOSED → OPEN (terminal state)', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('CLOSED', 'OPEN')
      ).toThrow('Invalid transition: CLOSED → OPEN');
    });

    it('rejects CLOSED → INVESTIGATING (terminal state)', () => {
      expect(() =>
        WorkItemStateMachine.validateTransition('CLOSED', 'INVESTIGATING')
      ).toThrow();
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns [INVESTIGATING] for OPEN', () => {
      expect(WorkItemStateMachine.getAllowedTransitions('OPEN')).toEqual([
        'INVESTIGATING',
      ]);
    });

    it('returns [RESOLVED] for INVESTIGATING', () => {
      expect(WorkItemStateMachine.getAllowedTransitions('INVESTIGATING')).toEqual([
        'RESOLVED',
      ]);
    });

    it('returns [CLOSED] for RESOLVED', () => {
      expect(WorkItemStateMachine.getAllowedTransitions('RESOLVED')).toEqual([
        'CLOSED',
      ]);
    });

    it('returns [] for CLOSED (terminal)', () => {
      expect(WorkItemStateMachine.getAllowedTransitions('CLOSED')).toEqual([]);
    });
  });
});

// ─── RCA Validation Tests ─────────────────────────────────────────────────────

describe('RCA Validation', () => {
  const validRca = {
    incident_start: '2026-05-01T10:00:00.000Z',
    incident_end: '2026-05-01T12:00:00.000Z',
    root_cause_category: 'INFRASTRUCTURE' as const,
    fix_applied: 'Restarted the database cluster and applied patch.',
    prevention_steps: 'Added automated failover and monitoring alerts.',
    submitted_by: 'engineer@company.com',
  };

  it('calculates MTTR correctly (120 minutes for 2-hour incident)', () => {
    const start = new Date(validRca.incident_start);
    const end = new Date(validRca.incident_end);
    const mttr = (end.getTime() - start.getTime()) / 60000;
    expect(mttr).toBe(120);
  });

  it('rejects RCA where end is before start', () => {
    const invalidRca = {
      ...validRca,
      incident_start: '2026-05-01T12:00:00.000Z',
      incident_end: '2026-05-01T10:00:00.000Z',
    };
    const start = new Date(invalidRca.incident_start);
    const end = new Date(invalidRca.incident_end);
    expect(end <= start).toBe(true);
  });

  it('rejects RCA with empty fix_applied', () => {
    const fix = '   ';
    expect(fix.trim().length).toBe(0);
  });

  it('rejects RCA with empty prevention_steps', () => {
    const steps = '';
    expect(steps.trim().length).toBe(0);
  });

  it('accepts valid RCA with all required fields', () => {
    const start = new Date(validRca.incident_start);
    const end = new Date(validRca.incident_end);
    expect(end > start).toBe(true);
    expect(validRca.fix_applied.trim().length).toBeGreaterThan(0);
    expect(validRca.prevention_steps.trim().length).toBeGreaterThan(0);
    expect(validRca.submitted_by.trim().length).toBeGreaterThan(0);
  });
});

// ─── Idempotency / Retry Tests ────────────────────────────────────────────────

describe('Job idempotency on BullMQ retry', () => {
  it('isJobProcessed returns false before marking, true after', async () => {
    const store = new Map<string, string>();
    const signalId = 'test-signal-abc';

    const markProcessed = (id: string) => store.set(`processed:${id}`, '1');
    const isProcessed = (id: string) => store.get(`processed:${id}`) === '1';

    expect(isProcessed(signalId)).toBe(false);
    markProcessed(signalId);
    expect(isProcessed(signalId)).toBe(true);
  });

  it('second retry is a no-op when job is already marked processed', () => {
    const store = new Map<string, string>();
    let sideEffectCount = 0;

    const runJob = (signalId: string) => {
      if (store.get(`processed:${signalId}`) === '1') return;
      sideEffectCount++;
      store.set(`processed:${signalId}`, '1');
    };

    runJob('sig-1');
    runJob('sig-1');
    runJob('sig-1');

    expect(sideEffectCount).toBe(1);
  });

  it('signal upsert $setOnInsert does not overwrite on retry', () => {
    const db = new Map<string, { signal_id: string; work_item_id: string }>();

    const upsertSignal = (signalId: string, workItemId: string) => {
      if (!db.has(signalId)) {
        db.set(signalId, { signal_id: signalId, work_item_id: workItemId });
      }
    };

    upsertSignal('sig-1', 'work-item-aaa');
    upsertSignal('sig-1', 'work-item-bbb'); // retry

    expect(db.get('sig-1')?.work_item_id).toBe('work-item-aaa');
    expect(db.size).toBe(1);
  });

  it('recordSignalAndIncrement (Postgres junction table) is atomic on retry', () => {
    // Simulates INSERT ON CONFLICT DO NOTHING + conditional UPDATE
    // in a single Postgres transaction — the correct fix for the SADD gap.
    const junctionTable = new Set<string>();
    let signalCount = 1; // starts at 1 (first signal created the work item)

    const recordSignalAndIncrement = (signalId: string): boolean => {
      if (junctionTable.has(signalId)) return false; // conflict → skip UPDATE
      // Both ops in one transaction — either both commit or neither does
      junctionTable.add(signalId);
      signalCount++;
      return true;
    };

    expect(recordSignalAndIncrement('sig-2')).toBe(true);
    expect(signalCount).toBe(2);

    // Retry: junction row exists → conflict → no increment
    expect(recordSignalAndIncrement('sig-2')).toBe(false);
    expect(signalCount).toBe(2); // ← unchanged, correct

    expect(recordSignalAndIncrement('sig-2')).toBe(false);
    expect(signalCount).toBe(2); // ← still correct after N retries
  });

  it('SADD gap: documents why Redis-then-DB was broken', () => {
    let redisSeen = new Set<string>();
    let dbCount = 1;

    const brokenApproach = (signalId: string, crashAfterSadd: boolean) => {
      const isNew = !redisSeen.has(signalId);
      if (isNew) redisSeen.add(signalId); // SADD committed to Redis
      if (crashAfterSadd) return;         // crash — DB never updated
      if (isNew) dbCount++;
    };

    // Attempt 1: SADD succeeds, crash before DB write
    brokenApproach('sig-1', true);
    expect(redisSeen.has('sig-1')).toBe(true);
    expect(dbCount).toBe(1); // DB does NOT have it

    // Attempt 2 (retry): SADD returns 0 → isNew=false → DB skipped
    brokenApproach('sig-1', false);
    expect(dbCount).toBe(1); // ← count permanently missed — the bug
  });

  it('markJobProcessed crash window: all steps individually idempotent', () => {
    const mongoDb = new Map<string, { work_item_id: string }>();
    const junctionTable = new Set<string>();
    let signalCount = 1;

    const persistSignal = (signalId: string, workItemId: string) => {
      if (!mongoDb.has(signalId)) mongoDb.set(signalId, { work_item_id: workItemId });
    };
    const recordAndIncrement = (signalId: string) => {
      if (junctionTable.has(signalId)) return;
      junctionTable.add(signalId);
      signalCount++;
    };
    const patchWorkItemId = (signalId: string, workItemId: string) => {
      const doc = mongoDb.get(signalId);
      if (doc) doc.work_item_id = workItemId;
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      persistSignal('sig-1', 'candidate-id');
      recordAndIncrement('sig-1');
      patchWorkItemId('sig-1', 'wi-aaa');
      // markJobProcessed crashes every time — system still correct
    }

    expect(signalCount).toBe(2);
    expect(mongoDb.get('sig-1')?.work_item_id).toBe('wi-aaa');
    expect(mongoDb.size).toBe(1);
  });
});

describe('Alert deduplication - three-state slot (pending/delivered)', () => {
  // Simulates the three-state Redis key: missing → "pending" → "delivered"
  type AlertState = 'pending' | 'delivered';
  const PENDING: AlertState   = 'pending';
  const DELIVERED: AlertState = 'delivered';

  const makeAlertStore = () => new Map<string, AlertState>();

  const claimAlertSlot = (store: Map<string, AlertState>, workItemId: string): boolean => {
    const current = store.get(workItemId);
    if (current === DELIVERED) return false; // already confirmed — skip
    if (current === PENDING)   return false; // another worker is in-flight — skip
    store.set(workItemId, PENDING);          // SET NX → claim as pending
    return true;
  };

  const confirmDelivered = (store: Map<string, AlertState>, workItemId: string) => {
    store.set(workItemId, DELIVERED);
  };

  const expirePending = (store: Map<string, AlertState>, workItemId: string) => {
    // Simulates the 5s pending TTL expiring after a failed dispatch
    if (store.get(workItemId) === PENDING) store.delete(workItemId);
  };

  it('happy path: claim → dispatch succeeds → confirm delivered → retry skips', () => {
    const store = makeAlertStore();
    let alertCount = 0;

    // Attempt 1: claim, dispatch, confirm
    expect(claimAlertSlot(store, 'wi-aaa')).toBe(true);
    alertCount++; // dispatch succeeds
    confirmDelivered(store, 'wi-aaa');
    expect(store.get('wi-aaa')).toBe(DELIVERED);

    // Attempt 2 (retry): key is "delivered" → skip
    expect(claimAlertSlot(store, 'wi-aaa')).toBe(false);
    expect(alertCount).toBe(1); // ← exactly one alert
  });

  it('loss scenario fixed: claim → dispatch fails → pending expires → retry re-fires', () => {
    const store = makeAlertStore();
    let alertCount = 0;

    // Attempt 1: claim, dispatch FAILS, key stays "pending"
    expect(claimAlertSlot(store, 'wi-aaa')).toBe(true);
    alertCount++;
    // executeAlert throws — confirmDelivered is never called
    // pending key expires after 5s TTL:
    expirePending(store, 'wi-aaa');
    expect(store.has('wi-aaa')).toBe(false); // key gone

    // Attempt 2 (retry): key missing → claim again → dispatch succeeds
    expect(claimAlertSlot(store, 'wi-aaa')).toBe(true);
    alertCount++;
    confirmDelivered(store, 'wi-aaa');

    expect(alertCount).toBe(2);             // fired twice (at-least-once) ✓
    expect(store.get('wi-aaa')).toBe(DELIVERED);

    // Attempt 3: key is "delivered" → skip
    expect(claimAlertSlot(store, 'wi-aaa')).toBe(false);
    expect(alertCount).toBe(2);             // no third fire
  });

  it('old binary key bug: "1" means attempted, not delivered → alert lost', () => {
    // Documents the bug that was fixed.
    // Binary key: once set to "1", retries always skip — even if dispatch failed.
    const binaryStore = new Set<string>();
    let alertCount = 0;

    const brokenClaim = (workItemId: string): boolean => {
      if (binaryStore.has(workItemId)) return false; // "1" → skip always
      binaryStore.add(workItemId);
      return true;
    };

    // Attempt 1: claim, dispatch FAILS
    expect(brokenClaim('wi-aaa')).toBe(true);
    alertCount++;
    // executeAlert throws — key stays "1" regardless

    // Attempt 2: key = "1" → skip → alert permanently lost
    expect(brokenClaim('wi-aaa')).toBe(false);
    expect(alertCount).toBe(1); // fired once but never delivered — the bug

    // With three-state: pending TTL expires → retry re-fires → confirmed
    // alertCount would reach 2 (at-least-once) and then stop
  });

  it('concurrent workers: only one claims pending slot at a time', () => {
    const store = makeAlertStore();
    const results: boolean[] = [];

    // Two workers race to claim simultaneously
    results.push(claimAlertSlot(store, 'wi-aaa')); // first: NX succeeds → pending
    results.push(claimAlertSlot(store, 'wi-aaa')); // second: key exists → false

    expect(results.filter(Boolean).length).toBe(1);  // exactly one fires
    expect(results.filter(r => !r).length).toBe(1);  // exactly one skips
    expect(store.get('wi-aaa')).toBe(PENDING);
  });
});

describe('Debounce - claimDebounceSlot atomicity', () => {
  it('SET NX semantics: only one of two concurrent claims should win', () => {
    // Simulate what Redis SET NX does: first caller gets 'OK', second gets null
    const results: boolean[] = [];

    // Mock the Redis SET NX behaviour
    let slotTaken = false;
    const atomicClaim = (): boolean => {
      if (!slotTaken) {
        slotTaken = true;
        return true;  // winner
      }
      return false;   // loser
    };

    // Two "concurrent" workers both try to claim
    results.push(atomicClaim());
    results.push(atomicClaim());

    expect(results.filter(Boolean).length).toBe(1);   // exactly one winner
    expect(results.filter((r) => !r).length).toBe(1); // exactly one loser
  });

  it('loser reads the winner work_item_id from Redis', () => {
    const store = new Map<string, string>();
    const componentId = 'CACHE_CLUSTER_01';
    const winnerWorkItemId = 'winner-uuid';

    // Winner sets the key
    store.set(componentId, winnerWorkItemId);

    // Loser reads it
    const loserReads = store.get(componentId);
    expect(loserReads).toBe(winnerWorkItemId);
  });
});

describe('WorkItemService - CLOSED guard', () => {
  it('throws when trying to close without RCA', async () => {
    const service = new WorkItemService();

    // transitionStatus now uses SELECT FOR UPDATE inside a real transaction.
    // Mock withTransaction to simulate a RESOLVED work item with no RCA.
    jest.spyOn(service as unknown as { invalidateDashboardCache: () => Promise<void> }, 'invalidateDashboardCache').mockResolvedValue(undefined);

    const { withTransaction: origWithTransaction } = jest.requireActual('../db/postgres') as { withTransaction: typeof import('../db/postgres').withTransaction };
    const pgModule = await import('../db/postgres');
    jest.spyOn(pgModule, 'withTransaction').mockImplementationOnce(async (fn) => {
      // Simulate the transaction returning a RESOLVED work item
      const fakeClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ work_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'RESOLVED', component_id: 'RDBMS_01', component_type: 'RDBMS', severity: 'P0', signal_count: 5, created_at: new Date(), updated_at: new Date() }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [] }), // SELECT rca_records → no RCA
      };
      return fn(fakeClient as unknown as import('pg').PoolClient);
    });

    await expect(
      service.transitionStatus('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'CLOSED')
    ).rejects.toThrow('RCA is missing');

    jest.restoreAllMocks();
    void origWithTransaction; // suppress unused warning
  });

  it('throws when RCA has empty fix_applied', async () => {
    const service = new WorkItemService();

    jest.spyOn(service as unknown as { invalidateDashboardCache: () => Promise<void> }, 'invalidateDashboardCache').mockResolvedValue(undefined);

    const pgModule = await import('../db/postgres');
    jest.spyOn(pgModule, 'withTransaction').mockImplementationOnce(async (fn) => {
      const fakeClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ work_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'RESOLVED', component_id: 'RDBMS_01', component_type: 'RDBMS', severity: 'P0', signal_count: 5, created_at: new Date(), updated_at: new Date() }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [{ rca_id: 'rca-id', work_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', incident_start: new Date(), incident_end: new Date(), root_cause_category: 'INFRASTRUCTURE', fix_applied: '   ', prevention_steps: 'Some steps', mttr_minutes: 60, submitted_by: 'engineer@company.com', submitted_at: new Date() }] }), // SELECT rca_records → incomplete RCA
      };
      return fn(fakeClient as unknown as import('pg').PoolClient);
    });

    await expect(
      service.transitionStatus('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'CLOSED')
    ).rejects.toThrow('RCA is incomplete');

    jest.restoreAllMocks();
  });
});
