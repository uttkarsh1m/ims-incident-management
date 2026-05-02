# Prompts, Spec & Planning

This document captures the architectural decisions, design rationale, iterative bug fixes, and planning process used to build the IMS.

---

## Initial Analysis

**Assignment:** Build a Mission-Critical Incident Management System that:
- Ingests 10,000 signals/sec without crashing
- Debounces signals per component (10s window → 1 Work Item)
- Stores raw signals (NoSQL), structured Work Items (RDBMS), and dashboard state (Cache)
- Implements Strategy Pattern for alerting and State Pattern for lifecycle
- Provides a React dashboard with live feed, incident detail, and RCA form
- Mandatory RCA before CLOSED transition
- MTTR auto-calculation

---

## Tech Stack Decisions

### Why Fastify over Express?
- Fastify is 2-3x faster than Express for high-throughput scenarios
- Built-in schema validation, plugin system, and async-first design
- `@fastify/rate-limit` and `@fastify/websocket` are first-class plugins

### Why BullMQ over direct DB writes?
The core challenge: **10,000 signals/sec with a potentially slow persistence layer**.

Direct DB writes would block the ingestion API under load. BullMQ decouples ingestion from persistence:
1. Signal arrives → enqueued in Redis → HTTP 202 returned immediately (< 1ms)
2. Worker picks up job → writes to PostgreSQL + MongoDB asynchronously
3. If DB is slow, jobs queue up in Redis — ingestion never blocks

### Why Redis for debounce?
Redis `SET NX PX` is atomic. No race conditions when multiple workers check the same `component_id` simultaneously. The debounce key expires automatically after 10 seconds.

### Why PostgreSQL for Work Items?
Work Item transitions must be transactional (ACID). `SELECT FOR UPDATE` prevents concurrent status updates from reading stale state. The `rca_records` table has `UNIQUE(work_item_id)` to prevent duplicate RCAs.

### Why MongoDB for raw signals?
Raw signals are schema-flexible (metadata varies by component type), high-volume, and need to be queryable by `work_item_id`, `component_id`, and `timestamp`. MongoDB's compound indexes handle this efficiently. Unique index on `signal_id` enforces idempotency at the DB layer.

### Why a junction table (`signal_work_items`) instead of Redis SADD?
Initial design used Redis SADD as the idempotency guard for `incrementSignalCount`. This had a cross-system atomicity gap:
```
SADD ✓ (Redis committed)
DB crash → increment never ran
Retry: SADD → 0 → skipped → count permanently lost
```
The fix: move the idempotency ledger into Postgres. `INSERT INTO signal_work_items ON CONFLICT DO NOTHING` + conditional `UPDATE` in one transaction. If the transaction rolls back, neither the ledger row nor the counter change — the retry correctly inserts and increments.

---

## Design Pattern Rationale

### Strategy Pattern for Alerting
**Problem:** Different component types need different alert severity and escalation paths.
**Solution:** `AlertStrategy` interface with per-component implementations. `AlertContext` selects the strategy at runtime based on `component_type`. New component types can be added without modifying existing code (Open/Closed Principle).

```typescript
// Adding a new component type requires only:
class NewComponentAlertStrategy implements AlertStrategy { ... }
AlertContext.registerStrategy('NEW_COMPONENT', new NewComponentAlertStrategy());
```

`confirmAlertDelivered` is called inside `AlertContext.executeAlert` immediately after `strategy.alert()` resolves — not in the caller. This minimises the crash window to microseconds (the gap between the external system receiving the alert and the Redis SET).

### State Pattern for Work Item Lifecycle
**Problem:** Prevent illegal state transitions (e.g., OPEN → CLOSED, re-opening CLOSED items).
**Solution:** Each state class knows its valid successors. `WorkItemStateMachine.validateTransition()` throws on invalid transitions. The CLOSED state is terminal — `getAllowedTransitions()` returns `[]`.

`transitionStatus` uses `SELECT FOR UPDATE` inside a Postgres transaction. Client B blocks at the lock and reads the committed state after Client A commits — no stale-read races.

---

## Iterative Bug Fixes

These bugs were identified and fixed during development and testing.

### Bug 1 — Debounce race condition (duplicate Work Items)
**Problem:** With `concurrency: 50`, two workers could both call `checkDebounce` before either called `setDebounce`. Both see `null`, both create a Work Item.

**Fix:** Replaced `GET` + `SET` with atomic `SET NX PX`. Only one worker gets `'OK'` — the loser reads the winner's `work_item_id` from Redis and increments instead.

### Bug 2 — Signal lost if crash before persist
**Problem:** Worker created Work Item first, then persisted signal. A crash between them left the signal lost permanently.

**Fix:** Persist raw signal to MongoDB **first** (Step 1), before any Work Item logic. MongoDB write uses `$setOnInsert` upsert on `signal_id` — idempotent on retry.

