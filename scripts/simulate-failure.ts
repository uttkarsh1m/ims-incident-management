/**
 * IMS Failure Simulation Script
 *
 * Simulates a full cascading failure across the distributed stack:
 *   Phase 1: RDBMS Primary Failure (P0)
 *   Phase 2: MCP Host Failure (P1) — cascading from RDBMS
 *   Phase 3: Cache Cluster Degradation (P2)
 *   Phase 4: Async Queue Backup (P1)
 *   Phase 5: API Gateway Errors (P1)
 *   Phase 6: NoSQL Store Degradation (P2)
 *   Phase 7: Debounce test — 20 rapid signals → 1 Work Item
 *
 * Usage:
 *   npx ts-node --project tsconfig.json simulate-failure.ts
 *   npx ts-node --project tsconfig.json simulate-failure.ts --burst
 *   npx ts-node --project tsconfig.json simulate-failure.ts --url http://localhost:3001
 *   npx ts-node --project tsconfig.json simulate-failure.ts --phase 1
 */

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3001';

const BURST_MODE  = process.argv.includes('--burst');
const PHASE_ONLY  = process.argv.includes('--phase')
  ? parseInt(process.argv[process.argv.indexOf('--phase') + 1], 10)
  : null;

interface SignalPayload {
  component_id: string;
  component_type: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface ApiResponse {
  data?: { signal_id?: string; accepted?: number };
  error?: string;
}

async function sendSignal(payload: SignalPayload): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as ApiResponse;
  if (res.status === 202) {
    console.log(`  ✓ ${res.status} | ${payload.component_id} [${payload.severity}] | ${data.data?.signal_id?.slice(0, 8) ?? 'N/A'}`);
  } else {
    console.error(`  ✗ ${res.status} | ${payload.component_id} | ${data.error ?? 'unknown error'}`);
  }
}

