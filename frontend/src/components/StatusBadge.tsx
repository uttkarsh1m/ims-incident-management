import React from 'react';
import { WorkItemStatus } from '../types';

const STATUS_CONFIG: Record<WorkItemStatus, { style: string; dot: string; label: string }> = {
  OPEN:          { style: 'bg-red-50 text-red-700 border border-red-200',       dot: 'bg-red-500',    label: 'Open' },
  INVESTIGATING: { style: 'bg-yellow-50 text-yellow-700 border border-yellow-200', dot: 'bg-yellow-500', label: 'Investigating' },
  RESOLVED:      { style: 'bg-green-50 text-green-700 border border-green-200', dot: 'bg-green-500',  label: 'Resolved' },
  CLOSED:        { style: 'bg-gray-100 text-gray-500 border border-gray-200',   dot: 'bg-gray-400',   label: 'Closed' },
};

interface Props {
  status: WorkItemStatus;
}

export const StatusBadge: React.FC<Props> = ({ status }) => {
  const { style, dot, label } = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
};
