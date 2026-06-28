// POST /api/book
// Body: { slug, service_id, staff_id, starts_at, ends_at,
//         client_name, client_phone, client_email (optional), note }
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = { runtime: 'edge' };

// In-memory IP rate limit store (resets on cold start — good enough for edge)
const ipAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxAttempts = 3;
  const entry = ipAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    ipAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= maxAttempts) return true;
  ipAttempts.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
  return false;
}

export default async function handler(req) {
  // Debug: verify env vars are present
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars' }), { status: 500 });
  }

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

  // IP rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({
      error: 'Премногу обиди. Обидете се повторно за еден час.'
    }), { status: 429 });
  }

  const body = await req.json();
  const { slug, service_id, staff_id, starts_at, ends_at,
          client_name, client_phone, client_email, note } = body;

  if (!slug || !starts_at || !client_name || !client_phone) {
    return new Response(JSON.stringify({ error: 'missing required fields' }), { status: 400 });
  }

  // Resolve business_id from slug
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, config')
    .eq('slug', slug)
    .single();

  if (bizErr || !biz) {
    return new Response(JSON.stringify({ error: 'business not found' }), { status: 404 });
  }

  // Anti-spam: one active booking per phone per salon
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, starts_at')
    .eq('business_id', biz.id)
    .eq('client_phone', client_phone)
    .in('status', ['pending', 'confirmed'])
    .gt('starts_at', new Date().toISOString())
    .limit(1)
    .single();

  if (existing) {
    const dateStr = new Date(existing.starts_at).toLocaleString('mk-MK', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit'
    });
    return new Response(JSON.stringify({
      error: `Веќе имате активен термин (${dateStr}). Контактирајте го салонот за промени.`,
      code: 'DUPLICATE_BOOKING'
    }), { status: 409 });
  }

  // Insert booking
  const { data: booking, error: bookErr } = await supabase
    .from('bookings')
    .insert({
      business_id: biz.id,
      service_id,
      staff_id,
      starts_at,
      ends_at,
      client_name,
      client_phone,
      client_email: client_email || null,
      note,
      status: biz.config.approvalMode ? 'pending' : 'confirmed',
    })
    .select()
    .single();

  if (bookErr) {
    return new Response(JSON.stringify({ error: bookErr.message }), { status: 500 });
  }

  // Send confirmation email if client provided one
  if (client_email && process.env.RESEND_API_KEY) {
    await sendConfirmationEmail(booking, biz, client_email, client_name, starts_at);
  }

  // Send push notification to all subscribed devices for this business
  const baseUrl = process.env.APP_URL || 'https://vitrina-fze5.vercel.app';
  fetch(`${baseUrl}/api/push-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: biz.id,
      title: `📅 Нова резервација — ${biz.name}`,
      body: `${client_name} · ${new Date(starts_at).toLocaleString('mk-MK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    }),
  }).catch(() => {});

  return new Response(JSON.stringify({
    booking_id: booking.id,
    status: booking.status,
  }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function sendConfirmationEmail(booking, biz, email, name, starts_at) {
  const dateStr = new Date(starts_at).toLocaleString('mk-MK', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
  const receiptUrl = `${process.env.APP_URL || 'https://vitrina-fze5.vercel.app'}/booking/${booking.id}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${biz.name} <noreply@vitrina.mk>`,
      to: email,
      subject: `Потврда за резервација — ${biz.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#6B3F6E;margin:0 0 16px">${biz.name}</h2>
          <p style="margin:0 0 8px">Здраво ${name},</p>
          <p style="margin:0 0 16px">Твојот термин е потврден:</p>
          <div style="background:#F3EBF4;border-radius:8px;padding:16px;margin:0 0 16px">
            <div style="font-size:20px;font-weight:bold;color:#1A0F1B">${dateStr}</div>
          </div>
          <a href="${receiptUrl}" style="display:inline-block;background:#6B3F6E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:500;margin:0 0 16px">
            Погледни го терминот
          </a>
          <p style="color:#999;font-size:12px;margin:0">За промени или откажување, контактирајте го салонот директно.</p>
        </div>
      `,
    }),
  });
}
