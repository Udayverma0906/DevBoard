'use strict';

// ── Supabase Configuration ─────────────────────────────
// From: https://supabase.com → your project → Settings → API
const SUPABASE_URL  = 'https://qttpaetkdinfsgncrvhx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0dHBhZXRrZGluZnNnbmNydmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTg0MjcsImV4cCI6MjA5MzAzNDQyN30.QF-C6z9R6idrIjd8Lbvq_bYnBLwVzeZazN9s5qDVN74';

const supaClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
