// POST /api/push-send (called internally from /api/book after insert)
// Body: { business_id, title, body }
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = { runtime: 'edge' };

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = 'mailto:nikola.cvetanovski@gmail.com';

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function buildVapidAuth(endpoint) {
  const url   = new URL(endpoint);
  const aud   = `${url.protocol}//${url.host}`;
  const exp   = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header  = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT })));
  const unsigned = `${header}.${payload}`;

  const rawKey = Uint8Array.from(atob(VAPID_PRIVATE.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', rawKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  ).catch(async () => {
    // Try raw format (32-byte private scalar)
    return crypto.subtle.importKey(
      'raw', rawKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['sign']
    );
  });

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  return `vapid t=${unsigned}.${b64url(sig)},k=${VAPID_PUBLIC}`;
}

async function sendPush(sub, payload) {
  const auth = await buildVapidAuth(sub.endpoint);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Authorization': auth,
    },
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
  return res.status;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500 });
  }

  const { business_id, booking_id, title, body } = await req.json();

  let query = supabase.from('push_subscriptions').select('endpoint, p256dh, auth');

  if (booking_id) {
    // Client reminder — send only to the specific booking's device
    query = query.eq('booking_id', booking_id);
  } else {
    // New booking alert — send only to owner devices (booking_id IS NULL)
    query = query.eq('business_id', business_id).is('booking_id', null);
  }

  const { data: subs } = await query;

  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const results = await Promise.allSettled(
    subs.map(s => sendPush(s, { title, body, icon: '/icon-192.png' }))
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
