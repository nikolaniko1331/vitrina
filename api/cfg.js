// GET /api/cfg?slug=salon-mia
// Returns business config + staff + services for a given slug
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');

  if (!slug) {
    return new Response(JSON.stringify({ error: 'slug required' }), { status: 400 });
  }

  const [bizRes, staffRes, svcRes] = await Promise.all([
    supabase.from('businesses').select('id,name,config').eq('slug', slug).single(),
    supabase.from('staff').select('id,name,color').eq('business_id',
      supabase.from('businesses').select('id').eq('slug', slug).single()
    ),
    supabase.from('services').select('id,name,duration_min,price,pool').eq('business_id',
      supabase.from('businesses').select('id').eq('slug', slug).single()
    ),
  ]);

  if (bizRes.error || !bizRes.data) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }

  // Simpler sequential fetch to avoid subquery issues with anon key
  const biz = bizRes.data;

  const [staffRes2, svcRes2] = await Promise.all([
    supabase.from('staff').select('id,name,color').eq('business_id', biz.id),
    supabase.from('services').select('id,name,duration_min,price,pool').eq('business_id', biz.id),
  ]);

  return new Response(JSON.stringify({
    id: biz.id,
    name: biz.name,
    ...biz.config,
    staff: staffRes2.data || [],
    services: svcRes2.data || [],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=60',
    },
  });
}
