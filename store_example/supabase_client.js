// supabase_client.js

const SUPABASE_URL = 'https://xwkfzntmdkfztaeeuxkd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_14fF1qcKEF2Dj9bnD9U6pw_kbrZSIBe';

// Initialize Supabase Client using the globally injected Supabase library
if (!window.supabase) {
    console.error("El SDK de Supabase no fue cargado correctamente.");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export default supabase;
