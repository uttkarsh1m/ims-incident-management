import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getSignalQueue } from '../queue/SignalQueue';
import { SignalService } from '../services/SignalService';
import { ApiResponse, IngestSignalRequest, RawSignal } from '../types';

const ingestSchema = z.object({
  component_id: z.string().min(1).max(255),
  component_type: z.enum(['API', 'MCP_HOST', 'CACHE', 'ASYNC_QUEUE', 'RDBMS', 'NOSQL']),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  message: z.string().min(1).max(2000),
  metadata: z.record(z.unknown()).optional(),
});

const signalService = new SignalService();

export async function signalRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/signals
   * High-throughput signal ingestion endpoint.
   * Signals are enqueued immediately — no blocking on DB writes.
   */
  fastify.post<{ Body: IngestSignalRequest }>(
    '/api/signals',
    async (
      request: FastifyRequest<{ Body: IngestSignalRequest }>,
      reply: FastifyReply
    ) => {
      const parsed = ingestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          message: parsed.error.errors.map((e: { message: string }) => e.message).join(', '),
        } satisfies ApiResponse);
      }

      const signal: RawSignal = {
        signal_id: uuidv4(),
        component_id: parsed.data.component_id,
        component_type: parsed.data.component_type,
        severity: parsed.data.severity,
        message: parsed.data.message,
        metadata: parsed.data.metadata ?? {},
        timestamp: new Date(),
      };

      // Enqueue for async processing — jobId = signal_id makes this idempotent.
      // BullMQ will silently drop a duplicate enqueue for the same jobId,
      // so a client retrying the HTTP call never double-processes a signal.
      const queue = getSignalQueue();
      await queue.add(
        'process-signal',
        { signal },
        {
          jobId: signal.signal_id,          // ← idempotency key
          priority: getPriority(signal.severity),
        }
      );

      return reply.status(202).send({
        success: true,
        data: { signal_id: signal.signal_id },
        message: 'Signal accepted for processing',
      } satisfies ApiResponse);
    }
  );

  /**
   * POST /api/signals/batch
   * Batch ingestion for high-throughput scenarios.
   * Each item is validated with the same schema as the single endpoint.
   */
  fastify.post<{ Body: unknown[] }>(
    '/api/signals/batch',
    async (
      request: FastifyRequest<{ Body: unknown[] }>,
      reply: FastifyReply
    ) => {
      const body = request.body;
      if (!Array.isArray(body) || body.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Body must be a non-empty array of signals',
        } satisfies ApiResponse);
      }

      if (body.length > 1000) {
        return reply.status(400).send({
          success: false,
          error: 'Batch size cannot exceed 1000 signals',
        } satisfies ApiResponse);
      }

      // Validate every item — collect all errors before rejecting
      const errors: string[] = [];
      const validItems: IngestSignalRequest[] = [];

      for (let i = 0; i < body.length; i++) {
        const parsed = ingestSchema.safeParse(body[i]);
        if (!parsed.success) {
          const messages = parsed.error.errors
            .map((e: { path: (string | number)[]; message: string }) =>
              `[${i}].${e.path.join('.')}: ${e.message}`
            )
            .join('; ');
          errors.push(messages);
        } else {
          validItems.push(parsed.data);
        }
      }

      if (errors.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed for one or more signals',
          message: errors.join(' | '),
        } satisfies ApiResponse);
      }

      const queue = getSignalQueue();
      const jobs = validItems.map((item) => {
        const signal: RawSignal = {
          signal_id: uuidv4(),
          component_id: item.component_id,
          component_type: item.component_type,
          severity: item.severity,
          message: item.message,
          metadata: item.metadata ?? {},
          timestamp: new Date(),
        };
        return {
          name: 'process-signal',
          data: { signal },
          opts: {
            jobId: signal.signal_id,
            priority: getPriority(signal.severity),
          },
        };
      });

      await queue.addBulk(jobs);

      return reply.status(202).send({
        success: true,
        data: { accepted: jobs.length },
        message: `${jobs.length} signals accepted for processing`,
      } satisfies ApiResponse);
    }
  );

  /**
   * GET /api/signals/:workItemId
   * Fetch raw signals for a work item from MongoDB.
   */
  fastify.get<{ Params: { workItemId: string }; Querystring: { limit?: string } }>(
    '/api/signals/:workItemId',
    async (
      request: FastifyRequest<{ Params: { workItemId: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { workItemId } = request.params;
      const limit = Math.min(parseInt(request.query.limit ?? '100', 10), 500);

      const signals = await signalService.getSignalsForWorkItem(workItemId, limit);
      return reply.send({
        success: true,
        data: signals,
      } satisfies ApiResponse);
    }
  );
}

function getPriority(severity: string): number {
  switch (severity) {
    case 'P0': return 1;
    case 'P1': return 2;
    case 'P2': return 3;
    default:   return 4;
  }
}
