// GET   /api/appointments?client=<slug>&from=<unix>&to=<unix>
// POST  /api/appointments  { client, wa_id, scheduled_at, procedure_label?, notes? }
// PATCH /api/appointments  { client, id, status?, scheduled_at?, procedure_label?, notes? }
//
// Bloco A2 do plano CRM: consulta com data/hora real, separada do status
// geral do funil (whatsapp_contacts.status continua existindo do jeito
// que esta). Alimenta o calendario (Bloco B) e a taxa de
// compareceu/nao-compareceu - hoje esse dado simplesmente nao existia.
//
// Scoped por sessao como todo o resto (functions/_shared/auth.js): equipe
// so le/escreve agendamento do proprio cliente, admin de qualquer um.
// "Cancelado" e um status, nao uma exclusao - o historico fica.

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';

const VALID_STATUSES = ['scheduled', 'confirmed', 'attended', 'no_show', 'canceled'];

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

  const from = parseInt(url.searchParams.get('from') || '', 10);
  const to = parseInt(url.searchParams.get('to') || '', 10);
  const waId = url.searchParams.get('wa_id');

  const clauses = ['a.client_id = ?'];
  const binds = [client.id];
  if (Number.isFinite(from)) {
    clauses.push('a.scheduled_at >= ?');
    binds.push(from);
  }
  if (Number.isFinite(to)) {
    clauses.push('a.scheduled_at <= ?');
    binds.push(to);
  }
  if (waId) {
    // Bloco C4: busca por contato - usado pelo drawer pra achar a
    // proxima/ultima consulta sem buscar o mes inteiro.
    clauses.push('a.wa_id = ?');
    binds.push(waId);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  try {
    const rows = await env.DB.prepare(`
      SELECT
        a.id, a.wa_id, a.scheduled_at, a.status, a.procedure_label, a.notes,
        a.created_by, a.created_at, a.updated_at,
        c.push_name, c.phone
      FROM appointments a
      LEFT JOIN whatsapp_contacts c ON c.wa_id = a.wa_id AND c.client_id = a.client_id
      ${where}
      ORDER BY a.scheduled_at ASC
    `).bind(...binds).all();

    return json({ appointments: rows.results || [] });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
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
  const scheduledAt = parseInt(body?.scheduled_at, 10);
  if (!waId || !Number.isFinite(scheduledAt)) {
    return json({ error: 'wa_id e scheduled_at (unix seconds) são obrigatórios' }, 400);
  }

  const contact = await env.DB
    .prepare('SELECT wa_id FROM whatsapp_contacts WHERE client_id = ? AND wa_id = ?')
    .bind(client.id, waId)
    .first();
  if (!contact) {
    return json({ error: 'nenhum contato com esse wa_id neste cliente' }, 404);
  }

  const procedureLabel = body?.procedure_label ? String(body.procedure_label).trim().slice(0, 200) : null;
  const notes = body?.notes ? String(body.notes).trim().slice(0, 2000) : null;
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB
    .prepare('INSERT INTO appointments (client_id, wa_id, scheduled_at, status, procedure_label, created_by, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(client.id, waId, scheduledAt, 'scheduled', procedureLabel, session.userId, notes, now, now)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
}

export async function onRequestPatch(context) {
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

  const id = parseInt(body?.id, 10);
  if (!id) return json({ error: 'id é obrigatório' }, 400);

  const existing = await env.DB
    .prepare('SELECT id FROM appointments WHERE id = ? AND client_id = ?')
    .bind(id, client.id)
    .first();
  if (!existing) return json({ error: 'agendamento não encontrado neste cliente' }, 404);

  const sets = [];
  const binds = [];

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.scheduled_at !== undefined) {
    const scheduledAt = parseInt(body.scheduled_at, 10);
    if (!Number.isFinite(scheduledAt)) return json({ error: 'scheduled_at inválido' }, 400);
    sets.push('scheduled_at = ?');
    binds.push(scheduledAt);
  }
  if (body.procedure_label !== undefined) {
    sets.push('procedure_label = ?');
    binds.push(body.procedure_label ? String(body.procedure_label).trim().slice(0, 200) : null);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?');
    binds.push(body.notes ? String(body.notes).trim().slice(0, 2000) : null);
  }

  if (sets.length === 0) {
    return json({ error: 'nada para atualizar' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?');
  binds.push(now);
  binds.push(id, client.id);

  await env.DB.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`).bind(...binds).run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
