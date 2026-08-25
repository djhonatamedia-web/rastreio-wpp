// GET /api/whatsapp-contacts?key=...&status=lead&only_ctwa=1&search=5511&limit=100
//
// Dashboard "Conversas" tab — one row per WhatsApp contact with its current
// lifecycle status. Source: whatsapp_contacts (the only mutable table in
// this project).

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const status = url.searchParams.get('status') || null;
  const onlyCtwa = url.searchParams.get('only_ctwa') === '1';
  const search = url.searchParams.get('search') || null;
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);

  const clauses = [];
  const binds = [];
  if (status) {
    clauses.push('status = ?');
    binds.push(status);
  }
  if (onlyCtwa) {
    clauses.push('is_ctwa = 1');
  }
  if (search) {
    clauses.push('phone LIKE ?');
    binds.push(`%${search.replace(/\D/g, '')}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const rows = await env.DB.prepare(`
      SELECT
        wa_id, phone, push_name, ctwa_clid, ad_source_id, ad_headline,
        ad_source_url, ad_media_type, ad_thumbnail_url, is_ctwa, first_message_text,
        first_message_at, status, status_source, status_updated_at,
        lead_sent_to_meta, lead_meta_status_code, lead_meta_response_ok,
        lead_meta_response_body, lead_meta_payload_sent,
        created_at, updated_at
      FROM whatsapp_contacts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(...binds, limit).all();

    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) as count FROM whatsapp_contacts GROUP BY status
    `).all();

    return json({
      contacts: rows.results || [],
      counts_by_status: counts.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
