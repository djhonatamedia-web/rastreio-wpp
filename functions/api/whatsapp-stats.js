// GET /api/whatsapp-stats?key=...&client=<slug>&days=30
// GET /api/whatsapp-stats?key=...&client=<slug>&from=<unix>&to=<unix>
//
// Dashboard "Visao Geral" tab - funil (anuncios vs organico), evolucao
// diaria e quebra por anuncio, scoped to one client (see
// functions/_shared/clients.js).
//
// "Funil" aqui trata o campo `status` de whatsapp_contacts como o estagio
// mais avancado ja alcancado (lead < qualified < scheduled < sale), nao
// como historico de transicoes - e o mesmo modelo que os botoes do
// dashboard ja usam. `lost` e contado a parte, nao drena o funil.
//
// A janela [from, to] recorta por coorte: funil e "por anuncio" so contam
// contatos CRIADOS nela; a evolucao diaria e por atividade (eventos de
// mudanca de estagio contam no dia em que aconteceram, mesmo que o
// contato seja mais antigo que a janela) - e a leitura mais util pra um
// grafico "o que aconteceu por dia". `days` e so um atalho pra
// `from = agora - days*86400, to = agora`, usado pelos botoes 7/14/30/60d
// do dashboard; `from`/`to` explicitos (calendario "Personalizado")
// pisam nele quando presentes.

import { resolveClientBySlug } from '../_shared/clients.js';

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

  // `from`/`to` (unix seconds) permitem um intervalo personalizado a
  // partir do calendário do dashboard; sem eles, cai no atalho `days`
  // (comportamento antigo, sem limite superior explícito além de "agora").
  const now = Math.floor(Date.now() / 1000);
  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const from = clampInt(url.searchParams.get('from'), now - days * 86400, 0, now);
  const to = clampInt(url.searchParams.get('to'), now, from, now);

  try {
    const funnelRows = await env.DB.prepare(`
      SELECT
        is_ctwa,
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('qualified','scheduled','sale') THEN 1 ELSE 0 END) as qualified_plus,
        SUM(CASE WHEN status IN ('scheduled','sale') THEN 1 ELSE 0 END) as scheduled_plus,
        SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost
      FROM whatsapp_contacts
      WHERE client_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY is_ctwa
    `).bind(client.id, from, to).all();

    const leadsPerDay = await env.DB.prepare(`
      SELECT date(created_at, 'unixepoch') as day, COUNT(*) as leads
      FROM whatsapp_contacts
      WHERE client_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY day
      ORDER BY day
    `).bind(client.id, from, to).all();

    const stagesPerDay = await env.DB.prepare(`
      SELECT date(created_at, 'unixepoch') as day, event_name, COUNT(DISTINCT wa_id) as count
      FROM whatsapp_events
      WHERE client_id = ? AND event_name IN ('QualifiedLead', 'Schedule', 'Purchase') AND created_at >= ? AND created_at <= ?
      GROUP BY day, event_name
      ORDER BY day
    `).bind(client.id, from, to).all();

    const byAd = await env.DB.prepare(`
      SELECT
        ad_source_id, ad_headline, ad_thumbnail_url, ad_source_url,
        COUNT(*) as leads,
        SUM(CASE WHEN status IN ('qualified','scheduled','sale') THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale
      FROM whatsapp_contacts
      WHERE client_id = ? AND is_ctwa = 1 AND ad_source_id IS NOT NULL AND created_at >= ? AND created_at <= ?
      GROUP BY ad_source_id
      ORDER BY leads DESC
      LIMIT 20
    `).bind(client.id, from, to).all();

    const timeseries = buildTimeseries(leadsPerDay.results || [], stagesPerDay.results || []);

    return json({
      funnel: {
        ads: pickFunnel(funnelRows.results, 1),
        organic: pickFunnel(funnelRows.results, 0),
      },
      timeseries,
      by_ad: byAd.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function pickFunnel(rows, isCtwa) {
  const row = (rows || []).find(r => r.is_ctwa === isCtwa);
  if (!row) return { total: 0, qualified: 0, scheduled: 0, sale: 0, lost: 0 };
  return {
    total: row.total,
    qualified: row.qualified_plus,
    scheduled: row.scheduled_plus,
    sale: row.sale,
    lost: row.lost,
  };
}

function buildTimeseries(leadsPerDay, stagesPerDay) {
  const byDay = {};
  for (const row of leadsPerDay) {
    byDay[row.day] = { day: row.day, leads: row.leads, qualified: 0, scheduled: 0, sale: 0 };
  }
  const eventToKey = { QualifiedLead: 'qualified', Schedule: 'scheduled', Purchase: 'sale' };
  for (const row of stagesPerDay) {
    const key = eventToKey[row.event_name];
    if (!key) continue;
    if (!byDay[row.day]) byDay[row.day] = { day: row.day, leads: 0, qualified: 0, scheduled: 0, sale: 0 };
    byDay[row.day][key] = row.count;
  }
  return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
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
