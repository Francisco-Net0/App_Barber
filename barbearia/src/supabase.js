import { createClient } from '@supabase/supabase-js';
const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const url = rawUrl?.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
export const supabaseReady = Boolean(url && key);
// Só a chave pública (anon). O acesso real é limitado pelas políticas RLS do banco.
export const supabase = createClient(url || 'http://localhost:54321', key || 'missing', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});