### Bug 3 — BullMQ retry causes double-increment
**Problem:** `incrementSignalCount` is a `+1` counter. If the job retried after incrementing but before `markJobProcessed`, the count incremented twice.

**Fix:** Moved idempotency ledger to Postgres (`signal_work_items` junction table). `INSERT ON CONFLICT DO NOTHING` + conditional `UPDATE` in one transaction. A crash before COMMIT means neither committed — retry inserts and increments correctly.

### Bug 4 — SADD → DB atomicity gap
**Problem:** Redis SADD committed but DB increment crashed → count permanently lost. Retry: SADD returns 0 → increment skipped → count missed forever.

**Fix:** Eliminated Redis SADD entirely. Postgres junction table is the single source of truth for "has this signal been counted". Both the ledger row and the counter are in the same transaction.

### Bug 5 — Alert permanently lost
**Problem:** Binary Redis key (`"1"`) meant "attempted", but was treated as "delivered". If `executeAlert` failed, the key stayed `"1"` and retries skipped the alert forever.

**Fix:** Three-state Redis key: `missing → "pending" (30s TTL) → "delivered" (5min TTL)`. If dispatch fails, the pending key expires and the next retry re-claims and re-fires. `confirmAlertDelivered` is called inside `AlertContext` immediately after dispatch succeeds.

### Bug 6 — Alert TTL mismatch
**Problem:** `claimAlertSlot(workItemId, ttlMs)` accepted a `ttlMs` parameter but hardcoded `30_000` internally. The comment said "5s", the code said 30s, the caller passed 10s — three different values.

**Fix:** Removed the `ttlMs` parameter. TTLs are named constants: `ALERT_PENDING_TTL_MS = 30_000` and `ALERT_DELIVERED_TTL_MS = 5 * 60 * 1000` with documented constraints.

### Bug 7 — Cache invalidation inside transaction
**Problem:** `invalidateDashboardCache()` was called inside `withTransaction`. If the transaction rolled back, the cache was already evicted but the DB write never happened — unnecessary cache churn under load.

**Fix:** Moved `invalidateDashboardCache()` to after `withTransaction` resolves in all methods. Cache is only invalidated on successful commit.

### Bug 8 — Batch API missing per-item validation
**Problem:** Batch endpoint read `item.component_type`, `item.severity` etc. directly from raw body without Zod validation. Invalid items went straight into the queue.

**Fix:** Each item is now parsed through `ingestSchema.safeParse()`. All errors collected before rejection — response shows which index failed and why (e.g. `[1].severity: Invalid enum value`).

### Bug 9 — Debounce TTL not refreshed (sliding window)
**Problem:** `claimDebounceSlot` uses `SET NX PX` — sets the key once. Subsequent signals for the same component never extended the TTL. After 10s of continuous signals, the key expired and a second Work Item was created for the same ongoing incident.

**Fix:** Added `refreshDebounceIfUnchanged` — a Lua script that atomically does `GET → compare → PEXPIRE`. Called on every loser-path signal. The window slides forward as long as signals keep arriving.

### Bug 10 — PEXPIRE on wrong key after slot rotation
**Problem:** Between the loser's `GET` and `PEXPIRE`, the key could expire and a new winner could claim it. The loser would then extend the new incident's TTL and increment the old incident's count.

**Fix:** Lua script guards the refresh: `GET key → if value == expectedId → PEXPIRE → return value, else return nil`. If `nil` returned, the loser calls `moveToDelayed` and retries — the retry correctly processes against the new work item.

### Bug 11 — `transitionStatus` read-then-write outside transaction
**Problem:** `getWorkItemById` (SELECT) then `UPDATE` were separate queries. A concurrent transition could read the same status between them.

**Fix:** `transitionStatus` now uses `SELECT ... FOR UPDATE` inside `withTransaction`. The row lock blocks concurrent transitions until the first one commits.

### Bug 12 — `signal_count` inconsistency (winner path)
**Problem:** Winner path called `createWorkItem` then `recordFirstSignal` as two separate operations. A crash between them left the junction table missing the first signal's row.

**Fix:** `createWorkItem` now accepts `firstSignalId` and registers it inside the same transaction. Winner and loser paths are structurally identical — both use a single Postgres transaction.

### Bug 13 — Foreign key violation under burst load
**Problem:** Under high concurrency, the loser path tried to insert into `signal_work_items` with a `work_item_id` that the winner hadn't committed yet.

**Fix:** Added a 3-attempt retry loop with 50ms backoff specifically for FK violations in `recordSignalAndIncrement`.

### Bug 14 — Alert timestamp not a Date object
**Problem:** BullMQ serializes job data to JSON. `signal.timestamp` arrives in the worker as a string, but `strategy.alert()` called `.toISOString()` on it expecting a `Date`.

**Fix:** `new Date(signal.timestamp)` in the worker before passing to `executeAlert`.

