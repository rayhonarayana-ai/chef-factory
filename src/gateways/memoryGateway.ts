// CHEF FACTORY — Gate 1 — Memory Gateway (boundary).
// Verified state: agent_memory.py / ChromaDB are NOT present (BOOTSTRAP_REPORT §4).
// Gate 1 provides the abstraction + a safe no-backend implementation.
// Memory must never override authority, security, project isolation, or explicit
// owner decisions. Lessons are validated and never contain secrets.

import type { LessonInput, RecallItem } from '../core/types.js';
import type { Store } from '../core/ports.js';

export interface MemoryGateway {
  readonly configured: boolean;
  recall(ownerId: string, query: string): Promise<RecallItem[]>;
  saveLesson(ownerId: string, lesson: LessonInput): Promise<void>;
}

const FORBIDDEN_PATTERNS = [
  /password/i,
  /api[_-]?\s?key/i,
  /secret/i,
  /token/i,
  /bearer\s+[a-z0-9]/i,
  /sbp_/i,
  /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
];

export function validateLesson(lesson: LessonInput): string | null {
  if (!lesson.title.trim()) return 'lesson title is required';
  if (!lesson.summary.trim()) return 'lesson summary is required';
  if (lesson.confidence < 0 || lesson.confidence > 1) return 'confidence must be between 0 and 1';
  const text = `${lesson.title}\n${lesson.summary}`;
  if (FORBIDDEN_PATTERNS.some((re) => re.test(text))) {
    return 'lesson may not contain secrets or credentials';
  }
  return null;
}

export function createMemoryGateway(store: Store): MemoryGateway {
  return {
    configured: false, // no vector backend present — verified in BOOTSTRAP_REPORT
    async recall(ownerId: string, query: string): Promise<RecallItem[]> {
      // No backend configured — deterministic empty recall (never fabricated).
      void ownerId;
      void query;
      return [];
    },
    async saveLesson(ownerId: string, lesson: LessonInput): Promise<void> {
      const error = validateLesson(lesson);
      if (error) throw new Error(error);
      // Persisted behind the boundary via the Store (operational record for Gate 1).
      await store.saveLesson(ownerId, lesson);
    },
  };
}
