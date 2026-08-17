// CHEF FACTORY — Gate 1 — Authentication helper (owner JWT verification).
// The Control Plane UI signs in via Supabase Auth; the API verifies the JWT and
// resolves the owner id. Server-side data access is scoped to that owner.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FactoryConfig } from '../db/config.js';

export interface SessionOwner {
  id: string;
  email: string;
}

export class AuthService {
  private readonly supabase: SupabaseClient;
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;

  constructor(cfg: FactoryConfig) {
    this.supabaseUrl = cfg.supabaseUrl;
    this.supabaseAnonKey = cfg.supabaseAnonKey;
    this.supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async verifyOwner(token: string): Promise<SessionOwner | null> {
    try {
      // 1) Validate the JWT against Supabase Auth (real session, server-side).
      const { data, error } = await this.supabase.auth.getUser(token);
      if (error || !data.user) return null;
      const user = data.user;
      // 2) Resolve the owner row via PostgREST carrying ONLY the caller's own
      //    Bearer token, so RLS evaluates auth.uid() against that user.
      //    (supabase-js 2.112.3 does not attach a session supplied through
      //    setSession, so the token is propagated explicitly as a request-scoped
      //    header — the mechanism proven by live forensic verification.)
      const res = await fetch(
        `${this.supabaseUrl}/rest/v1/owners?select=id,email,status&id=eq.${encodeURIComponent(user.id)}`,
        { headers: { apikey: this.supabaseAnonKey, Authorization: `Bearer ${token}` } },
      );
      if (res.status !== 200) return null;
      const rows = (await res.json()) as { id: string; email: string; status: string }[];
      const owner = rows[0];
      if (!owner || owner.id !== user.id || owner.status !== 'active') return null;
      return { id: owner.id, email: owner.email };
    } catch {
      return null;
    }
  }
}