### Bug 15 — WebSocket `socket.send is not a function`
**Problem:** `@fastify/websocket` v8 passes a `SocketStream` object, not a raw WebSocket. The route handler was calling `.send()` on the stream wrapper.

**Fix:** Access the raw WebSocket via `connection.socket`. Track `connection.socket` in the clients Set, not the `SocketStream`.

---

## Backpressure Strategy

```
Signal → Rate Limiter (10k/s) → BullMQ Queue → Worker → DB
                                     ↑
                              Redis buffer (durable)
                              Retry: 3x exponential backoff
                              Max backoff: 1.4s (< 10s debounce window)
```

If the DB goes down:
1. Workers fail → jobs retry with backoff
2. Queue depth grows in Redis (durable across restarts)
3. Ingestion API continues accepting signals (202 Accepted)
4. When DB recovers, workers drain the queue

Verified: `kill -9` on the backend process → restart → signals not lost (BullMQ persists jobs in Redis).

---

## Idempotency Mental Model

```
Layer          Role                          Mechanism
─────────────────────────────────────────────────────────────────
API / Queue    Avoid duplicate work          jobId = signal_id (BullMQ dedup)
Worker         Handle retries safely         isJobProcessed Redis gate
DB             Guarantee correctness         signal_work_items ON CONFLICT DO NOTHING
                                             MongoDB $setOnInsert on signal_id
                                             work_items ON CONFLICT DO UPDATE
```

If the queue and worker layers both fail, the DB layer still produces the correct result.

---

## MTTR Calculation

```
MTTR (minutes) = (incident_end - incident_start) / 60,000 ms
```

- `incident_start`: Set by the engineer in the RCA form (pre-filled from `work_item.created_at`)
- `incident_end`: Set by the engineer when the fix is confirmed
- Stored as `NUMERIC(10,2)` in PostgreSQL for precision
- Postgres returns NUMERIC as a string — frontend uses `parseFloat(String(mttr_minutes))` before calling `.toFixed()`

---

## Test Results

| Test | Description | Result |
|------|-------------|--------|
| Unit tests | 31 tests: state machine, RCA, idempotency, alert dedup | ✅ 31/31 |
| Health check | All three stores healthy | ✅ |
| State machine | OPEN → CLOSED blocked; OPEN → INVESTIGATING allowed | ✅ |
| Signal validation | Bad component_type and severity rejected with field errors | ✅ |
| Batch validation | Per-item errors with index (`[1].severity`) | ✅ |
| Debounce | 3,330 signals → 1 work item per cluster | ✅ |
| Burst test | 10,000 signals at 2,000 sig/s, no crash | ✅ |
| Crash recovery | kill -9 → restart → no signals lost | ✅ |
| Debounce expiry | 2 signals 12s apart → 2 separate work items | ✅ |
| Live feed | WebSocket updates dashboard within 5s of signal | ✅ |
| RCA guard | RESOLVED → CLOSED without RCA → error | ✅ |
| Full lifecycle | OPEN → INVESTIGATING → RESOLVED → RCA → CLOSED | ✅ |

---

## Functional Checklist

| Requirement | Implementation |
|-------------|---------------|
| 10k signals/sec | Rate limiter + BullMQ buffer — verified at 2,000 sig/s |
| No crash on slow DB | BullMQ decouples ingestion from persistence |
| Debounce (sliding 10s window) | Redis SET NX + Lua TTL refresh |
| Raw signal storage | MongoDB, unique index on signal_id |
| Work Item + RCA storage | PostgreSQL, ACID, SELECT FOR UPDATE |
| Signal count idempotency | signal_work_items junction table |
| Dashboard cache | Redis 10s TTL, invalidated post-commit |
| Strategy Pattern | AlertContext + 6 strategies, three-state alert dedup |
| State Pattern | WorkItemStateMachine + 4 states + FOR UPDATE |
| Mandatory RCA for CLOSE | Guard in transitionStatus() |
| MTTR calculation | Auto-computed on RCA submission |
| Async processing | BullMQ workers, concurrency 50 |
| Rate limiting | @fastify/rate-limit |
| Health endpoint | /health (checks all 3 stores) |
| Metrics (5s interval) | setInterval + Redis counter + WebSocket broadcast |
| Retry logic | Exponential backoff, all steps idempotent |
| No duplicate Work Items | SET NX race fix + ON CONFLICT DO UPDATE |
| No duplicate signal counts | Postgres junction table + ON CONFLICT DO NOTHING |
| No duplicate alerts | Three-state Redis key (pending/delivered) |
| Crash recovery | BullMQ Redis persistence, verified with kill -9 |
| Unit tests | 31 Jest tests |
| Batch validation | Per-item Zod with index-level error reporting |
| Live dashboard | WebSocket + React, auto-reconnect |
| RCA form | Datetime pickers, dropdown, textareas, MTTR display |
