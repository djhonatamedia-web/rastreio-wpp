# Multi-tenant

Uma implantação (Cloudflare Pages + D1) atende vários clientes. Cada linha
de cada tabela pertence a um `client_id` (tabela `clients`) — ver
`functions/_shared/clients.js`.

## Por que não uma implantação por cliente

O usuário é gestor de tráfego com vários clientes (cada um com BM, conta de
anúncios, Pixel e número de WhatsApp próprios). Multiplicar Cloudflare
Pages + D1 por cliente significa multiplicar deploy/manutenção pra cada
cliente novo. Como a arquitetura já isolava por slug (webhook) e já
separava config não-secreta de credencial real (`client_config`), a
extensão natural foi generalizar isso de "por implantação" pra "por
cliente dentro da mesma implantação" — ver migration `0006_multi_tenant.sql`.

## Onde fica cada coisa

- **Identidade do cliente** (`clients`): nome, `slug` (usado na URL do
  dashboard e como prefixo de env var), `webhook_slug` (UUID único, URL do
  webhook uazapi desse cliente).
- **Dados do cliente** (`whatsapp_contacts`, `whatsapp_events`,
  `stage_keywords`, `ad_click_codes`): todas ganharam `client_id`, toda
  query no código filtra por ele.
- **IDs não-secretos** (Pixel ID, Page ID, Customer ID, Conversion Action
  ids): `client_config`, chave composta `(client_id, key)`, editável pela
  aba "Configurações" com o cliente selecionado.
- **Credenciais reais** (token de acesso Meta, OAuth client id/secret,
  refresh token e developer token do Google Ads): **nunca no D1** — ficam
  em variável de ambiente do Cloudflare Pages, com prefixo do slug do
  cliente em maiúsculo. Ex.: cliente `tintim` → `TINTIM_META_ACCESS_TOKEN`,
  `TINTIM_GOOGLE_ADS_REFRESH_TOKEN`. Resolvido por `getClientSecret()` em
  `functions/_shared/clients.js`, que cai pro nome sem prefixo
  (`env.META_ACCESS_TOKEN`) se o prefixado não existir — é assim que o
  cliente 1 (criado antes do multi-tenant) continua funcionando sem
  renomear nada.

## Onboarding de cliente novo

1. Dashboard → aba "Clientes" → criar (nome + slug). Gera um
   `webhook_slug` novo.
2. Colar a URL de webhook mostrada na uazapi desse cliente.
3. Criar no Cloudflare Pages as secrets prefixadas que esse cliente
   precisar: `<SLUG>_META_ACCESS_TOKEN` (Meta) e/ou
   `<SLUG>_GOOGLE_ADS_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` /
   `_DEVELOPER_TOKEN` (Google Ads).
4. Dashboard → aba "Configurações", com esse cliente selecionado →
   preencher Pixel ID / Page ID / Customer ID / Conversion Actions.
5. Selecionar o cliente no seletor do topo do dashboard pra ver os dados
   dele.

## Isolamento

Um `DASH_KEY` só, agência inteira — quem tem a chave vê/edita qualquer
cliente pelo seletor. Não há hoje uma segunda camada de permissão por
cliente (ex.: dar acesso a um funcionário só pros dados de um cliente) —
se precisar disso no futuro é uma discussão de auth separada, não coberta
aqui.
