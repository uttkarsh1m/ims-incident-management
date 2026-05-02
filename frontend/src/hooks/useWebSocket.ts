import { useEffect, useRef, useState, useCallback } from 'react';
import { DashboardState } from '../types';

const WS_URL = `ws://${window.location.host}/ws/dashboard`;

export function useDashboardWebSocket() {
  const [dashboardState, setDashboardState] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected to dashboard feed');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          payload: DashboardState;
        };
        if (msg.type === 'DASHBOARD_UPDATE') {
          setDashboardState(msg.payload);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] Disconnected. Reconnecting in 3s...');
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { dashboardState, connected };
}
