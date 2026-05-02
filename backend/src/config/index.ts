import dotenv from 'dotenv';
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },
  postgres: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: process.env.POSTGRES_DB ?? 'ims_db',
    user: process.env.POSTGRES_USER ?? 'ims_user',
    password: process.env.POSTGRES_PASSWORD ?? 'ims_password',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017',
    database: process.env.MONGO_DB ?? 'ims_signals',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '10000', 10),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '1000', 10),
  },
  debounce: {
    windowMs: parseInt(process.env.DEBOUNCE_WINDOW_MS ?? '10000', 10),
  },
  metrics: {
    intervalMs: parseInt(process.env.METRICS_INTERVAL_MS ?? '5000', 10),
  },
  queue: {
    signalQueueName: 'signal-processing',
    workItemQueueName: 'work-item-processing',
    concurrency: 50,
  },
} as const;
