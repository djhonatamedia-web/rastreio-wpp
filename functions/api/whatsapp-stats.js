// GET /api/whatsapp-stats?key=...
//
// Dashboard "Visão Geral" tab — funil (anúncios vs orgânico), evolução
// diária e quebra por anúncio. Read-only, mesmo padrão de auth por query
// string dos outros GETs (whatsapp-contacts.js, whatsapp-events.js).
//
// "Funil" aqui trata o campo `status` de whatsapp_contacts como o estágio
// mais avançado já alcançado (lead < qualified < scheduled < sale), não
// como histórico de transições — é o mesmo modelo que os botões do
// dashboard já usam. `lost` é contado à parte, não drena o funil.

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

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
      GROUP BY is_ctwa
    `).all();

    const leadsPerDay = await env.DB.prepare(`
      SELECT date(created_at, 'unixepoch') as day, COUNT(*) as leads
      FROM whatsapp_contacts
      GROUP BY day
      ORDER BY day
    `).all();

    const stagesPerDay = await env.DB.prepare(`
      SELECT date(created_at, 'unixepoch') as day, event_name, COUNT(DISTINCT wa_id) as count
      FROM whatsapp_events
      WHERE event_name IN ('QualifiedLead', 'Schedule', 'Purchase')
      GROUP BY day, event_name
      ORDER BY day
    `).all();

    const byAd = await env.DB.prepare(`
      SELECT
        ad_source_id, ad_headline, ad_thumbnail_url, ad_source_url,
        COUNT(*) as leads,
        SUM(CASE WHEN status IN ('qualified','scheduled','sale') THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN status = 'sale' THEN 1 ELSE 0 END) as sale
      FROM whatsapp_contacts
      WHERE is_ctwa = 1 AND ad_source_id IS NOT NULL
      GROUP BY ad_source_id
      ORDER BY leads DESC
      LIMIT 20
    `).all();

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
