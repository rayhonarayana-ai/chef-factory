// CHEF FACTORY — Gate 2 — Security Incident model.
// Foundational workflow only (DETECTED → INVESTIGATING → CONTAINED →
// RESOLVED → CLOSED). Not a SOC platform.

import type { IncidentStatus, SecurityIncidentInput, SecurityIncidentPatch, SecurityIncidentRecord } from './types.js';

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  detected: ['investigating', 'contained', 'resolved', 'closed'],
  investigating: ['contained', 'resolved', 'closed', 'detected'],
  contained: ['investigating', 'resolved', 'closed'],
  resolved: ['investigating', 'closed'],
  closed: [], // terminal
};

export function validateIncidentInput(input: SecurityIncidentInput): string | null {
  if (!input.title || input.title.trim().length === 0) return 'incident requires a title';
  return null;
}

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return true;
  return (INCIDENT_TRANSITIONS[from] ?? []).includes(to);
}

export function toIncidentRecord(ownerId: string, input: SecurityIncidentInput, now = new Date().toISOString()): SecurityIncidentRecord {
  return {
    incidentId: crypto.randomUUID(),
    ownerId,
    title: input.title,
    status: 'detected',
    description: input.description ?? null,
    eventIds: input.eventIds ?? [],
    openedBy: input.openedBy ?? null,
    closedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyIncidentPatch(
  record: SecurityIncidentRecord,
  patch: SecurityIncidentPatch,
  now = new Date().toISOString(),
): { record: SecurityIncidentRecord; error: string | null } {
  const next: SecurityIncidentRecord = { ...record };
  if (patch.status && patch.status !== record.status) {
    if (!canTransitionIncident(record.status, patch.status)) {
      return { record, error: `incident cannot transition ${record.status} → ${patch.status}` };
    }
    next.status = patch.status;
    if (patch.status === 'closed') next.closedBy = patch.closedBy ?? null;
  }
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.closedBy !== undefined && next.status !== 'closed') {
    // closing authority only meaningful on closed; ignore silently
  }
  next.updatedAt = now;
  return { record: next, error: null };
}
