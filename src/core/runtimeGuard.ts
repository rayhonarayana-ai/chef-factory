// CHEF FACTORY — Gate 24 — Runtime input boundary validation.
// Prevents AI-generated or externally supplied values from bypassing
// domain contracts through TypeScript casts.

import {
  TASK_STATUSES,
  APPROVAL_STATUSES,
  RISK_LEVELS,
  PERMISSIONS,
  ENVIRONMENTS,
  AUTONOMY_LEVELS,
} from './types.js';

type TupleToSet<T extends readonly string[]> = T[number];

export const VALID_TASK_STATUSES: ReadonlySet<string> = new Set<string>(TASK_STATUSES);
export const VALID_APPROVAL_STATUSES: ReadonlySet<string> = new Set<string>(APPROVAL_STATUSES);
export const VALID_PRIORITIES: ReadonlySet<string> = new Set<string>(['low', 'medium', 'high', 'critical']);
export const VALID_RISK_LEVELS: ReadonlySet<string> = new Set<string>(RISK_LEVELS);
export const VALID_PERMISSIONS: ReadonlySet<string> = new Set<string>(PERMISSIONS);
export const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set<string>(ENVIRONMENTS);
export const VALID_AUTONOMY_LEVELS: ReadonlySet<string> = new Set<string>(AUTONOMY_LEVELS);

export function isTaskStatus(v: unknown): v is TupleToSet<typeof TASK_STATUSES> {
  return typeof v === 'string' && VALID_TASK_STATUSES.has(v);
}

export function isApprovalStatus(v: unknown): v is TupleToSet<typeof APPROVAL_STATUSES> {
  return typeof v === 'string' && VALID_APPROVAL_STATUSES.has(v);
}

export function isPriority(v: unknown): v is 'low' | 'medium' | 'high' | 'critical' {
  return typeof v === 'string' && VALID_PRIORITIES.has(v);
}

export function isRiskLevel(v: unknown): v is TupleToSet<typeof RISK_LEVELS> {
  return typeof v === 'string' && VALID_RISK_LEVELS.has(v);
}

export function isPermission(v: unknown): v is TupleToSet<typeof PERMISSIONS> {
  return typeof v === 'string' && VALID_PERMISSIONS.has(v);
}

export function isEnvironmentName(v: unknown): v is TupleToSet<typeof ENVIRONMENTS> {
  return typeof v === 'string' && VALID_ENVIRONMENTS.has(v);
}

export function isAutonomyLevel(v: unknown): v is TupleToSet<typeof AUTONOMY_LEVELS> {
  return typeof v === 'string' && VALID_AUTONOMY_LEVELS.has(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
