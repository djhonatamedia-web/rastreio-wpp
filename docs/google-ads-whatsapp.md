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
