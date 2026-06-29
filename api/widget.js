// GET /?s=slug — serves index.html with per-business OG/meta tags injected
// Vercel rewrites /?s=* to this endpoint; browser URL stays as /?s=slug
export const config = { runtime: 'edge' };

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default async function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const slug = searchParams.get('s') || 'salon-mia';
  const baseUrl = process.env.APP_URL || 'https://vitrina-fze5.vercel.app';

  // Fetch config and base HTML in parallel
  const [cfgRes, htmlRes] = await Promise.all([
    fetch(`${baseUrl}/api/cfg?slug=${slug}`),
    fetch(`${baseUrl}/index.html`),
  ]);

  let html = await htmlRes.text();

  // If config fetch fails, serve index.html as-is — widget handles the error
  if (!cfgRes.ok) {
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const cfg = await cfgRes.json();

  const bizName  = cfg.name || 'Витрина';
  const title    = `${bizName} — Резервирај термин`;
  const rawDesc  = cfg.about
    ? cfg.about.replace(/\n/g, ' ').slice(0, 155)
    : `Резервирај термин во ${bizName} преку Витрина.`;
  const desc     = rawDesc.length === 155 ? rawDesc + '…' : rawDesc;
  const image    = (cfg.photos && cfg.photos[0]) || `${baseUrl}/icon-192.png`;
  const pageUrl  = `${baseUrl}/?s=${slug}`;

  const metaTags = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="Витрина">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${image}">`;

  // Remove existing static <title> then inject before </head>
  html = html
    .replace(/<title>[^<]*<\/title>/, '')
    .replace('</head>', metaTags + '\n</head>');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
    },
  });
}
