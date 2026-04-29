'use strict';

// ── Supabase Configuration ─────────────────────────────
// From: https://supabase.com → your project → Settings → API
const SUPABASE_URL  = import.meta.env.SUPABASE_URL;  
const SUPABASE_ANON = import.meta.env.SUPABASE_ANON;

const supaClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
