import React, { useEffect, useState } from 'react';
import { useDashboardWebSocket } from '../hooks/useWebSocket';
import { getDashboard } from '../api/client';
import { MetricsBar } from '../components/MetricsBar';
import { IncidentCard } from '../components/IncidentCard';
import { DashboardState, WorkItemStatus } from '../types';
import { RefreshCw, AlertTriangle, Search, CheckCircle, Layers } from 'lucide-react';

const STATUS_FILTERS: { label: string; value: WorkItemStatus | 'ALL' }[] = [
  { label: 'All Active', value: 'ALL' },
  { label: 'Open',          value: 'OPEN' },
  { label: 'Investigating', value: 'INVESTIGATING' },
  { label: 'Resolved',      value: 'RESOLVED' },
];

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bg: string;
  onClick: () => void;
  active: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, color, bg, onClick, active }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left w-full
      ${active
        ? `${bg} ${color} border-current shadow-sm`
        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:shadow-sm'
      }`}
  >
    <div className={`p-1.5 rounded-lg shrink-0 ${active ? 'bg-white bg-opacity-60' : 'bg-gray-50'}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-xs mt-0.5 opacity-75 font-medium truncate">{label}</p>
    </div>
  </button>
);

export const Dashboard: React.FC = () => {
  const { dashboardState: wsState, connected } = useDashboardWebSocket();
  const [fallbackState, setFallbackState] = useState<DashboardState | null>(null);
  const [filter, setFilter] = useState<WorkItemStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then((res) => { if (res.data) setFallbackState(res.data); })
      .finally(() => setLoading(false));
  }, []);

  const state = wsState ?? fallbackState;

  const filteredIncidents = state?.active_incidents.filter((item) =>
    filter === 'ALL' ? true : item.status === filter
  ) ?? [];

  if (loading && !state) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="animate-spin" size={28} />
          <p className="text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const total = (state?.total_open ?? 0) + (state?.total_investigating ?? 0) + (state?.total_resolved ?? 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {state && <MetricsBar state={state} connected={connected} />}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Active Incidents</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {state?.last_updated
                ? `Last updated ${new Date(state.last_updated).toLocaleTimeString()}`
                : 'Loading...'}
            </p>
          </div>
        </div>

        {/* Stat cards */}
        {state && (
          <div className="grid grid-cols-2 min-[320px]:grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <StatCard
              icon={<Layers size={15} className={filter === 'ALL' ? 'text-blue-600' : 'text-gray-400'} />}
              label="All Active"
              value={total}
              color="text-blue-700"
              bg="bg-blue-50"
              onClick={() => setFilter('ALL')}
              active={filter === 'ALL'}
            />
            <StatCard
              icon={<AlertTriangle size={15} className={filter === 'OPEN' ? 'text-red-600' : 'text-gray-400'} />}
              label="Open"
              value={state.total_open}
              color="text-red-700"
              bg="bg-red-50"
              onClick={() => setFilter('OPEN')}
              active={filter === 'OPEN'}
            />
            <StatCard
              icon={<Search size={15} className={filter === 'INVESTIGATING' ? 'text-yellow-600' : 'text-gray-400'} />}
              label="Investigating"
              value={state.total_investigating}
              color="text-yellow-700"
              bg="bg-yellow-50"
              onClick={() => setFilter('INVESTIGATING')}
              active={filter === 'INVESTIGATING'}
            />
            <StatCard
              icon={<CheckCircle size={15} className={filter === 'RESOLVED' ? 'text-green-600' : 'text-gray-400'} />}
              label="Resolved"
              value={state.total_resolved}
              color="text-green-700"
              bg="bg-green-50"
              onClick={() => setFilter('RESOLVED')}
              active={filter === 'RESOLVED'}
            />
          </div>
        )}

        {/* Filter label */}
        {filter !== 'ALL' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              Showing <span className="font-medium text-gray-700">{filter.toLowerCase()}</span> incidents
            </span>
            <button
              onClick={() => setFilter('ALL')}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Incident grid */}
        {filteredIncidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
              <CheckCircle size={28} className="text-green-400" />
            </div>
            <p className="text-base font-medium text-gray-600">No active incidents</p>
            <p className="text-sm mt-1">All systems operational</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filteredIncidents.map((item) => (
              <IncidentCard key={item.work_item_id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
