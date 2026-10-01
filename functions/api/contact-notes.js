// GET  /api/contact-notes?client=<slug>&wa_id=<wa_id>
// POST /api/contact-notes  { client, wa_id, note }
//
// Bloco A4 do plano CRM: anotação livre por contato - o que faltava pra
// uma secretária deixar contexto pra próxima pessoa que atender ("já veio
// duas vezes, prefere á tarde", etc). Timeline própria, separada de
// whatsapp_events (que é append-only de eventos de negócio, não de notas
// administrativas). Scoped por sessão como todo o resto.

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await requireSession(request, env);
  if (!session) return jsonUnauthorized();

  const url = new URL(request.url);
  const client = await resolveClientBySlug(env, url.searchParams.get('client'));
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }
  if (!assertClientAccess(session, client)) return jsonForbidden();

  const waId = url.searchParams.get('wa_id');
  if (!waId) return json({ error: 'wa_id é obrigatório' }, 400);

  const rows = await env.DB.prepare(`
    SELECT n.id, n.note, n.created_at, n.user_id, u.name as user_name
    FROM contact_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.client_id = ? AND n.wa_id = ?
    ORDER BY n.id DESC
  `).bind(client.id, waId).all();

  return json({ notes: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await requireSession(request, env);
  if (!session) return jsonUnauthorized();

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const client = await resolveClientBySlug(env, body?.client);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }
  if (!assertClientAccess(session, client)) return jsonForbidden();

  const waId = String(body?.wa_id || '').trim();
  const note = String(body?.note || '').trim();
  if (!waId || !note) {
    return json({ error: 'wa_id e note são obrigatórios' }, 400);
  }
  if (note.length > 2000) {
    return json({ error: 'nota muito longa (máximo 2000 caracteres)' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('INSERT INTO contact_notes (wa_id, client_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(waId, client.id, session.userId, note, now)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
