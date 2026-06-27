// POST /api/book
// Body: { slug, service_id, staff_id, starts_at, ends_at,
//         client_name, client_phone, client_email, note }
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

  const body = await req.json();
  const { slug, service_id, staff_id, starts_at, ends_at,
          client_name, client_phone, client_email, note } = body;

  if (!slug || !starts_at || !client_name || !client_phone || !client_email) {
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
      client_email,
      note,
      status: biz.config.approvalMode ? 'pending' : 'confirmed',
    })
    .select()
    .single();

  if (bookErr) {
    return new Response(JSON.stringify({ error: bookErr.message }), { status: 500 });
  }

  // Send confirmation email via Resend
  if (process.env.RESEND_API_KEY) {
    await sendConfirmationEmail(booking, biz, client_email, client_name, starts_at);
  }

  // Build WhatsApp notification URL for owner
  const waText = encodeURIComponent(
    `📅 Nova rezervacija!\n` +
    `Klijent: ${client_name}\n` +
    `Tel: ${client_phone}\n` +
    `Vreme: ${new Date(starts_at).toLocaleString('mk-MK')}`
  );
  const waUrl = biz.config.whatsapp
    ? `https://wa.me/${biz.config.whatsapp}?text=${waText}`
    : null;

  return new Response(JSON.stringify({
    booking_id: booking.id,
    status: booking.status,
    whatsapp_url: waUrl,
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
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#6B3F6E">${biz.name}</h2>
          <p>Здраво ${name},</p>
          <p>Твојот термин е потврден:</p>
          <p style="font-size:18px;font-weight:bold">${dateStr}</p>
          <p style="color:#888;font-size:13px">Откажување до 2ч пред термин.</p>
        </div>
      `,
    }),
  });
}
