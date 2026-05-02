import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config';
import { RawSignal } from '../types';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (!db) {
    client = new MongoClient(config.mongo.uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await client.connect();
    db = client.db(config.mongo.database);
    console.log('[MongoDB] Connected');
  }
  return db;
}

export async function getSignalsCollection(): Promise<Collection<RawSignal>> {
  const database = await getMongoDb();
  return database.collection<RawSignal>('signals');
}

export async function initMongo(): Promise<void> {
  const database = await getMongoDb();
  const signals = database.collection<RawSignal>('signals');

  // Create indexes for efficient querying
  await signals.createIndex({ signal_id: 1 }, { unique: true }); // idempotent upsert key
  await signals.createIndex({ component_id: 1, timestamp: -1 });
  await signals.createIndex({ work_item_id: 1 });
  await signals.createIndex({ timestamp: -1 });
  await signals.createIndex({ severity: 1, timestamp: -1 });

  console.log('[MongoDB] Indexes created');
}

/**
 * Insert a signal with retry logic for transient failures.
 */
export async function insertSignalWithRetry(
  signal: RawSignal,
  retries = 3,
  delayMs = 100
): Promise<void> {
  const collection = await getSignalsCollection();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await collection.insertOne(signal);
      return;
    } catch (err: unknown) {
      const isTransient =
        err instanceof Error &&
        (err.message.includes('ECONNREFUSED') ||
          err.message.includes('topology') ||
          err.message.includes('timeout'));

      if (attempt < retries && isTransient) {
        console.warn(
          `[MongoDB] Transient error on attempt ${attempt}/${retries}. Retrying in ${delayMs * attempt}ms...`
        );
        await sleep(delayMs * attempt);
      } else {
        throw err;
      }
    }
  }
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
