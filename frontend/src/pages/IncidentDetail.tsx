import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  getWorkItem,
  getSignalsForWorkItem,
  updateWorkItemStatus,
  submitRca,
} from '../api/client';
import { WorkItem, RawSignal, WorkItemStatus, RootCauseCategory } from '../types';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatusBadge } from '../components/StatusBadge';
import { ArrowLeft, RefreshCw, ChevronRight } from 'lucide-react';

const ROOT_CAUSE_OPTIONS: RootCauseCategory[] = [
  'INFRASTRUCTURE',
  'APPLICATION_BUG',
  'CONFIGURATION',
  'DEPENDENCY_FAILURE',
  'CAPACITY',
  'SECURITY',
  'UNKNOWN',
];

export const IncidentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [signals, setSignals] = useState<RawSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showRcaForm, setShowRcaForm] = useState(false);
  const [rcaSubmitting, setRcaSubmitting] = useState(false);
  const [rcaError, setRcaError] = useState<string | null>(null);
  const [rcaSuccess, setRcaSuccess] = useState(false);

  const [rcaForm, setRcaForm] = useState({
    incident_start: '',
    incident_end: '',
    root_cause_category: 'INFRASTRUCTURE' as RootCauseCategory,
    fix_applied: '',
    prevention_steps: '',
    submitted_by: '',
  });

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [itemRes, signalsRes] = await Promise.all([
        getWorkItem(id),
        getSignalsForWorkItem(id),
      ]);
      if (itemRes.data) {
        setWorkItem(itemRes.data);
        setRcaForm((f) => ({
          ...f,
          incident_start: f.incident_start || new Date(itemRes.data!.created_at).toISOString().slice(0, 16),
        }));
      }
      if (signalsRes.data) setSignals(signalsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  const handleTransition = async (nextStatus: WorkItemStatus) => {
    if (!id) return;
    setTransitioning(true);
    setError(null);
    try {
      const res = await updateWorkItemStatus(id, nextStatus);
      if (res.data) {
        setWorkItem(res.data);
        await loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setTransitioning(false);
    }
  };

  const handleRcaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setRcaSubmitting(true);
    setRcaError(null);
    try {
      await submitRca(id, {
        ...rcaForm,
        incident_start: new Date(rcaForm.incident_start).toISOString(),
        incident_end: new Date(rcaForm.incident_end).toISOString(),
      });
      setRcaSuccess(true);
      setShowRcaForm(false);
      await loadData();
    } catch (err) {
      setRcaError(err instanceof Error ? err.message : 'RCA submission failed');
    } finally {
      setRcaSubmitting(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw className="animate-spin mr-2" size={20} />
        <span>Loading incident...</span>
      </div>
    );
  }

  // ── Error with no data ─────────────────────────────────────────────────────
  if (!workItem) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center text-gray-500">
        <p>{error ?? 'Incident not found.'}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-blue-600 hover:underline">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const allowedTransitions = workItem.allowed_transitions ?? [];
  const mttr = workItem.rca
    ? parseFloat(String(workItem.rca.mttr_minutes)).toFixed(1)
    : null;

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-900 transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
            <span className="text-sm">Dashboard</span>
          </button>
          <ChevronRight size={14} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700">{workItem.component_id}</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Work Item Header ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <SeverityBadge severity={workItem.severity} />
                <StatusBadge status={workItem.status} />
              </div>
              <h1 className="text-xl font-bold text-gray-900">{workItem.component_id}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {workItem.component_type} · ID: {workItem.work_item_id}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Created {formatDistanceToNow(new Date(workItem.created_at), { addSuffix: true })}
                {' · '}
                {workItem.signal_count} signal{workItem.signal_count !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Transition Buttons */}
            {allowedTransitions.length > 0 && (
              <div className="flex flex-col gap-2">
                {allowedTransitions.map((next) => (
                  <button
                    key={next}
                    onClick={() => handleTransition(next)}
                    disabled={transitioning}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 ${
                      next === 'CLOSED'
                        ? 'bg-gray-800 text-white hover:bg-gray-900'
                        : next === 'RESOLVED'
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {transitioning ? 'Updating...' : `Move to ${next}`}
                  </button>
                ))}
              </div>
            )}

            {workItem.status === 'CLOSED' && (
              <span className="text-sm text-gray-400 italic">Incident closed</span>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* ── RCA Section ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Root Cause Analysis</h2>
            {workItem.status !== 'CLOSED' && (
              <button
                onClick={() => setShowRcaForm(!showRcaForm)}
                className="text-sm text-blue-600 hover:underline"
              >
                {workItem.rca ? 'Update RCA' : 'Submit RCA'}
              </button>
            )}
          </div>

          {rcaSuccess && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
              ✅ RCA submitted successfully
            </div>
          )}

          {/* RCA display */}
          {workItem.rca ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 font-medium">Incident Start</p>
                  <p>{format(new Date(workItem.rca.incident_start), 'PPpp')}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Incident End</p>
                  <p>{format(new Date(workItem.rca.incident_end), 'PPpp')}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">MTTR</p>
                  <p className="font-semibold text-blue-700">{mttr} minutes</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Root Cause Category</p>
                  <p>{workItem.rca.root_cause_category}</p>
                </div>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Fix Applied</p>
                <p className="mt-1 text-gray-800 whitespace-pre-wrap">{workItem.rca.fix_applied}</p>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Prevention Steps</p>
                <p className="mt-1 text-gray-800 whitespace-pre-wrap">{workItem.rca.prevention_steps}</p>
              </div>
              <p className="text-gray-400 text-xs">
                Submitted by {workItem.rca.submitted_by} ·{' '}
                {formatDistanceToNow(new Date(workItem.rca.submitted_at), { addSuffix: true })}
              </p>
            </div>
          ) : (
            !showRcaForm && (
              <p className="text-gray-400 text-sm italic">
                No RCA submitted yet.
                {workItem.status !== 'CLOSED' && ' An RCA is required before closing this incident.'}
              </p>
            )
          )}

          {/* RCA Form */}
          {showRcaForm && (
            <form onSubmit={handleRcaSubmit} className="mt-4 space-y-4 border-t pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Incident Start *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={rcaForm.incident_start}
                    onChange={(e) => setRcaForm((f) => ({ ...f, incident_start: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Incident End *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={rcaForm.incident_end}
                    onChange={(e) => setRcaForm((f) => ({ ...f, incident_end: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Root Cause Category *
                </label>
                <select
                  required
                  value={rcaForm.root_cause_category}
                  onChange={(e) => setRcaForm((f) => ({ ...f, root_cause_category: e.target.value as RootCauseCategory }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROOT_CAUSE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fix Applied * (min 10 chars)
                </label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={rcaForm.fix_applied}
                  onChange={(e) => setRcaForm((f) => ({ ...f, fix_applied: e.target.value }))}
                  placeholder="Describe the fix that was applied..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prevention Steps * (min 10 chars)
                </label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={rcaForm.prevention_steps}
                  onChange={(e) => setRcaForm((f) => ({ ...f, prevention_steps: e.target.value }))}
                  placeholder="Describe steps to prevent recurrence..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Submitted By *
                </label>
                <input
                  type="text"
                  required
                  value={rcaForm.submitted_by}
                  onChange={(e) => setRcaForm((f) => ({ ...f, submitted_by: e.target.value }))}
                  placeholder="engineer@company.com"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {rcaError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {rcaError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={rcaSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {rcaSubmitting ? 'Submitting...' : 'Submit RCA'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRcaForm(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Raw Signals ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Raw Signals ({signals.length})
          </h2>
          {signals.length === 0 ? (
            <p className="text-gray-400 text-sm italic">No signals found.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {signals.map((signal) => (
                <div
                  key={signal.signal_id}
                  className="flex items-start gap-3 p-3 bg-gray-50 rounded border border-gray-100 text-sm"
                >
                  <SeverityBadge severity={signal.severity} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-800 font-medium truncate">{signal.message}</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {format(new Date(signal.timestamp), 'PPpp')} · {signal.signal_id.slice(0, 8)}
                    </p>
                    {Object.keys(signal.metadata).length > 0 && (
                      <pre className="text-xs text-gray-500 mt-1 overflow-x-auto">
                        {JSON.stringify(signal.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
