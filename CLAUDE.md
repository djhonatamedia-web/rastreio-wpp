# Rastreio WPP

> Anchor file for Claude Code sessions in this repo. Keep it scannable —
> detail lives in `docs/`.

## O que este repo é

Um stack de rastreamento Cloudflare Pages + D1 pra campanhas Meta Ads
"Clique para o WhatsApp" (CTWA). Recebe webhooks do uazapi (gateway
WhatsApp não-oficial, baseado em Baileys, conectado via QR code), guarda
cada mensagem/conversa, deixa marcar manualmente o estágio de cada contato
(lead → qualificado → agendado → venda) num dashboard, e devolve cada
transição pro Meta Conversions API (`action_source: business_messaging`)
pra que a entrega do anúncio otimize em direção a conversas que viram
negócio de verdade.

Espírito de template reutilizável, igual ao `krob-tracking-stack-main`
(projeto irmão, no mesmo workspace) — cada implantação roda no próprio
Cloudflare account/D1 do cliente, sem backend compartilhado.

## Status atual: Fase 0 fechada — ver `docs/payload-uazapi.md`

O envelope real do webhook do uazapi e o campo `ctwa_clid` **já foram
confirmados** contra leads reais da primeira campanha de teste. `ctwa_clid`
não vem em `message.track_id`/`track_source` (caminho morto) — vem em
`message.content.contextInfo.externalAdReply.ctwaClid`, o bloco de contexto
de anúncio do Baileys passado sem modificação pelo uazapi.
`extractMessage()` em `functions/webhook/_whatsapp-core.js` já extrai
daí — rastreamento, dashboard e fan-out automático pro Meta CAPI estão
todos operacionais.

## Identificador crítico

`ctwa_clid` — vem embutido no clique do anúncio. No payload do uazapi
aparece em `message.content.contextInfo.externalAdReply.ctwaClid` (não só
na primeira mensagem — visto também na resposta de WhatsApp Flow). Sem
ele, o evento CAPI não tem como ser atribuído a um anúncio, então não é
enviado (ver `docs/capi-whatsapp.md` e `docs/payload-uazapi.md`).

## Regras (não violar)

- **Nunca commitar secrets.** `wrangler.toml`, `.dev.vars`, `.env*` são
  gitignored. Só `wrangler.toml.example` é versionado. `config/whatsapp.js`
  é versionado (não tem segredo, só mapeamento de estágio → evento).
- **SQL sempre parametrizado.** `.bind()` em toda query, nunca interpolação.
- **Hash de PII antes de mandar pra Meta.** Telefone via `sha256(normalizePhone(...))`
  de `functions/_shared/hashing.js`. `ctwa_clid` é a exceção — vai SEM hash,
  é assim que a Meta espera.
- **`whatsapp_contacts` é a única tabela mutável.** Todo o resto
  (`whatsapp_events`, e tudo no `krob-tracking-stack-main`) é append-only.
  Desvio deliberado — estágio de conversa é estado, não fato pontual.
- **Adapter fino, core gordo.** `functions/webhook/whatsapp/[slug].js` só
  guarda o slug e delega pra `_whatsapp-core.js`. Nunca adicionar lógica de
  parsing no adapter nem branching de provider no core.
- **`POST /api/whatsapp-status` autentica via header `x-dash-key`**, não
  query string — é o único endpoint mutável do dashboard, e uma chave em
  query string de POST vazaria em log de acesso.

## Mapa de arquivos

| Path | Função |
|---|---|
| `functions/webhook/whatsapp/[slug].js` | Adapter — gate de slug, delega pro core |
| `functions/webhook/_whatsapp-core.js` | Parsing do payload uazapi, upsert de contato, fan-out CAPI |
| `functions/webhook/_whatsapp-capi.js` | `sendWhatsAppEventToMeta()` — monta e envia o payload `business_messaging` |
| `functions/webhook/_utils.js` | `guardSlug`/`timingSafeEqual`, copiado do krob-tracking-stack-main |
| `functions/_shared/hashing.js` | `sha256`/`normalizePhone`/`normalizeName` |
| `functions/api/whatsapp-contacts.js` | GET — aba "Conversas" do dashboard |
| `functions/api/whatsapp-events.js` | GET — aba "Eventos" (log cru) |
| `functions/api/whatsapp-status.js` | POST — marcar estágio manualmente (via `applyStageTransition`) |
| `functions/api/whatsapp-stats.js` | GET — aba "Visão Geral" (funil, evolução diária, quebra por anúncio) |
| `functions/api/whatsapp-keywords.js` | GET/POST/DELETE — frases-gatilho da aba "Palavras-chave" |
| `functions/_shared/stage-transition.js` | `applyStageTransition()` — muda estágio + dispara CAPI, usado pelo endpoint manual e pelo gatilho por palavra-chave |
| `functions/_shared/text-normalize.js` | `normalize()` — minúsculas + sem acento, usado no match de palavra-chave |
| `config/whatsapp.js` | `STAGE_TO_META_EVENT`, `VALID_STATUSES`, `KEYWORD_STATUSES` |
| `migrations/0001_whatsapp.sql` | Schema D1 inicial |
| `migrations/0002_ad_thumbnail.sql` | Coluna `ad_thumbnail_url` (miniatura do criativo) |
| `migrations/0003_stage_keywords.sql` | Tabela `stage_keywords` + coluna `status_source` |
| `dash/index.html` | Dashboard single-file (Tailwind CDN, sem build) |
| `docs/payload-uazapi.md` | A preencher na Fase 0 |
| `docs/capi-whatsapp.md` | Referência do formato Meta CAPI business_messaging |

## Contas desta implantação

- Business Manager: `6389242864429840`
- Página Facebook: `117717244686928` (→ `META_PAGE_ID`)
- Conta de anúncios: `794250765458053`
- uazapi: `https://djhonata.uazapi.com`
