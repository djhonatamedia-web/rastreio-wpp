// GET /api/reports?client=<slug>&from=<unix>&to=<unix>
//
// Dashboard "Relatórios" (Bloco G): KPIs de gestão que o funil/Visão Geral
// não respondem - custo por paciente, retorno dos anúncios, ticket médio,
// tempo até agendar, taxa de comparecimento. Reaproveita as mesmas tabelas
// de functions/api/whatsapp-stats.js (nenhuma tabela nova além de
// `ad_spend`, que é só o investimento digitado à mão - ver migrations/0015).
//
// "Investido" na janela = soma de ad_spend cujo período (mês) cai dentro
// de [from, to]; é uma aproximação por mês, não um prorateio por dia - um
// cliente que só preenche o mês corrente já tem leitura útil assim que
// entra na tela.

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await requireSession(request, env);
  if (!session) return jsonUnauthorized();

  const url = new URL(request.url);
  const client = await resolveClientBySlug(env, url.searchParams.get('client'));
  if (!client) return json({ error: 'client invalido ou nao informado' }, 400);
  if (!assertClientAccess(session, client)) return jsonForbidden();

  const now = Math.floor(Date.now() / 1000);
  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const from = clampInt(url.searchParams.get('from'), now - days * 86400, 0, now);
  const to = clampInt(url.searchParams.get('to'), now, from, now);

  try {
    const leadsRow = await env.DB.prepare(`
      SELECT COUNT(*) as total FROM whatsapp_contacts WHERE client_id = ? AND created_at >= ? AND created_at <= ?
    `).bind(client.id, from, to).first();
    const totalLeads = leadsRow?.total || 0;

    // Receita confirmada na janela (mesma regra de whatsapp-stats.js: só a
    // linha mais recente de Purchase por contato, por event_time).
    const revenueRow = await env.DB.prepare(`
      SELECT
        COUNT(*) as sales,
        SUM(COALESCE(e.value, 0)) as revenue,
        SUM(CASE WHEN e.payment_status = 'pending' THEN 0 WHEN e.payment_status = 'partial' THEN COALESCE(e.paid_amount, 0) ELSE COALESCE(e.value, 0) END) as received
      FROM whatsapp_events e
      WHERE e.id IN (SELECT MAX(id) FROM whatsapp_events WHERE client_id = ? AND event_name = 'Purchase' GROUP BY wa_id)
        AND e.event_time >= ? AND e.event_time <= ?
    `).bind(client.id, from, to).first();
    const sales = revenueRow?.sales || 0;
    const revenue = revenueRow?.revenue || 0;
    const received = revenueRow?.received || 0;

    // Tempo médio até agendar: do primeiro evento "Schedule" de cada
    // contato até a criação do contato - só contatos criados na janela,
    // pra não misturar um lead antigo que só agendou agora.
    const scheduleTimeRow = await env.DB.prepare(`
      SELECT AVG(s.first_schedule_at - c.created_at) as avg_seconds
      FROM whatsapp_contacts c
      JOIN (
        SELECT wa_id, MIN(created_at) as first_schedule_at
        FROM whatsapp_events WHERE client_id = ? AND event_name = 'Schedule'
        GROUP BY wa_id
      ) s ON s.wa_id = c.wa_id
      WHERE c.client_id = ? AND c.created_at >= ? AND c.created_at <= ?
    `).bind(client.id, client.id, from, to).first();
    const avgScheduleSeconds = scheduleTimeRow?.avg_seconds || null;

    // Comparecimento: appointments cuja data cai na janela.
    const apptRow = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status = 'attended' THEN 1 ELSE 0 END) as attended,
        SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show
      FROM appointments WHERE client_id = ? AND scheduled_at >= ? AND scheduled_at <= ?
    `).bind(client.id, from, to).first();
    const attended = apptRow?.attended || 0;
    const noShow = apptRow?.no_show || 0;
    const attendanceTotal = attended + noShow;

    // Investimento: soma dos meses (YYYY-MM) cujo 1º dia cai dentro da
    // janela - aproximação simples, documentada no topo do arquivo.
    const spendRows = await env.DB.prepare(`SELECT period, amount FROM ad_spend WHERE client_id = ?`).bind(client.id).all();
    const fromMonth = monthKey(from);
    const toMonth = monthKey(to);
    const spend = (spendRows.results || [])
      .filter(r => r.period >= fromMonth && r.period <= toMonth)
      .reduce((acc, r) => acc + (r.amount || 0), 0);

    const byChannel = await env.DB.prepare(`
      SELECT
        CASE WHEN is_ctwa = 1 THEN 'meta' ELSE COALESCE(ad_platform, 'organico') END as channel,
        COUNT(*) as leads,
        SUM(CASE WHEN status IN ('scheduled','sale') THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale
      FROM whatsapp_contacts
      WHERE client_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY channel ORDER BY leads DESC
    `).bind(client.id, from, to).all();

    return json({
      leads: totalLeads,
      sales,
      revenue,
      received,
      spend,
      cost_per_lead: spend > 0 && totalLeads > 0 ? round2(spend / totalLeads) : null,
      roas: spend > 0 ? round2(received / spend) : null,
      avg_ticket: sales > 0 ? round2(revenue / sales) : null,
      avg_schedule_days: avgScheduleSeconds != null ? round2(avgScheduleSeconds / 86400) : null,
      attendance: {
        attended, no_show: noShow,
        rate_pct: attendanceTotal > 0 ? round2((attended / attendanceTotal) * 100) : null,
      },
      by_channel: byChannel.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function monthKey(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
