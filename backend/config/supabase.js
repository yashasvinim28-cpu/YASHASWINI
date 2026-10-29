require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const projectUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!projectUrl || !secretKey) {
  throw new Error('Set SUPABASE_URL and the backend-only SUPABASE_SECRET_KEY in backend/.env.');
}

const supabase = createClient(projectUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function unwrap(query) {
  const { data, error } = await query;
  if (error) {
    const wrapped = new Error(error.message || 'Supabase request failed');
    wrapped.code = error.code;
    wrapped.details = error.details;
    wrapped.hint = error.hint;
    throw wrapped;
  }
  return data;
}

async function verifySupabaseSchema() {
  // PostgREST can return 204 for HEAD requests even when a relation is absent.
  // Use a normal limited select so missing tables return their schema-cache error.
  let error;
  try {
    ({ error } = await supabase.from('_users').select('id').limit(1));
  } catch (cause) {
    const networkCode = cause.cause?.code;
    const networkDetail = networkCode ? ` (${networkCode})` : '';
    throw new Error(`Could not connect to Supabase${networkDetail}. Check that SUPABASE_URL in backend/.env is the correct project URL and that the project/network is available.`);
  }

  if (error) {
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(error.message || '')) {
      const networkCode = error.cause?.code;
      const networkDetail = networkCode ? ` (${networkCode})` : '';
      throw new Error(`Could not connect to Supabase${networkDetail}. Check that SUPABASE_URL in backend/.env matches the project URL in the Supabase Dashboard and that the project/network is available.`);
    }
    if (error.code === 'PGRST205' || error.code === '42P01') {
      throw new Error(`Supabase is reachable, but the ClickNGo schema appears to be missing. Run backend/db/schema.sql in the Supabase SQL Editor. (${error.message})`);
    }
    throw new Error(`Supabase request failed (${error.code || 'unknown error'}): ${error.message}`);
  }
}

module.exports = { supabase, unwrap, verifySupabaseSchema };
