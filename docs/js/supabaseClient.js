// Legacy shim: delegate to the new centralized client without creating another instance.
// This file previously created a Supabase client at top-level, which could race with
// the new `docs/js/auth/supabaseClient.js`. To avoid multiple GoTrueClient instances,
// we now strictly defer to the centralized module.

import { initSupabase } from './auth/supabaseClient.js?v=20260103';

try { console.log('[DEBUG] legacy supabaseClient shim loaded'); } catch {}

// Initialize via the centralized module (idempotent)
initSupabase();

// Do not re-define window.supabaseClient here; it is provided by
// `docs/js/auth/supabaseClient.js`. This stub intentionally avoids creating
// any new client or duplicating shims.
