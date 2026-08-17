# CHEF FACTORY — SUPABASE CONFIGURATION

**Prompt:** PROMPT 2A-OPEN-01 — SUPABASE ORGANIZATION CONFIGURATION (resolved 2026-08-15)
**Status:** **FACTORY_SUPABASE_ACTIVATED**

> This document records configuration state honestly. No secret values are included.
> Secrets (anon key, DB password) live ONLY in the git-ignored `.env` file.

---

## 1. Factory Repository Identity
- Repository: **CHEF FACTORY** at `C:\Users\user11\Documents\Default Project\chef-factory`
- Product repos (NOT part of Factory): `../tadbir`; Qarayti.ai / PROOFOS / FreeSchool are external projects in other orgs.

## 2. Organization Identity
- Organization: **CHEF FACTORY**
- ID: `hrvqbsttfoqxhlnibrxa` (created 2026-08-15)
- The previous organization `ttxjrsorgggextzjbdcs` was deleted by the owner; the new one replaces it.

## 3. Organization ID Verification
**VERIFIED** — created via authenticated Supabase CLI; confirmed in `supabase orgs list`.

## 4. Factory Project Identity
- Project: **CHEF FACTORY DB**
- Ref: `dybyidtcyzgliupzzfhl`
- Region: `eu-west-1`
- Status: `ACTIVE_HEALTHY`
- Independent: YES — not Qarayti.ai / PROOFOS / Tadbir / FreeSchool (their projects untouched).

## 5. Environment Variable Presence
| Variable | Presence |
|---|---|
| `FACTORY_SUPABASE_URL` | PRESENT (in `chef-factory/.env`) |
| `FACTORY_SUPABASE_ANON_KEY` | PRESENT (in `chef-factory/.env`) |

## 6. Connectivity Result
**VERIFIED — SUPABASE_REACHABLE.**
- Auth API `/auth/v1/health`: HTTP 200
- REST API: anon JWT accepted (GET nonexistent table → 404 = auth passed; root 401 is endpoint protection, not a key failure)
- JWT payload verified locally: role=anon, ref=dybyidtcyzgliupzzfhl, iss=supabase

## 7. Secret Safety Result
**PASS** — service_role key was fetched for verification but NEVER stored; anon key + DB password stored only in `.env` (git-ignored); PAT authenticated CLI but is scheduled for revocation by owner.

## 8. Git Safety Result
**PASS** — `.gitignore` excludes `.env*`; nothing secret committed (repo not yet git-initialized).

## 9. Files Changed (this phase)
- `chef-factory/.env` (NEW — git-ignored; FACTORY_DB_PASSWORD, FACTORY_SUPABASE_URL, FACTORY_SUPABASE_ANON_KEY)
- `docs/factory/SUPABASE_CONFIGURATION.md` (updated)
- `todo.md` (updated)

## 10. Infrastructure Changes
- Created org **CHEF FACTORY** + project **CHEF FACTORY DB** (owner-authorized).
- **TEMPORARY:** project `kwwqqtuggkooqnrwqzsi` (org "وكيل خاص" / PROOFOS) was **PAUSED** by owner decision to free a free-tier slot.
  ⚠️ **Owner must plan its reactivation** (upgrade billing or delete an inactive project) when PROOFOS is needed again.

## 11. Blockers
None for Phase 2A. (Free-tier 2-active-project limit was the constraint; resolved by pausing PROOFOS.)

## 12. Next Phase
**GATE 1 — DATABASE FOUNDATION** (owners tables + migrations). Authorized via PROMPT 2/5 by owner.
