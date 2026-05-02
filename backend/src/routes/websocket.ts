import { FastifyInstance } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { DashboardService } from '../services/DashboardService';

const dashboardService = new DashboardService();

// Track connected raw WebSocket instances
const clients = new Set<SocketStream['socket']>();

export function broadcastDashboardUpdate(data: unknown): void {
  const message = JSON.stringify({ type: 'DASHBOARD_UPDATE', payload: data });
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(message);
    }
  }
}

export async function websocketRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/ws/dashboard',
    { websocket: true },
    (connection: SocketStream) => {
      const ws = connection.socket;
      clients.add(ws);
      console.log(`[WebSocket] Client connected. Total: ${clients.size}`);

      // Send current state immediately on connect
      dashboardService.getDashboardState().then((state) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'DASHBOARD_UPDATE', payload: state }));
        }
      }).catch((err: Error) => {
        console.error('[WebSocket] Failed to send initial state:', err.message);
      });

      ws.on('close', () => {
        clients.delete(ws);
        console.log(`[WebSocket] Client disconnected. Total: ${clients.size}`);
      });

      ws.on('error', (err: Error) => {
        console.error('[WebSocket] Error:', err.message);
        clients.delete(ws);
      });
    }
  );
}
