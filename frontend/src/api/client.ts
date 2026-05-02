import { ApiResponse, WorkItem, RCARecord, RawSignal, DashboardState, WorkItemStatus } from '../types';

const BASE_URL = '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok && !data.success) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data as ApiResponse<T>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const getDashboard = () =>
  request<DashboardState>('/dashboard');

// ─── Work Items ───────────────────────────────────────────────────────────────

export const getWorkItems = (status?: WorkItemStatus) =>
  request<WorkItem[]>(`/work-items${status ? `?status=${status}` : ''}`);

export const getWorkItem = (id: string) =>
  request<WorkItem & { rca?: RCARecord; allowed_transitions: WorkItemStatus[] }>(
    `/work-items/${id}`
  );

export const updateWorkItemStatus = (id: string, status: WorkItemStatus) =>
  request<WorkItem>(`/work-items/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const submitRca = (
  id: string,
  rca: {
    incident_start: string;
    incident_end: string;
    root_cause_category: string;
    fix_applied: string;
    prevention_steps: string;
    submitted_by: string;
  }
) =>
  request<RCARecord>(`/work-items/${id}/rca`, {
    method: 'POST',
    body: JSON.stringify(rca),
  });

// ─── Signals ──────────────────────────────────────────────────────────────────

export const getSignalsForWorkItem = (workItemId: string) =>
  request<RawSignal[]>(`/signals/${workItemId}`);
