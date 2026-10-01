// POST /api/contact-fields
// Body: { client, wa_id, birth_date?, insurance?, interest?, cpf?, address? }
//
// Bloco C1 do plano "Funil visual + ficha do paciente": os 5 campos que
// apareceram em todo concorrente de clinica pesquisado (convenio,
// procedimento de interesse, nascimento, CPF, endereco) - ver o plano
// pra por que NAO e um construtor de campos customizados. Endpoint
// separado de whatsapp-status.js de proposito: aquele e sobre TRANSICAO
// de estagio, este e sobre EDITAR o cadastro - dois conceitos diferentes
// que nao deveriam compartilhar validacao/autorizacao.
//
// Atualizacao parcial: so os campos presentes no body sao tocados (um
// `undefined` nao sobrescreve com NULL o que ja estava salvo).

import { resolveClientBySlug } from '../_shared/clients.js';
import { requireSession, assertClientAccess, jsonUnauthorized, jsonForbidden } from '../_shared/auth.js';

const FIELDS = ['birth_date', 'insurance', 'interest', 'cpf', 'address'];
const MAX_LEN = 300;

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
  if (!waId) return json({ error: 'wa_id é obrigatório' }, 400);

  const sets = [];
  const binds = [];
  for (const field of FIELDS) {
    if (body[field] === undefined) continue;
    const value = body[field] === null ? null : String(body[field]).trim().slice(0, MAX_LEN) || null;
    sets.push(`${field} = ?`);
    binds.push(value);
  }
  if (!sets.length) return json({ error: 'nenhum campo pra salvar' }, 400);

  const existing = await env.DB
    .prepare('SELECT wa_id FROM whatsapp_contacts WHERE client_id = ? AND wa_id = ?')
    .bind(client.id, waId)
    .first();
  if (!existing) return json({ error: 'contato não encontrado neste cliente' }, 404);

  binds.push(client.id, waId);
  await env.DB.prepare(`UPDATE whatsapp_contacts SET ${sets.join(', ')} WHERE client_id = ? AND wa_id = ?`).bind(...binds).run();

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
