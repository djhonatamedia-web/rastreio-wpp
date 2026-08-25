# Rastreio WPP

> Anchor file for Claude Code sessions in this repo. Keep it scannable —
> detail lives in `docs/`. Full domain knowledge (payload formats, bug
> history, onboarding playbook) lives in the `agente-tracker` global
> agent — invoke it for anything beyond a quick lookup here.

## O que este repo é

Cloudflare Pages + D1 pra rastrear anúncios que terminam numa conversa de
WhatsApp e devolver o estágio do funil (lead → qualificado → agendado →
venda) como conversão pro anúncio otimizar.

- **Meta Ads CTWA**: `ctwa_clid` vem embutido na própria mensagem —
  `message.content.contextInfo.externalAdReply.ctwaClid`.
- **Google Ads**: sem "Clique para o WhatsApp" nativo — ponte via landing
  page + código na mensagem (`docs/google-ads-whatsapp.md`).
- **Funil automático**: por palavra-chave do atendente
  (`docs/funil-por-palavra-chave.md`), além do clique manual no dashboard.

Template reutilizável, espírito do `krob-tracking-stack-main` (projeto
irmão) — cada cliente roda sua própria implantação isolada, sem backend
compartilhado.

## Regras (não violar)

- **Nunca commitar secrets.** Só `wrangler.toml.example` é versionado.
- **SQL sempre parametrizado** (`.bind()`, nunca interpolação).
- **Hash de PII antes de mandar pra Meta** (`functions/_shared/hashing.js`);
  `ctwa_clid` é exceção, vai SEM hash.
- **`whatsapp_contacts` é a única tabela mutável**; todo o resto é append-only.
- **Adapter fino, core gordo**: `[slug].js` só valida o slug e delega;
  nunca branching de provider em `_whatsapp-core.js`.
- **Mudança de estágio SEMPRE via `applyStageTransition()`** — nunca
  chamar o CAPI direto, senão perde a guarda contra reenvio duplicado.
- **`POST /api/whatsapp-status` autentica por header `x-dash-key`**,
  nunca query string.
- **IDs não-secretos (Pixel/Page/Customer/Conversion Action) podem ir
  pro D1 via aba "Configurações"; credenciais reais nunca** — ver
  `docs/client-config.md`.

## Mapa de arquivos

| Path | Função |
|---|---|
| `functions/webhook/whatsapp/[slug].js` | Adapter — gate de slug, delega pro core |
| `functions/webhook/_whatsapp-core.js` | Parsing do payload uazapi, upsert de contato, atribuição |
| `functions/webhook/_whatsapp-capi.js` | Envia evento `business_messaging` pra Meta |
| `functions/_shared/google-ads-capi.js` | Envia conversão pro Google Ads (`uploadClickConversions`) |
| `functions/_shared/stage-transition.js` | `applyStageTransition()` — único caminho pra mudar estágio |
| `functions/_shared/text-normalize.js` | `normalize()` — usado no match de palavra-chave |
| `functions/_shared/client-config.js` | IDs não-secretos, fallback D1 → env var |
| `functions/_shared/hashing.js` | `sha256`/`normalizePhone`/`normalizeName` |
| `functions/api/whatsapp-contacts.js` | GET — aba "Conversas" |
| `functions/api/whatsapp-events.js` | GET — aba "Eventos" (log cru) |
| `functions/api/whatsapp-status.js` | POST — marcar estágio manualmente |
| `functions/api/whatsapp-stats.js` | GET — aba "Visão Geral" |
| `functions/api/whatsapp-keywords.js` | GET/POST/DELETE — aba "Palavras-chave" |
| `functions/api/config.js` | GET/POST/DELETE — aba "Configurações" |
| `functions/api/track-click.js` | POST público — captura `gclid`/`gbraid`/`wbraid` de landing page |
| `config/whatsapp.js` | Mapas estágio→evento, status válidos, palavras-chave, Google Ads |
| `migrations/0001-0005` | Schema D1, em ordem (ver nomes dos arquivos) |
| `dash/index.html` | Dashboard single-file (Tailwind CDN, sem build) |

## Deep reference

| Pra... | Leia |
|---|---|
| Payload real do uazapi, campo por campo | `docs/payload-uazapi.md` |
| Formato do Meta CAPI business_messaging | `docs/capi-whatsapp.md` |
| Ponte gclid → WhatsApp (Google Ads) | `docs/google-ads-whatsapp.md` |
| Funil automático por palavra-chave | `docs/funil-por-palavra-chave.md` |
| Por que IDs vão pro D1 e credenciais não | `docs/client-config.md` |

## Contas desta implantação

- Business Manager: `6389242864429840`
- Página Facebook: `117717244686928` (→ `META_PAGE_ID`)
- Conta de anúncios: `794250765458053`
- uazapi: `https://djhonata.uazapi.com`
