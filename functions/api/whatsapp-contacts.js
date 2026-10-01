// GET /api/whatsapp-contacts?key=...&client=<slug>&status=lead&only_ctwa=1&search=5511&limit=100
// GET /api/whatsapp-contacts?key=...&client=<slug>&from=<unix>&to=<unix>
//
// Dashboard "Conversas" tab - one row per WhatsApp contact with its current
// lifecycle status, scoped to one client (see functions/_shared/clients.js).
// Source: whatsapp_contacts (the only mutable table in this project).
//
// `from`/`to` (unix seconds, both optional, independent of each other)
// filter by `created_at` - "quando o contato chegou", not any later
// stage change. Unlike whatsapp-stats.js there's no `days` shortcut or
// implicit window here: with neither param the list behaves exactly as
// before (most recent `limit` contacts, no date cutoff).

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';
import { normalizePhone, phoneMatchKey } from '../_shared/hashing.js';

// Bloco C2 do plano "Funil visual + ficha do paciente": origem de um lead
// criado manualmente - reaproveita o sistema de canal que ja existe
// (ad_platform), entao a Visao Geral/by_channel ja conta esses sozinhos.
const MANUAL_ORIGINS = ['indicacao', 'ligacao', 'walkin', 'outro'];

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

  const status = url.searchParams.get('status') || null;
  const onlyCtwa = url.searchParams.get('only_ctwa') === '1';
  const search = url.searchParams.get('search') || null;
  const from = url.searchParams.get('from') ? parseInt(url.searchParams.get('from'), 10) : null;
  const to = url.searchParams.get('to') ? parseInt(url.searchParams.get('to'), 10) : null;
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  // `stale_days`: só contatos cujo estágio atual não muda há N dias. Serve
  // pra achar "Agendado" que ninguém voltou pra fechar (Venda/Perdido).
  const staleDays = clampInt(url.searchParams.get('stale_days'), 0, 0, 365);

  const clauses = ['client_id = ?'];
  const binds = [client.id];
  if (status) {
    clauses.push('status = ?');
    binds.push(status);
  }
  if (staleDays > 0) {
    clauses.push('COALESCE(status_updated_at, created_at) <= ?');
    binds.push(Math.floor(Date.now() / 1000) - staleDays * 86400);
  }
  if (onlyCtwa) {
    clauses.push('is_ctwa = 1');
  }
  if (search) {
    clauses.push('phone LIKE ?');
    binds.push(`%${search.replace(/\D/g, '')}%`);
  }
  if (from != null && !Number.isNaN(from)) {
    clauses.push('created_at >= ?');
    binds.push(from);
  }
  if (to != null && !Number.isNaN(to)) {
    clauses.push('created_at <= ?');
    binds.push(to);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  try {
    const rows = await env.DB.prepare(`
      SELECT
        wa_id, phone, push_name, ctwa_clid, ad_source_id, ad_headline,
        ad_source_url, ad_media_type, ad_thumbnail_url, is_ctwa, ad_platform,
        gclid, first_message_text,
        first_message_at, status, status_source, status_updated_at,
        lead_sent_to_meta, lead_meta_status_code, lead_meta_response_ok,
        lead_meta_response_body, lead_meta_payload_sent,
        created_source, created_at, updated_at
      FROM whatsapp_contacts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(...binds, limit).all();

    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) as count FROM whatsapp_contacts WHERE client_id = ? GROUP BY status
    `).bind(client.id).all();

    return json({
      contacts: rows.results || [],
      counts_by_status: counts.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// POST /api/whatsapp-contacts  { client, name, phone, origin }
//
// Bloco C2: cria um lead que NUNCA mandou mensagem (ligação, indicação,
// walk-in). wa_id sintético (`<telefone>@manual.local`) porque todo o
// resto do sistema é keyed por wa_id; se essa pessoa mandar mensagem de
// verdade depois, o webhook ASSUME este registro em vez de duplicar - ver
// claimManualContact() em functions/webhook/_whatsapp-core.js.
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

  const name = String(body?.name || '').trim().slice(0, 200);
  const phoneRaw = String(body?.phone || '').trim();
  const origin = body?.origin;
  if (!name || !phoneRaw) {
    return json({ error: 'name e phone são obrigatórios' }, 400);
  }
  if (!MANUAL_ORIGINS.includes(origin)) {
    return json({ error: `origin must be one of: ${MANUAL_ORIGINS.join(', ')}` }, 400);
  }

  const key = phoneMatchKey(phoneRaw);
  if (!key) return json({ error: 'telefone inválido' }, 400);

  // Mesma tabela pequena por cliente, mesma comparacao em JS que
  // claimManualContact() usa do lado do webhook - evita criar um segundo
  // registro pra alguem que ja tem contato (manual ou de WhatsApp real).
  const allContacts = await env.DB
    .prepare('SELECT wa_id, phone, status FROM whatsapp_contacts WHERE client_id = ?')
    .bind(client.id)
    .all();
  const dup = (allContacts.results || []).find(c => phoneMatchKey(c.phone) === key);
  if (dup) {
    return json({ error: 'já existe um contato com esse telefone neste cliente', wa_id: dup.wa_id, status: dup.status }, 409);
  }

  const phone = normalizePhone(phoneRaw);
  const waId = `${phone}@manual.local`;
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(`
      INSERT INTO whatsapp_contacts (
        client_id, wa_id, phone, push_name, is_ctwa, ad_platform,
        first_message_text, first_message_at, status, created_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'lead', 'manual', ?, ?)
    `)
    .bind(client.id, waId, phone, name, origin, 'Lead criado manualmente', now, now, now)
    .run();

  return json({ ok: true, wa_id: waId });
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