async function sendBatch(payloads: SignalPayload[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/signals/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloads),
  });
  const data = await res.json() as ApiResponse;
  if (res.status === 202) {
    console.log(`  ✓ Batch ${res.status} | ${data.data?.accepted ?? 0} signals accepted`);
  } else {
    console.error(`  ✗ Batch ${res.status} | ${data.error ?? 'unknown error'}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRun(phase: number): boolean {
  return PHASE_ONLY === null || PHASE_ONLY === phase;
}

async function main(): Promise<void> {
  console.log('\n🚨 IMS Failure Simulation');
  console.log(`   Target : ${BASE_URL}`);
  console.log(`   Mode   : ${BURST_MODE ? 'BURST (10k signals)' : PHASE_ONLY ? `Phase ${PHASE_ONLY} only` : 'Full cascading scenario'}\n`);

  // ── Burst Mode ──────────────────────────────────────────────────────────────
  if (BURST_MODE) {
    console.log('📊 Burst test — sending 10,000 signals across 3 cache clusters...');
    const batchSize = 1000;
    const batches   = 10;
    for (let b = 0; b < batches; b++) {
      const payloads: SignalPayload[] = Array.from({ length: batchSize }, (_, i) => ({
        component_id:   `CACHE_CLUSTER_0${(i % 3) + 1}`,
        component_type: 'CACHE',
        severity:       i % 10 === 0 ? 'P0' : 'P2',
        message:        `Cache latency spike detected: ${(Math.random() * 500 + 100).toFixed(1)}ms`,
        metadata: {
          latency_ms: Math.random() * 500 + 100,
          batch:      b,
          index:      i,
        },
      }));
      await sendBatch(payloads);
      await sleep(100);
    }
    console.log('\n✅ Burst test complete');
    console.log(`   Expected: 3 work items, each with ~3,333 signals (debounced)\n`);
    return;
  }

  // ── Cascading Failure Scenario ───────────────────────────────────────────────

  // Phase 1: RDBMS Primary Failure (P0)
  if (shouldRun(1)) {
    console.log('📍 Phase 1: RDBMS Primary Failure (P0)');
    console.log('   Simulates: connection pool exhausted, primary DB unreachable');
    for (let i = 0; i < 5; i++) {
      await sendSignal({
        component_id:   'RDBMS_PRIMARY_01',
        component_type: 'RDBMS',
        severity:       'P0',
        message:        'Connection pool exhausted — primary database unreachable',
        metadata: {
          host:               'db-primary-01.internal',
          port:               5432,
          pool_size:          20,
          active_connections: 20,
          error_code:         'ECONNREFUSED',
          attempt:            i + 1,
        },
      });
      await sleep(500);
    }
    await sleep(1000);
  }

  // Phase 2: MCP Host Failure (P1)
  if (shouldRun(2)) {
    console.log('\n📍 Phase 2: MCP Host Failure (P1) — cascading from RDBMS');
    console.log('   Simulates: MCP host loses upstream DB dependency');
    for (let i = 0; i < 3; i++) {
      await sendSignal({
        component_id:   'MCP_HOST_CLUSTER_01',
        component_type: 'MCP_HOST',
        severity:       'P1',
        message:        'MCP Host health check failing — upstream RDBMS dependency unavailable',
        metadata: {
          host:                  'mcp-host-01.internal',
          upstream_dependency:   'RDBMS_PRIMARY_01',
          health_check_failures: i + 1,
          last_successful_check: new Date(Date.now() - 30000).toISOString(),
        },
      });
      await sleep(800);
    }
    await sleep(1000);
  }

  // Phase 3: Cache Degradation (P2)
  if (shouldRun(3)) {
    console.log('\n📍 Phase 3: Cache Cluster Degradation (P2)');
    console.log('   Simulates: read-through cache failing as DB is down');
    for (let i = 0; i < 8; i++) {
      await sendSignal({
        component_id:   'CACHE_CLUSTER_01',
        component_type: 'CACHE',
        severity:       'P2',
        message:        `Cache read-through failure — hit rate dropped to ${Math.max(10, 85 - i * 10)}%`,
        metadata: {
          cluster:          'redis-cluster-01',
          hit_rate:         Math.max(10, 85 - i * 10),
          eviction_rate:    i * 15,
          memory_usage_pct: 90 + i,
        },
      });
      await sleep(300);
    }
    await sleep(1000);
  }

  // Phase 4: Async Queue Backup (P1)
  if (shouldRun(4)) {
    console.log('\n📍 Phase 4: Async Queue Backup (P1)');
    console.log('   Simulates: consumers stalled, queue depth growing');
    for (let i = 0; i < 4; i++) {
      await sendSignal({
        component_id:   'ASYNC_QUEUE_MAIN',
        component_type: 'ASYNC_QUEUE',
        severity:       'P1',
        message:        `Message queue depth critical: ${(i + 1) * 50000} messages pending`,
        metadata: {
          queue_name:            'main-processing-queue',
          depth:                 (i + 1) * 50000,
          consumer_lag_seconds:  (i + 1) * 120,
          dead_letter_count:     i * 500,
        },
      });
      await sleep(600);
    }
    await sleep(1000);
  }

  // Phase 5: API Gateway Errors (P1)
  if (shouldRun(5)) {
    console.log('\n📍 Phase 5: API Gateway Errors (P1)');
    console.log('   Simulates: 5xx error rate climbing as backend services fail');
    for (let i = 0; i < 6; i++) {
      await sendSignal({
        component_id:   'API_GATEWAY_01',
        component_type: 'API',
        severity:       'P1',
        message:        `API error rate elevated: ${20 + i * 5}% of requests returning 5xx`,
        metadata: {
          endpoint:         '/api/v1/transactions',
          error_rate_pct:   20 + i * 5,
          p99_latency_ms:   5000 + i * 1000,
          requests_per_sec: 1200,
        },
      });
      await sleep(400);
    }
    await sleep(1000);
  }

  // Phase 6: NoSQL Store Degradation (P2)
  if (shouldRun(6)) {
    console.log('\n📍 Phase 6: NoSQL Store Degradation (P2)');
    console.log('   Simulates: MongoDB replica set election, writes temporarily unavailable');
    for (let i = 0; i < 3; i++) {
      await sendSignal({
        component_id:   'NOSQL_STORE_01',
        component_type: 'NOSQL',
        severity:       'P2',
        message:        'MongoDB replica set election in progress — writes temporarily unavailable',
        metadata: {
          replica_set:        'rs0',
          primary:            null,
          election_started_at: new Date(Date.now() - i * 5000).toISOString(),
          affected_collections: ['signals', 'events'],
        },
      });
      await sleep(700);
    }
    await sleep(1000);
  }

  // Phase 7: Debounce test
  if (shouldRun(7)) {
    console.log('\n📍 Phase 7: Debounce test — 20 rapid signals for RDBMS_PRIMARY_01');
    console.log('   Expected: all 20 signals link to the SAME work item (debounced)');
    const debouncePayloads: SignalPayload[] = Array.from({ length: 20 }, (_, i) => ({
      component_id:   'RDBMS_PRIMARY_01',
      component_type: 'RDBMS',
      severity:       'P0',
      message:        `Repeated connection failure #${i + 1}`,
      metadata:       { attempt: i + 1 },
    }));
    await sendBatch(debouncePayloads);
  }

  console.log('\n✅ Simulation complete!');
  console.log(`\n   Dashboard : http://localhost:3000`);
  console.log(`   Work items: ${BASE_URL}/api/work-items`);
  console.log(`   Health    : ${BASE_URL}/health\n`);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
