// POST /api/sales-import
// Headers: x-dash-key: <DASH_KEY>
// Body: { "client": "<slug>", "rows": [{ "phone": "48991777444", "value": 350.5, "date": "2026-09-20" }, ...] }
//
// Brings CLOSINGS into the funnel. In a clinic the sale happens at the
// appointment, outside WhatsApp, so the dashboard's "Venda" stage stays empty
// (60 days, 2026-09-25: 1 sale across 4 clients, against ~50 scheduled). The
// clinic's own record (agenda / financeiro / a spreadsheet) has the truth, and
// the join key is the phone number.
//
// Each row is matched to a contact by phoneMatchKey() (DDD + last 8 digits, so
// a spreadsheet's "(48) 99177-7444" finds the jid 554891777444 either way) and
// pushed through applyStageTransition('sale') - the SAME path as the dashboard
// button, so it inherits the anti-duplicate guard and the send to Meta
// (ctwa_clid or fbc) and Google Ads (gclid) when the contact carries one.
//
// Capped per request: every row can fire two outbound calls, and Pages
// Functions limits subrequests per invocation. The dashboard sends batches.

import { timingSafeEqual } from '../webhook/_utils.js';
import { applyStageTransition } from '../_shared/stage-transition.js';
import { resolveClientBySlug } from '../_shared/clients.js';
import { phoneMatchKey } from '../_shared/hashing.js';

const MAX_ROWS_PER_REQUEST = 25;

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

  const client = await resolveClientBySlug(env, body.client);
  if (!client) {
    return json({ error: 'client invalido ou nao informado' }, 400);
  }
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: 'rows must be a non-empty array' }, 400);
  }
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return json({ error: `at most ${MAX_ROWS_PER_REQUEST} rows per request` }, 400);
  }

  const contacts = await env.DB
    .prepare('SELECT wa_id, phone, status, created_at FROM whatsapp_contacts WHERE client_id = ? ORDER BY created_at DESC')
    .bind(client.id)
    .all();
  const byKey = new Map();
  for (const c of contacts.results || []) {
    const key = phoneMatchKey(c.phone);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, c); // newest contact wins if a number appears twice
  }

  const now = Math.floor(Date.now() / 1000);
  const soldNow = new Set();
  const result = { sold: 0, already_sale: [], unmatched: [], invalid: [], sent_to_meta: 0, sent_to_google: 0 };

  for (const row of rows) {
    const key = phoneMatchKey(row?.phone);
    const value = Number(row?.value);
    if (!key || !Number.isFinite(value) || value < 0) {
      result.invalid.push({ phone: row?.phone ?? null, reason: !key ? 'telefone invalido' : 'valor invalido' });
      continue;
    }
    const contact = byKey.get(key);
    if (!contact) {
      result.unmatched.push({ phone: row.phone, reason: 'nenhum contato com esse telefone neste cliente' });
      continue;
    }
    // One Purchase per contact (the send guard is per event name) - a second
    // import of the same list must not double the revenue.
    if (contact.status === 'sale' || soldNow.has(contact.wa_id)) {
      result.already_sale.push({ phone: row.phone });
      continue;
    }

    const outcome = await applyStageTransition({
      env, client, waId: contact.wa_id, newStatus: 'sale', source: 'import',
      value, currency: 'BRL', occurredAt: parseDate(row?.date, now),
    });
    if (!outcome.ok) {
      result.unmatched.push({ phone: row.phone, reason: outcome.error });
      continue;
    }
    result.sold += 1;
    soldNow.add(contact.wa_id);
    if (/meta: sent/.test(outcome.capi)) result.sent_to_meta += 1;
    if (/google_ads: sent/.test(outcome.capi)) result.sent_to_google += 1;
  }

  return json({ ok: true, ...result });
}

// "2026-09-20" (or a unix number) -> unix seconds at noon Brasilia time.
// Anything unparseable or in the future falls back to "now".
function parseDate(raw, now) {
  if (raw == null || raw === '') return now;
  let t;
  if (typeof raw === 'number') t = raw > 1e12 ? Math.floor(raw / 1000) : raw;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) t = Math.floor(Date.parse(`${raw}T12:00:00-03:00`) / 1000);
  else t = Math.floor(Date.parse(String(raw)) / 1000);
  return Number.isFinite(t) && t > 0 && t <= now ? t : now;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
