import React from 'react';
import { Activity, AlertTriangle, Search, CheckCircle, Wifi, WifiOff } from 'lucide-react';
import { DashboardState } from '../types';

interface Props {
  state: DashboardState;
  connected: boolean;
}

export const MetricsBar: React.FC<Props> = ({ state, connected }) => {
  const total = state.total_open + state.total_investigating + state.total_resolved;

  return (
    <div className="bg-gray-950 text-white px-3 py-0 flex items-stretch text-sm border-b border-gray-800">
      {/* Brand */}
      <div className="flex items-center gap-2 pr-3 border-r border-gray-800 py-3 shrink-0">
        <span className="text-yellow-400 text-base">⚡</span>
        <span className="font-bold tracking-tight text-white text-sm">IMS</span>
      </div>

      {/* Metrics — scroll horizontally on tiny screens */}
      <div className="flex items-center gap-0 flex-1 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1 px-3 py-3 border-r border-gray-800 shrink-0">
          <Activity size={12} className="text-blue-400" />
          <span className="font-mono text-blue-300 font-medium text-xs">{state.signals_per_sec}</span>
          <span className="text-gray-500 text-xs">sig/s</span>
        </div>
        <div className="flex items-center gap-1 px-3 py-3 border-r border-gray-800 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="font-semibold text-red-400 text-xs">{state.total_open}</span>
          <span className="text-gray-500 text-xs hidden xs:inline">Open</span>
        </div>
        <div className="flex items-center gap-1 px-3 py-3 border-r border-gray-800 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          <span className="font-semibold text-yellow-400 text-xs">{state.total_investigating}</span>
          <span className="text-gray-500 text-xs hidden sm:inline">Investigating</span>
        </div>
        <div className="flex items-center gap-1 px-3 py-3 border-r border-gray-800 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="font-semibold text-green-400 text-xs">{state.total_resolved}</span>
          <span className="text-gray-500 text-xs hidden sm:inline">Resolved</span>
        </div>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-1.5 pl-3 py-3 shrink-0">
        {connected ? (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-green-400 text-xs font-medium hidden xs:inline">Live</span>
          </>
        ) : (
          <>
            <WifiOff size={12} className="text-red-400 shrink-0" />
            <span className="text-red-400 text-xs hidden xs:inline">Reconnecting</span>
          </>
        )}
      </div>
    </div>
  );
};
