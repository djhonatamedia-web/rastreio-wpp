# Atribuição de Google Ads pro WhatsApp

Google Ads não tem um formato "Clique para o WhatsApp" nativo — ao
contrário do Meta, o clique no anúncio não carrega nenhum contexto pra
dentro da mensagem do WhatsApp. Isso é uma limitação real do Google Ads,
não algo que falta configurar. A ponte usada aqui é o padrão de mercado
pra esse problema.

## Como funciona

```
Google Ads → landing page do cliente
   → JS da página lê gclid/gbraid/wbraid + UTMs da URL
   → gera um código curto (6 caracteres)
   → POST /api/track-click salva código → gclid nessa D1
   → botão do WhatsApp usa https://wa.me/<numero>?text=...Ref:%20<codigo>
   → lead manda a mensagem pré-preenchida
   → webhook uazapi acha "Ref: <codigo>" no texto, resolve o gclid
   → applyStageTransition() manda a conversão pro Google Ads (além do
     Meta, se o contato tiver ctwa_clid em vez de gclid)
```

`functions/_shared/google-ads-capi.js` é uma versão generalizada de
`sendToGoogleAds()` do `krob-tracking-stack-main` (por estágio do funil,
não por produto) — mesmas env vars, mesmo fluxo OAuth. Um cliente que já
tem o krob configurado com Google Ads pode reusar as mesmas credenciais.

## Limitação conhecida (não é bug)

Se o lead apagar ou editar o texto pré-preenchido antes de mandar, o
código se perde e a mensagem não casa com nenhum `ad_click_codes` — o
contato é criado normalmente, só sem atribuição Google (fica como
orgânico). Não tem como evitar isso com essa técnica; é a mesma categoria
de limitação de uma mensagem genuinamente orgânica não ter `ctwa_clid`.

Uma implantação só (`rastreio-wpp.pages.dev`) atende todos os clientes —
ver `docs/multi-tenant.md`. O snippet abaixo identifica de qual cliente é
o clique via `client` (o slug cadastrado na aba "Clientes" do dashboard),
do mesmo jeito que já hardcoda o número de WhatsApp daquele cliente no
botão.

## Snippet de referência pra landing page

```html
<script>
(function () {
  // Lê os identificadores da URL crua (sem decodeURIComponent, pra não
  // alterar o valor exato que o Google gerou).
  var qs = location.search.slice(1);
  function rawParam(name) {
    var m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(qs);
    return m ? m[1] : '';
  }
  var gclid = rawParam('gclid'), gbraid = rawParam('gbraid'), wbraid = rawParam('wbraid');
  if (!gclid && !gbraid && !wbraid) return; // tráfego não veio do Google Ads

  var code = Array.from({ length: 6 }, function () {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)];
  }).join('');

  fetch('https://rastreio-wpp.pages.dev/api/track-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: '<slug-do-cliente>', // mesmo slug da aba "Clientes" do dashboard
      code: code, gclid: gclid, gbraid: gbraid, wbraid: wbraid,
      utm_source: rawParam('utm_source'), utm_medium: rawParam('utm_medium'),
      utm_campaign: rawParam('utm_campaign'), utm_content: rawParam('utm_content'),
      utm_term: rawParam('utm_term'), landing_url: location.href,
    }),
  }).catch(function () {}); // best-effort, não bloqueia a página

  var link = document.getElementById('whatsapp-cta'); // ajuste o seletor
  if (link) {
    var msg = 'Olá! Vim pelo anúncio. Ref: ' + code;
    link.href = 'https://wa.me/<numero-do-cliente>?text=' + encodeURIComponent(msg);
  }
})();
</script>
```

## Configuração por cliente (não é código)

- Developer Token do Google Ads (aprovação da Google, por MCC).
- OAuth Client ID/Secret + Refresh Token — mesmas env vars do
  `krob-tracking-stack-main` (`GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`,
  `GOOGLE_ADS_DEVELOPER_TOKEN`) — reusar se for a mesma conta MCC.
- Criar um Conversion Action (tipo Importação/Clique) por estágio no
  Google Ads, e configurar o ID de cada um em
  `GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED` /
  `GOOGLE_ADS_CONVERSION_ACTION_SCHEDULE` /
  `GOOGLE_ADS_CONVERSION_ACTION_SALE` (ver `config/whatsapp.js`,
  `STAGE_TO_GOOGLE_ADS_ENV_VAR`).
- Colar o snippet acima na landing page e ajustar o seletor do botão.

## Ativação — Margel (2026-09)

1. Developer Token aprovado na conta MCC (aprovação da Google — fora do
   nosso controle, acompanhar no painel do Google Ads).
2. OAuth Client ID/Secret + Refresh Token → Cloudflare Pages, como env
   vars prefixadas: `MARGEL_GOOGLE_ADS_CLIENT_ID`,
   `MARGEL_GOOGLE_ADS_CLIENT_SECRET`, `MARGEL_GOOGLE_ADS_REFRESH_TOKEN`,
   `MARGEL_GOOGLE_ADS_DEVELOPER_TOKEN` (ver `getClientSecret()` em
   `functions/_shared/clients.js`).
3. Criar 3 Conversion Actions (Qualificado/Agendado/Venda) na conta do
   Margel e colar os IDs na aba "Configurações" do dashboard — junto com
   `GOOGLE_ADS_CUSTOMER_ID`/`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (não são
   secretos, não precisam ir pro Cloudflare).
4. Colar o snippet deste doc na landing page do Margel, com
   `client: 'margel'` e o número de WhatsApp dele no lugar de
   `<numero-do-cliente>`.
5. Antes de testar um clique real: `GET /api/client-status?key=<DASH_KEY>&client=margel`
   e conferir que os 4 secrets do Google Ads aparecem como `prefixed`
   (não `fallback` — isso pegaria emprestado a credencial de outro
   cliente) e que os IDs de configuração estão presentes.

## Canais fixos: bio, Google Meu Negócio (sem clique rastreável)

Link na bio do Instagram/TikTok e o perfil do Google Meu Negócio não têm
uma URL de anúncio gerando um `gclid` por clique — não são "cliques",
são um canal fixo. Pra esses casos existe uma variante mais simples do
mesmo mecanismo `"Ref: <código>"`: **um único código por canal**,
cadastrado uma vez pela aba "Configurações" → "Canais fixos" do
dashboard (endpoint `functions/api/channel-codes.js`), sem landing page
e sem JS.

O código fica em `ad_click_codes.channel` (`'bio'` ou `'gmb'`) em vez de
`gclid`/`gbraid`/`wbraid` — o webhook resolve exatamente pelo mesmo
regex, e o resultado aparece no contato como `ad_platform = 'bio'` ou
`'gmb'`. Sem `gclid`, `sendGoogleAdsConversion()` já pula sozinho
(não tem clique pra reportar) — essa atribuição é só pro dashboard, não
alimenta nenhuma plataforma de anúncio de volta.

Passo a passo: aba Configurações → "Canais fixos" → "Gerar código" →
copiar o link `wa.me` pronto (ou o texto `Ref: <código>`, se o número de
WhatsApp ainda não foi preenchido no campo acima) → colar na bio ou no
botão de WhatsApp do perfil do Google.
