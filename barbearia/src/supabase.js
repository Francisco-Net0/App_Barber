import { createClient } from '@supabase/supabase-js';
// Só a chave pública (anon). O acesso real é limitado pelas políticas RLS do banco.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
