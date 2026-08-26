// GET  /api/clients?key=<DASH_KEY>                    - list clients for the dashboard's switcher
// POST /api/clients  { name, slug }  header x-dash-key - create a client, generates its webhook_slug
//
// Backs the dashboard's "Clientes" tab. One DASH_KEY for the whole agency
// (see CLAUDE.md) - whoever holds it can see/manage every client. `slug`
// doubles as the prefix for that client's Cloudflare secrets (see
// functions/_shared/clients.js, getClientSecret) - lowercase letters,
// numbers and hyphens only, so it maps cleanly to an env var name.

import { timingSafeEqual } from '../webhook/_utils.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const rows = await env.DB
    .prepare('SELECT id, name, slug, webhook_slug, active, created_at FROM clients ORDER BY name')
    .all();

  return json({ clients: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const providedKey = request.headers.get('x-dash-key') || '';
  if (!env.DASH_KEY || !timingSafeEqual(providedKey, env.DASH_KEY)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const name = (body.name || '').trim();
  const slug = (body.slug || '').trim().toLowerCase();
  if (!name || !slug) {
    return json({ error: 'name and slug are required' }, 400);
  }
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'slug deve ter só letras minúsculas, números e hífen (ex: tintim)' }, 400);
  }

  const webhookSlug = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await env.DB
      .prepare('INSERT INTO clients (name, slug, webhook_slug, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .bind(name, slug, webhookSlug, now)
      .run();
    return json({ ok: true, id: result.meta.last_row_id, slug, webhook_slug: webhookSlug });
  } catch (e) {
    return json({ error: `falha ao criar cliente (slug já existe? ${e.message})` }, 400);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
