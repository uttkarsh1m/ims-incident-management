import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { WorkItem, SignalSeverity } from '../types';
import { SeverityBadge } from './SeverityBadge';
import { StatusBadge } from './StatusBadge';
import { Clock, Radio, ChevronRight } from 'lucide-react';

interface Props {
  item: WorkItem;
}

const COMPONENT_ICONS: Record<string, string> = {
  RDBMS:       '🗄️',
  API:         '🌐',
  CACHE:       '⚡',
  MCP_HOST:    '🖥️',
  ASYNC_QUEUE: '📨',
  NOSQL:       '📦',
};

const SEVERITY_BORDER: Record<SignalSeverity, string> = {
  P0: 'border-l-red-500',
  P1: 'border-l-orange-400',
  P2: 'border-l-yellow-400',
  P3: 'border-l-blue-400',
};

const SEVERITY_BG: Record<SignalSeverity, string> = {
  P0: 'hover:bg-red-50',
  P1: 'hover:bg-orange-50',
  P2: 'hover:bg-yellow-50',
  P3: 'hover:bg-blue-50',
};

export const IncidentCard: React.FC<Props> = ({ item }) => {
  const navigate = useNavigate();
  const age = formatDistanceToNow(new Date(item.created_at), { addSuffix: true });

  return (
    <div
      onClick={() => navigate(`/incidents/${item.work_item_id}`)}
      className={`bg-white border border-gray-200 border-l-4 ${SEVERITY_BORDER[item.severity]} rounded-lg p-4 cursor-pointer transition-all duration-150 hover:shadow-md ${SEVERITY_BG[item.severity]} group`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/incidents/${item.work_item_id}`)}
      aria-label={`Incident ${item.component_id} - ${item.severity}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0" aria-hidden="true">
            {COMPONENT_ICONS[item.component_type] ?? '🔧'}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate text-sm leading-tight">
              {item.component_id}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{item.component_type}</p>
          </div>
        </div>
        <ChevronRight
          size={16}
          className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0 mt-0.5"
        />
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 mb-3">
        <SeverityBadge severity={item.severity} size="sm" />
        <StatusBadge status={item.status} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
        <span className="flex items-center gap-1">
          <Radio size={11} />
          {item.signal_count.toLocaleString()} signal{item.signal_count !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {age}
        </span>
      </div>
    </div>
  );
};
