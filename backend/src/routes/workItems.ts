import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkItemService } from '../services/WorkItemService';
import { WorkItemStateMachine } from '../patterns/state/WorkItemStateMachine';
import {
  ApiResponse,
  UpdateWorkItemStatusRequest,
  SubmitRCARequest,
  WorkItemStatus,
} from '../types';

const updateStatusSchema = z.object({
  status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']),
});

const submitRcaSchema = z.object({
  incident_start: z.string().datetime(),
  incident_end: z.string().datetime(),
  root_cause_category: z.enum([
    'INFRASTRUCTURE',
    'APPLICATION_BUG',
    'CONFIGURATION',
    'DEPENDENCY_FAILURE',
    'CAPACITY',
    'SECURITY',
    'UNKNOWN',
  ]),
  fix_applied: z.string().min(10, 'fix_applied must be at least 10 characters'),
  prevention_steps: z.string().min(10, 'prevention_steps must be at least 10 characters'),
  submitted_by: z.string().min(1),
});

const workItemService = new WorkItemService();

export async function workItemRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/work-items
   * List work items, optionally filtered by status.
   */
  fastify.get<{
    Querystring: { status?: WorkItemStatus; limit?: string; offset?: string };
  }>('/api/work-items', async (request, reply) => {
    const { status, limit, offset } = request.query;
    const items = await workItemService.listWorkItems(
      status,
      Math.min(parseInt(limit ?? '50', 10), 200),
      parseInt(offset ?? '0', 10)
    );
    return reply.send({ success: true, data: items } satisfies ApiResponse);
  });

  /**
   * GET /api/work-items/:id
   * Get a single work item with its RCA.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/work-items/:id',
    async (request, reply) => {
      const workItem = await workItemService.getWorkItemById(request.params.id);
      if (!workItem) {
        return reply.status(404).send({
          success: false,
          error: 'Work item not found',
        } satisfies ApiResponse);
      }

      const rca = await workItemService.getRcaForWorkItem(request.params.id);
      const allowedTransitions = WorkItemStateMachine.getAllowedTransitions(
        workItem.status
      );

      return reply.send({
        success: true,
        data: { ...workItem, rca, allowed_transitions: allowedTransitions },
      } satisfies ApiResponse);
    }
  );

  /**
   * PATCH /api/work-items/:id/status
   * Transition work item status (State Machine enforced).
   */
  fastify.patch<{
    Params: { id: string };
    Body: UpdateWorkItemStatusRequest;
  }>('/api/work-items/:id/status', async (request, reply) => {
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors.map((e) => e.message).join(', '),
      } satisfies ApiResponse);
    }

    try {
      const updated = await workItemService.transitionStatus(
        request.params.id,
        parsed.data.status
      );
      return reply.send({ success: true, data: updated } satisfies ApiResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 422;
      return reply.status(status).send({
        success: false,
        error: message,
      } satisfies ApiResponse);
    }
  });

  /**
   * POST /api/work-items/:id/rca
   * Submit or update RCA for a work item.
   */
  fastify.post<{
    Params: { id: string };
    Body: SubmitRCARequest;
  }>('/api/work-items/:id/rca', async (request, reply) => {
    const parsed = submitRcaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      } satisfies ApiResponse);
    }

    try {
      const rca = await workItemService.submitRca(
        request.params.id,
        parsed.data as SubmitRCARequest
      );
      return reply.status(201).send({ success: true, data: rca } satisfies ApiResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 422;
      return reply.status(status).send({
        success: false,
        error: message,
      } satisfies ApiResponse);
    }
  });

  /**
   * GET /api/work-items/:id/rca
   * Get RCA for a work item.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/work-items/:id/rca',
    async (request, reply) => {
      const rca = await workItemService.getRcaForWorkItem(request.params.id);
      if (!rca) {
        return reply.status(404).send({
          success: false,
          error: 'RCA not found for this work item',
        } satisfies ApiResponse);
      }
      return reply.send({ success: true, data: rca } satisfies ApiResponse);
    }
  );
}
