// GET  /api/ad-spend?client=<slug>                 - últimos 12 meses digitados
// POST /api/ad-spend { client, period, amount }     - grava/atualiza um mês
//
// Investimento em anúncios, digitado à mão (não existe integração com a API
// de insights do Meta/Google Ads neste projeto - ver migrations/0015).
// Só admin mexe, mesmo padrão de functions/api/config.js.

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, jsonUnauthorized } from '../_shared/auth.js';

const PERIOD_RE = /^\d{4}-\d{2}$/;

async function requireAdmin(request, env) {
  const session = await requireSession(request, env);
  return session && session.role === 'admin' ? session : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request, env))) return jsonUnauthorized();

  const url = new URL(request.url);
  const client = await resolveClientBySlug(env, url.searchParams.get('client'));
  if (!client) return json({ error: 'client invalido ou nao informado' }, 400);

  const rows = await env.DB
    .prepare('SELECT period, amount FROM ad_spend WHERE client_id = ? ORDER BY period DESC LIMIT 12')
    .bind(client.id)
    .all();

  return json({ spend: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request, env))) return jsonUnauthorized();

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const client = await resolveClientBySlug(env, body?.client);
  if (!client) return json({ error: 'client invalido ou nao informado' }, 400);

  const period = String(body?.period || '');
  const amount = Number(body?.amount);
  if (!PERIOD_RE.test(period)) return json({ error: 'period deve ser YYYY-MM' }, 400);
  if (!Number.isFinite(amount) || amount < 0) return json({ error: 'amount inválido' }, 400);

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`
      INSERT INTO ad_spend (client_id, period, amount, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(client_id, period) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at
    `)
    .bind(client.id, period, amount, now)
    .run();

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
