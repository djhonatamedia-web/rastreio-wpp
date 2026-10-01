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

    // Quebra por canal real de aquisição (Meta / Google Ads / Instagram /
    // bio / GMB / etc, além de "organico") - complementa o funil acima,
    // que só separa Meta (is_ctwa) do resto. `ad_platform` já vem
    // resolvido por functions/webhook/_whatsapp-core.js (platformFor()).
    const byChannel = await env.DB.prepare(`
      SELECT
        CASE WHEN is_ctwa = 1 THEN 'meta' ELSE COALESCE(ad_platform, 'organico') END as channel,
        COUNT(*) as leads,
        SUM(CASE WHEN status IN ('qualified','scheduled','sale') THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN status IN ('scheduled','sale') THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale
      FROM whatsapp_contacts
      WHERE client_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY channel
      ORDER BY leads DESC
    `).bind(client.id, from, to).all();

    // Saúde do rastreio: quantos cliques capturados (ad_click_codes)
    // realmente viraram uma conversa (matched_wa_id). Uma taxa baixa é o
    // sinal de que a ponte LP -> WhatsApp quebrou silenciosamente - foi
    // assim que dois bugs reais (href com target=_blank, coluna `channel`
    // faltando) passaram despercebidos por dias em 2026-09.
    const clickHealthRow = await env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN matched_wa_id IS NOT NULL THEN 1 ELSE 0 END) as matched
      FROM ad_click_codes
      WHERE client_id = ? AND created_at >= ? AND created_at <= ?
    `).bind(client.id, from, to).first();

    // Of the leads that came from a Meta ad (Click-to-WhatsApp OR landing
    // page), how many carry an id Meta can match a conversion back to
    // (ctwa_clid or fbc/fbp). The rest show up in the dashboard but their
    // funnel events can't be returned to the ad - see docs.
    const metaCoverageRow = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ctwa_clid IS NOT NULL OR fbc IS NOT NULL THEN 1 ELSE 0 END) as with_id
      FROM whatsapp_contacts
      WHERE client_id = ? AND (is_ctwa = 1 OR ad_platform = 'meta_site') AND created_at >= ? AND created_at <= ?
    `).bind(client.id, from, to).first();

    // Fechamentos e receita por canal. whatsapp_events ganha uma linha a cada
    // chamada de applyStageTransition (inclusive re-cliques), então soma-se
    // só a linha MAIS RECENTE de Purchase por contato - senão um "Venda"
    // clicado duas vezes contaria a receita em dobro. Janela por event_time
    // (a data real da venda, que uma importação pode informar).
    // payment_status/paid_amount (Bloco A3, migration 0011): `revenue`
    // continua sendo o total combinado (bruto), como sempre foi; `received`
    // e o que efetivamente entrou - integral se 'paid', so paid_amount se
    // 'partial', zero se 'pending'. `pending` é a diferença, calculada no JS
    // abaixo pra não repetir o CASE.
    const revenueRows = await env.DB.prepare(`
      SELECT
        CASE WHEN c.is_ctwa = 1 THEN 'meta' ELSE COALESCE(c.ad_platform, 'organico') END as channel,
        COUNT(*) as sales,
        SUM(COALESCE(e.value, 0)) as revenue,
        SUM(
          CASE
            WHEN e.payment_status = 'pending' THEN 0
            WHEN e.payment_status = 'partial' THEN COALESCE(e.paid_amount, 0)
            ELSE COALESCE(e.value, 0)
          END
        ) as received
      FROM whatsapp_events e
      JOIN whatsapp_contacts c ON c.wa_id = e.wa_id AND c.client_id = e.client_id
      WHERE e.id IN (
          SELECT MAX(id) FROM whatsapp_events
          WHERE client_id = ? AND event_name = 'Purchase' GROUP BY wa_id
        )
        AND e.event_time >= ? AND e.event_time <= ?
      GROUP BY channel
      ORDER BY revenue DESC
    `).bind(client.id, from, to).all();
    const revenueByChannel = (revenueRows.results || []).map(r => ({
      channel: r.channel, sales: r.sales, revenue: r.revenue || 0,
      received: r.received || 0, pending: (r.revenue || 0) - (r.received || 0),
    }));
    const revenueTotal = revenueByChannel.reduce((a, r) => a + r.revenue, 0);
    const receivedTotal = revenueByChannel.reduce((a, r) => a + r.received, 0);
    const salesTotal = revenueByChannel.reduce((a, r) => a + r.sales, 0);

    const timeseries = buildTimeseries(leadsPerDay.results || [], stagesPerDay.results || []);

    // Bloco A5: "média de crescimento" - mesma janela solicitada comparada
    // com a janela imediatamente anterior, de igual duração (ex.: últimos
    // 30 dias vs os 30 dias antes disso). `prevTo = from - 1` pra nunca
    // sobrepor um segundo com a janela atual.
    const windowSize = to - from;
    const prevFrom = from - windowSize - 1;
    const prevTo = from - 1;
    const growth = await buildGrowth(env, client.id, { from, to }, { from: prevFrom, to: prevTo });

    return json({
      funnel: {
        ads: pickFunnel(funnelRows.results, 1),
        organic: pickFunnel(funnelRows.results, 0),
      },
      timeseries,
      by_ad: byAd.results || [],
      by_channel: byChannel.results || [],
      click_health: { total: clickHealthRow?.total || 0, matched: clickHealthRow?.matched || 0 },
      meta_coverage: { total: metaCoverageRow?.total || 0, with_id: metaCoverageRow?.with_id || 0 },
      revenue: { sales: salesTotal, total: revenueTotal, received: receivedTotal, pending: revenueTotal - receivedTotal, by_channel: revenueByChannel },
      growth,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// Bloco A5: funil + receita recebida + compareceu/não-compareceu (via
// appointments, Bloco A2) pra janela atual e pra anterior, com a variação
// percentual pronta pro card "Crescimento" da Visão Geral.
async function buildGrowth(env, clientId, current, previous) {
  const [curFunnel, prevFunnel, curRevenue, prevRevenue, curAppts, prevAppts] = await Promise.all([
    growthFunnelRow(env, clientId, current),
    growthFunnelRow(env, clientId, previous),
    growthRevenueRow(env, clientId, current),
    growthRevenueRow(env, clientId, previous),
    growthAppointmentsRow(env, clientId, current),
    growthAppointmentsRow(env, clientId, previous),
  ]);

  return {
    leads: trend(curFunnel.total, prevFunnel.total),
    qualified: trend(curFunnel.qualified, prevFunnel.qualified),
    scheduled: trend(curFunnel.scheduled, prevFunnel.scheduled),
    sale: trend(curFunnel.sale, prevFunnel.sale),
    received: trend(curRevenue.received, prevRevenue.received),
    attended: trend(curAppts.attended, prevAppts.attended),
    no_show: trend(curAppts.no_show, prevAppts.no_show),
  };
}

async function growthFunnelRow(env, clientId, { from, to }) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('qualified','scheduled','sale') THEN 1 ELSE 0 END) as qualified,
      SUM(CASE WHEN status IN ('scheduled','sale') THEN 1 ELSE 0 END) as scheduled,
      SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale
    FROM whatsapp_contacts
    WHERE client_id = ? AND created_at >= ? AND created_at <= ?
  `).bind(clientId, from, to).first();
  return { total: row?.total || 0, qualified: row?.qualified || 0, scheduled: row?.scheduled || 0, sale: row?.sale || 0 };
}

async function growthRevenueRow(env, clientId, { from, to }) {
  const row = await env.DB.prepare(`
    SELECT SUM(
      CASE
        WHEN e.payment_status = 'pending' THEN 0
        WHEN e.payment_status = 'partial' THEN COALESCE(e.paid_amount, 0)
        ELSE COALESCE(e.value, 0)
      END
    ) as received
    FROM whatsapp_events e
    WHERE e.id IN (
        SELECT MAX(id) FROM whatsapp_events WHERE client_id = ? AND event_name = 'Purchase' GROUP BY wa_id
      )
      AND e.event_time >= ? AND e.event_time <= ?
  `).bind(clientId, from, to).first();
  return { received: row?.received || 0 };
}

async function growthAppointmentsRow(env, clientId, { from, to }) {
  const row = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN status = 'attended' THEN 1 ELSE 0 END) as attended,
      SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show
    FROM appointments
    WHERE client_id = ? AND scheduled_at >= ? AND scheduled_at <= ?
  `).bind(clientId, from, to).first();
  return { attended: row?.attended || 0, no_show: row?.no_show || 0 };
}

// null em variation_pct = "sem base de comparação" (período anterior
// zerado) - o frontend mostra "novo" em vez de uma % sem sentido (divisão
// por zero), nunca Infinity/NaN.
function trend(current, previous) {
  let variationPct = null;
  if (previous > 0) variationPct = Math.round(((current - previous) / previous) * 1000) / 10;
  else if (current === 0) variationPct = 0;
  return { current, previous, variation_pct: variationPct };
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
