import React from 'react';
import { SignalSeverity } from '../types';

const SEVERITY_STYLES: Record<SignalSeverity, string> = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-yellow-400 text-black',
  P3: 'bg-blue-400 text-white',
};

const SEVERITY_LABELS: Record<SignalSeverity, string> = {
  P0: 'P0 · Critical',
  P1: 'P1 · High',
  P2: 'P2 · Medium',
  P3: 'P3 · Low',
};

interface Props {
  severity: SignalSeverity;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export const SeverityBadge: React.FC<Props> = ({ severity, size = 'md', showLabel = false }) => {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2.5 py-1';
  const label = showLabel ? SEVERITY_LABELS[severity] : severity;

  return (
    <span
      className={`inline-flex items-center font-bold rounded ${sizeClass} ${SEVERITY_STYLES[severity]}`}
    >
      {label}
    </span>
  );
};
