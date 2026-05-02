// ─── Signal Types ────────────────────────────────────────────────────────────

export type ComponentType =
  | 'API'
  | 'MCP_HOST'
  | 'CACHE'
  | 'ASYNC_QUEUE'
  | 'RDBMS'
  | 'NOSQL';

export type SignalSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface RawSignal {
  signal_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  message: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
  work_item_id?: string;
}

// ─── Work Item Types ──────────────────────────────────────────────────────────

export type WorkItemStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';

export type RootCauseCategory =
  | 'INFRASTRUCTURE'
  | 'APPLICATION_BUG'
  | 'CONFIGURATION'
  | 'DEPENDENCY_FAILURE'
  | 'CAPACITY'
  | 'SECURITY'
  | 'UNKNOWN';

export interface RCARecord {
  rca_id: string;
  work_item_id: string;
  incident_start: Date;
  incident_end: Date;
  root_cause_category: RootCauseCategory;
  fix_applied: string;
  prevention_steps: string;
  mttr_minutes: number;
  submitted_by: string;
  submitted_at: Date;
}

export interface WorkItem {
  work_item_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  status: WorkItemStatus;
  signal_count: number;
  created_at: Date;
  updated_at: Date;
  rca?: RCARecord;
}

// ─── Alert Types ─────────────────────────────────────────────────────────────

export interface AlertPayload {
  work_item_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  message: string;
  timestamp: Date;
}

// ─── Dashboard Types ──────────────────────────────────────────────────────────

export interface DashboardState {
  active_incidents: WorkItemSummary[];
  total_open: number;
  total_investigating: number;
  total_resolved: number;
  signals_per_sec: number;
  last_updated: Date;
}

export interface WorkItemSummary {
  work_item_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  status: WorkItemStatus;
  signal_count: number;
  created_at: Date;
  updated_at: Date;
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface IngestSignalRequest {
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkItemStatusRequest {
  status: WorkItemStatus;
}

export interface SubmitRCARequest {
  incident_start: string; // ISO date string
  incident_end: string;   // ISO date string
  root_cause_category: RootCauseCategory;
  fix_applied: string;
  prevention_steps: string;
  submitted_by: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── Queue Job Types ──────────────────────────────────────────────────────────

export interface SignalJobData {
  signal: RawSignal;
}

export interface WorkItemJobData {
  work_item_id: string;
  component_id: string;
  component_type: ComponentType;
  severity: SignalSeverity;
}
