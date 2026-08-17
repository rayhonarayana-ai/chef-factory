// CHEF FACTORY — API — Security Guardian wiring (single authoritative boundary).
// Constructs the production SecurityGuardian backed by the real Store so that the
// API server's only execution-capable path (POST /api/chat → CommandPipeline.run)
// is always guarded. The Guardian is deterministic and may only be more
// restrictive than the Gate 1 authority decision.

import type { Store } from '../core/ports.js';
import { SecurityGuardian } from '../core/security/guardian.js';
import type { RateLimiter } from '../core/security/rateLimit.js';
import type { AnomalyDetector } from '../core/security/anomaly.js';
import { RateLimiter as DefaultRateLimiter } from '../core/security/rateLimit.js';
import { AnomalyDetector as DefaultAnomalyDetector } from '../core/security/anomaly.js';
import { CostProtector, PRODUCTION_COST_PROTECTION } from '../core/security/costProtection.js';

export function createSecurityGuardian(store: Store, rateLimiter?: RateLimiter, anomalyDetector?: AnomalyDetector): SecurityGuardian {
  const costProtector = new CostProtector(store, PRODUCTION_COST_PROTECTION);
  return new SecurityGuardian({
    lockdown: (ownerId) => store.activeLockdown(ownerId),
    rateLimiter: rateLimiter ?? new DefaultRateLimiter(),
    anomaly: anomalyDetector ?? new DefaultAnomalyDetector(),
    recordEvent: (event) => { void store.recordSecurityEvent(event.ownerId, event); },
    costCheck: (ownerId, projectId) => costProtector.check(ownerId, projectId),
  });
}
