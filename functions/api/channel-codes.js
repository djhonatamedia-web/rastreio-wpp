// GET    /api/channel-codes?key=<DASH_KEY>&client=<slug>
// POST   /api/channel-codes  { client, channel, code? }  header x-dash-key
// DELETE /api/channel-codes  { client, code }            header x-dash-key
//
// Backs the "Canais fixos" card in the dashboard's "Configuracoes" tab:
// a fixed wa.me link per organic channel (bio, Google Meu Negocio), each
// carrying its own "Ref: <code>" pasted once into that channel - not a
// per-click code like /api/track-click's Google Ads flow. Same
// ad_click_codes table, told apart by `channel` being set instead of a
// click id (see migrations/0007_channel_codes.sql and the resolution
// logic in functions/webhook/_whatsapp-core.js).
//
// Unlike track-click.js this isn't public: creating/removing a channel
// code is a dashboard action, not something a landing page calls per
// visitor.

import { timingSafeEqual } from '../webhook/_utils.js';
import { resolveClientBySlug } from '../_shared/clients.js';

const VALID_CHANNELS = ['bio', 'gmb'];
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const client = await resolveClientBySlug(env, url.searchParams.get('client'));
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  const rows = await env.DB
    .prepare('SELECT code, channel, matched_wa_id, matched_at, created_at FROM ad_click_codes WHERE client_id = ? AND channel IS NOT NULL')
    .bind(client.id)
    .all();

  return json({ codes: rows.results || [] });
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

  const { client: clientSlug, channel } = body;
  if (!VALID_CHANNELS.includes(channel)) {
    return json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }, 400);
  }

  const client = await resolveClientBySlug(env, clientSlug);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  const existing = await env.DB
    .prepare('SELECT code FROM ad_click_codes WHERE client_id = ? AND channel = ?')
    .bind(client.id, channel)
    .first();
  if (existing) {
    return json({ error: `ja existe um codigo para o canal '${channel}'`, code: existing.code }, 409);
  }

  const code = body.code ? String(body.code).toUpperCase() : generateCode();
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB
      .prepare('INSERT INTO ad_click_codes (client_id, code, channel, created_at) VALUES (?, ?, ?, ?)')
      .bind(client.id, code, channel, now)
      .run();
  } catch (e) {
    return json({ error: `falha ao criar codigo (colisao? tente de novo): ${e.message}` }, 500);
  }

  return json({ ok: true, code, channel });
}

export async function onRequestDelete(context) {
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

  if (!body.code) {
    return json({ error: 'code is required' }, 400);
  }

  const client = await resolveClientBySlug(env, body.client);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }

  await env.DB
    .prepare('DELETE FROM ad_click_codes WHERE client_id = ? AND code = ? AND channel IS NOT NULL')
    .bind(client.id, String(body.code).toUpperCase())
    .run();

  return json({ ok: true });
}

function generateCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
