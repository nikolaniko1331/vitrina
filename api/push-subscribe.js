// POST /api/push-subscribe
// Body: { slug, subscription: { endpoint, keys: { p256dh, auth } } }
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  const { slug, subscription } = await req.json();
  if (!slug || !subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400 });
  }

  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!biz) {
    return new Response(JSON.stringify({ error: 'business not found' }), { status: 404 });
  }

  // Upsert — same endpoint just updates keys
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      business_id: biz.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    }, { onConflict: 'endpoint' });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
