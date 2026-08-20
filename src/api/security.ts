// CHEF FACTORY — API — Security Guardian wiring (single authoritative boundary).
// Constructs the production SecurityGuardian backed by the real Store so that the
// API server's only execution-capable path (POST /api/chat → CommandPipeline.run)
// is always guarded. The Guardian is deterministic and may only be more
// restrictive than the Gate 1 authority decision.

import type { Store } from '../core/ports.js';
import { SecurityGuardian } from '../core/security/guardian.js';
import type { RateLimiter } from '../core/security/rateLimit.js';
import type { AnomalyDetector } from '../core/security/anomaly.js';
import { RateLimiter as DefaultRateLimiter, PersistentRateLimiter } from '../core/security/rateLimit.js';
import { AnomalyDetector as DefaultAnomalyDetector, PersistentAnomalyDetector } from '../core/security/anomaly.js';
import { CostProtector, PRODUCTION_COST_PROTECTION } from '../core/security/costProtection.js';
import type { SecurityScopeKey } from '../core/security/types.js';
import type { AnomalyCounters } from '../core/security/types.js';

export function createSecurityGuardian(store: Store, rateLimiter?: RateLimiter, anomalyDetector?: AnomalyDetector): SecurityGuardian {
  const costProtector = new CostProtector(store, PRODUCTION_COST_PROTECTION);
  return new SecurityGuardian({
    lockdown: (ownerId) => store.activeLockdown(ownerId),
    rateLimiter: rateLimiter ?? new DefaultRateLimiter(),
    anomaly: anomalyDetector ?? new DefaultAnomalyDetector(),
    recordEvent: (event) => { store.recordSecurityEvent(event.ownerId, event).catch(() => { console.warn('[Gate 17] Security event persistence failed — audit gap possible'); }); },
    costCheck: (ownerId, projectId) => costProtector.check(ownerId, projectId),
    // Gate 16: wire persistent methods when persistent instances are provided
    checkPersisted: rateLimiter instanceof PersistentRateLimiter
      ? (ownerId, scope, limitKey) => rateLimiter.checkPersisted(ownerId, scope as SecurityScopeKey, limitKey)
      : undefined,
    notePersisted: anomalyDetector instanceof PersistentAnomalyDetector
      ? (ownerId, kind) => anomalyDetector.notePersisted(ownerId, kind as keyof AnomalyCounters)
      : undefined,
  });
}
