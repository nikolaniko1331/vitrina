// GET /api/push-reminder  (called by Vercel Cron daily at 08:00 UTC)
// Sends a 24h reminder to each client who opted in for their specific booking.
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Only Vercel Cron (or manual test with secret) may call this
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Tomorrow in ISO — full day window
  const now = new Date();
  const tmr = new Date(now);
  tmr.setUTCDate(tmr.getUTCDate() + 1);
  const dateFrom = tmr.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const dateTo   = tmr.toISOString().slice(0, 10) + 'T23:59:59.999Z';

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, client_name, starts_at')
    .in('status', ['pending', 'confirmed'])
    .gte('starts_at', dateFrom)
    .lte('starts_at', dateTo);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!bookings?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No bookings tomorrow' }), { status: 200 });
  }

  const baseUrl = process.env.APP_URL || 'https://vitrina-fze5.vercel.app';

  // Send one reminder per booking — push-send routes by booking_id to the client's device only
  const results = await Promise.allSettled(
    bookings.map(b => {
      const time = b.starts_at.slice(11, 16);
      return fetch(`${baseUrl}/api/push-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: b.id,
          title: `Потсетник: термин утре во ${time}`,
          body: `Не заборавај го твојот термин утре во ${time} 📅`,
        }),
      });
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  return new Response(JSON.stringify({ sent, total: bookings.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
