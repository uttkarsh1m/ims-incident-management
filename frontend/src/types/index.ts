export type ComponentType = 'API' | 'MCP_HOST' | 'CACHE' | 'ASYNC_QUEUE' | 'RDBMS' | 'NOSQL';
export type SignalSeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type WorkItemStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';
export type RootCauseCategory =
  | 'INFRASTRUCTURE'
  | 'APPLICATION_BUG'
  | 'CONFIGURATION'
  | 'DEPENDENCY_FAILURE'
  | 'CAPACITY'
  | 'SECURITY'
  | 'UNKNOWN';

export interface RawSignal {
  signal_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  message: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  work_item_id?: string;
}

export interface RCARecord {
  rca_id: string;
  work_item_id: string;
  incident_start: string;
  incident_end: string;
  root_cause_category: RootCauseCategory;
  fix_applied: string;
  prevention_steps: string;
  mttr_minutes: number;
  submitted_by: string;
  submitted_at: string;
}

export interface WorkItem {
  work_item_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  status: WorkItemStatus;
  signal_count: number;
  created_at: string;
  updated_at: string;
  rca?: RCARecord;
  allowed_transitions?: WorkItemStatus[];
}

export interface DashboardState {
  active_incidents: WorkItem[];
  total_open: number;
  total_investigating: number;
  total_resolved: number;
  signals_per_sec: number;
  last_updated: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
