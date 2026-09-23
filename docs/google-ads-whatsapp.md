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

## Snippet de referência (instalável via GTM, sem depender de id de botão)

Não depende de nenhum id específico de botão — escuta clique em
**qualquer link que aponte pra `wa.me` ou `api.whatsapp.com`** na
página, o que resolve o problema de "cada LP tem uma estrutura
diferente".

**Histórico de um bug já corrigido (Margel, 2026-09):** a primeira
versão reescrevia `link.href` diretamente no clique. Isso funcionou nos
nossos testes manuais, mas falhou silenciosamente em produção pra
cliques reais — confirmado via D1 (`ad_click_codes` tinha `gclid` real
capturado, mas `matched_wa_id` sempre nulo, e nenhuma mensagem real
chegava com `Ref:` no texto). Causa: os botões da LP usam
`target="_blank"` (abrem em nova aba) — nesse caso, vários navegadores
(principalmente no celular) já iniciam a navegação da nova aba com a
URL **original** antes do clique terminar de processar, então mudar
`link.href` no meio do caminho chega tarde demais pra afetar a aba que
já está abrindo. A versão abaixo evita isso: cancela a navegação padrão
(`preventDefault`) e abre a aba **nós mesmos**, já com a URL final
(`Ref:` incluído) — nunca deixa o navegador decidir sozinho com que URL
abrir.

```html
<script>
(function () {
  document.addEventListener('click', function (ev) {
    var link = ev.target.closest && ev.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    if (!link) return;

    // Lê os identificadores da URL crua (sem decodeURIComponent, pra não
    // alterar o valor exato que o Google/UTM gerou).
    var qs = location.search.slice(1);
    function rawParam(name) {
      var m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(qs);
      return m ? decodeURIComponent(m[1]) : '';
    }
    var gclid = rawParam('gclid'), gbraid = rawParam('gbraid'), wbraid = rawParam('wbraid');
    var utmSource = rawParam('utm_source'), utmMedium = rawParam('utm_medium'),
        utmCampaign = rawParam('utm_campaign'), utmContent = rawParam('utm_content'), utmTerm = rawParam('utm_term');
    if (!gclid && !gbraid && !wbraid && !utmSource) return; // sem nenhum sinal de origem, deixa o link como está

    var code = Array.from({ length: 6 }, function () {
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)];
    }).join('');

    fetch('https://rastreio-wpp.pages.dev/api/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: '<slug-do-cliente>', // mesmo slug da aba "Clientes" do dashboard
        code: code, gclid: gclid, gbraid: gbraid, wbraid: wbraid,
        utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign,
        utm_content: utmContent, utm_term: utmTerm, landing_url: location.href,
      }),
    }).catch(function () {}); // best-effort, não bloqueia a navegação

    // Cancela a navegação padrão e abrimos nós mesmos, com a URL final -
    // não confiar em mutar link.href a tempo (ver nota acima sobre
    // target="_blank").
    try {
      var url = new URL(link.href);
      var existingText = url.searchParams.get('text') || 'Olá! Vim pela página.';
      url.searchParams.set('text', existingText + ' Ref: ' + code);
      ev.preventDefault();
      window.open(url.toString(), '_blank', 'noopener');
    } catch (e) {}
  }, true); // fase de captura - roda antes de qualquer outro listener da página
})();
</script>
```

A única coisa que muda de cliente pra cliente é o `client: '<slug-do-cliente>'`. O número de WhatsApp **não** entra nesse script — ele só reescreve o link que já existe na página (preserva o texto pré-preenchido que já estava lá, só acrescenta `Ref: <código>` no final).

**Se algum navegador bloquear o `window.open`** (pop-up blocker, raro já que é síncrono dentro de um clique real de usuário, mas pode acontecer em alguns navegadores mais restritivos): o `try/catch` evita quebrar a página, mas o clique original não navega em lugar nenhum nesse caso raro. Se isso for observado em algum cliente, a alternativa é usar `location.href = url.toString()` (mesma aba) em vez de `window.open`, abrindo mão do "nova aba" - decidir caso a caso, não preventivamente.

## Configuração por cliente (não é código)

- **Data Manager API, sem Developer Token.** Pra integração nova o Google
  não libera mais o `uploadClickConversions` da Google Ads API (responde
  "New integrations for uploading click conversions should use the Data
  Manager API"), e o token de desenvolvedor foi encerrado em 2026-09-09.
  O envio vai por `POST datamanager.googleapis.com/v1/events:ingest`
  (ver `functions/_shared/google-ads-capi.js`). O nível de acesso é do
  projeto Google Cloud (nível "Explorador", aprovação automática, já
  libera contas de produção).
- **Ative a "Data Manager API"** no projeto Cloud (Biblioteca → Data
  Manager API → Ativar) e gere o Refresh Token com o scope
  `https://www.googleapis.com/auth/datamanager`. Um token gerado só com
  `.../auth/adwords` NÃO funciona nessa API.
- OAuth Client ID/Secret + Refresh Token (`GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`) e, no dashboard,
  `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (o MCC, quando
  a conta é acessada por gerente).
- **Publicar o app OAuth antes de gerar o Refresh Token.** Com a tela de
  consentimento em modo "Teste", o Google emite refresh token que expira
  em 7 dias (`refresh_token_expires_in: 604799`) e a integração para sem
  aviso. Publicado ("Google Auth Platform → Público-alvo → Publicar app"),
  não expira; o aviso de "app não verificado" no consentimento é esperado.
- **Gerar o Refresh Token uma vez só:** no OAuth Playground, copie o
  `refresh_token` logo na primeira troca do código. O código de
  autorização só serve uma vez (segunda tentativa dá `invalid_grant`), e
  refazer a autorização várias vezes seguidas dispara bloqueio de
  segurança do Google (aconteceu: 6 dias de espera).
- Criar um Conversion Action (tipo Importação/Clique) por estágio no
  Google Ads, e configurar o ID de cada um em
  `GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED` /
  `GOOGLE_ADS_CONVERSION_ACTION_SCHEDULE` /
  `GOOGLE_ADS_CONVERSION_ACTION_SALE` (ver `config/whatsapp.js`,
  `STAGE_TO_GOOGLE_ADS_ENV_VAR`).
- Colar o snippet acima na landing page e ajustar o seletor do botão.

## Ativação — Margel (2026-09)

1. Projeto Google Cloud com a **Data Manager API** ativada (e a Google Ads
   API, se for usar outros recursos). Sem Developer Token — ver acima.
2. OAuth Client ID/Secret + Refresh Token → Cloudflare Pages, como env
   vars prefixadas: `MARGEL_GOOGLE_ADS_CLIENT_ID`,
   `MARGEL_GOOGLE_ADS_CLIENT_SECRET`, `MARGEL_GOOGLE_ADS_REFRESH_TOKEN`
   (ver `getClientSecret()` em `functions/_shared/clients.js`).
3. Criar 3 Conversion Actions (Qualificado/Agendado/Venda) na conta do
   Margel e colar os IDs na aba "Configurações" do dashboard — junto com
   `GOOGLE_ADS_CUSTOMER_ID`/`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (não são
   secretos, não precisam ir pro Cloudflare).
4. Colar o snippet deste doc na landing page do Margel, com
   `client: 'margel'` e o número de WhatsApp dele no lugar de
   `<numero-do-cliente>`.
5. Antes de testar um clique real: `GET /api/client-status?key=<DASH_KEY>&client=margel`
   e conferir que os secrets do Google Ads aparecem como `prefixed`
   (não `fallback` — isso pegaria emprestado a credencial de outro
   cliente) e que os IDs de configuração estão presentes.

## Bridge por UTM (qualquer origem, não só Google Ads)

A mesma rota (`POST /api/track-click`) e o mesmo mecanismo `"Ref: <código>"`
já funcionam sem nenhum `gclid`/`gbraid`/`wbraid` — bastam os campos
`utm_*` da URL (o snippet acima já lê e manda todos). Serve pra qualquer
LP que recebe tráfego de várias origens (Instagram, e-mail, post
orgânico, etc.) e quer saber qual delas realmente virou conversa no
WhatsApp, não só o Google Ads.

Quando o código resolve sem nenhum `gclid`/`gbraid`/`wbraid`, o
`ad_platform` do contato vira o próprio `utm_source` em minúsculas (ex.:
`utm_source=Instagram` → `ad_platform = 'instagram'`) e os 5 campos UTM
completos ficam salvos no contato, visíveis no painel "Origem" do
dashboard. Assim como bio/GMB, **não gera envio de conversão** pra
nenhuma plataforma de anúncio — é atribuição só de dashboard, já que não
existe um `gclid` de verdade pra reportar de volta.

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

## Playbook: implementar num cliente novo

Validado ponta a ponta na Margel (2026-09). Repetir esta lista inteira
pra cada cliente novo — não precisa reinventar nada, só trocar os
valores marcados.

### 1. Instalar o script no GTM da LP do cliente

1. Confirmar o **slug** do cliente na aba "Clientes" do dashboard (ex.:
   `margel`).
2. No GTM do cliente → **Tags → Nova → HTML personalizado** → colar o
   snippet da seção acima, trocando só `client: '<slug-do-cliente>'`.
3. Acionador: **Todas as páginas** (ou "Inicialização - Todas as
   páginas").
4. Salvar, nomear a tag algo como `Rastreio WPP - Bridge UTM <cliente>`.
5. **Testar em modo de Pré-visualização** (Preview) antes de publicar:
   abrir a LP com `?utm_source=teste&utm_medium=teste` na URL, clicar no
   link do WhatsApp, e no DevTools (Network → filtro `Fetch/XHR` →
   digitar `track-click`) confirmar que a chamada aparece com **status
   200**. Inspecionar o link clicado e confirmar que o `href` ganhou
   `Ref: <código>` no final.
6. Só depois do teste passar: **Enviar → Publicar** o container.

### 2. Configurar UTM nas campanhas do Google Ads (se o cliente usar)

Usar a convenção fixa de nomenclatura (evita bagunça no painel depois):

| Canal | `utm_source` | `utm_medium` |
|---|---|---|
| Google Ads – Pesquisa | `google` | `cpc` |
| Google Ads – PMax | `google` | `pmax` |
| Instagram – bio | `instagram` | `bio` |
| Instagram – stories | `instagram` | `stories` |
| WhatsApp – status | `whatsapp` | `status` |
| Google Meu Negócio | `google` | `gmb` |

`utm_campaign` é o único campo livre — usar um nome curto e estável
(`pesquisa-<especialidade>`, `pmax-geral`), com data só quando for algo
pontual (`stories-set-2026`).

Em cada campanha do Google Ads: **Campanha → Configurações → Opções
adicionais → Opções de URL de campanha → Sufixo de URL final** (é a
nível de campanha, não de anúncio individual — evita ter que repetir por
anúncio). Colar, por exemplo:
```
utm_source=google&utm_medium=cpc&utm_campaign=pesquisa-<especialidade>
```
Clicar em **Testar** pra conferir a URL final simulada antes de salvar.
Se o cliente já tiver um "Modelo de rastreamento" configurado em algum
anúncio (tela de "Opções de URL do anúncio"), checar primeiro o que ele
já gera (botão "Testar" ali) antes de adicionar o sufixo de campanha, pra
não duplicar/conflitar parâmetros.

### 3. Taguear os canais orgânicos

Colar a UTM na hora de divulgar o link da LP (bio do Instagram, stories,
posts, status do WhatsApp, etc.), seguindo a mesma tabela do passo 2.
Exemplo pra bio:
```
https://<lp-do-cliente>/?utm_source=instagram&utm_medium=bio&utm_campaign=perfil
```

### 4. (Opcional) Ativar Google Ads CAPI — pra virar conversão de verdade, não só rótulo

Só necessário se o cliente também quiser que o WhatsApp otimize as
campanhas pagas dele (não é preciso pra UTM/bio/GMB, que são só
atribuição de dashboard). Ver "Configuração por cliente" e "Ativação —
Margel" acima — resumo: Developer Token + credenciais OAuth como env
vars prefixadas (`<SLUG>_GOOGLE_ADS_*`) + 3 Conversion Actions cadastrados
na aba Configurações + `GET /api/client-status?client=<slug>` pra
confirmar que os 4 secrets aparecem como `prefixed`, não `fallback`.

### 5. Validar no dashboard

Mandar uma mensagem de teste de cada origem configurada (Google Ads,
Instagram, etc.) e conferir na aba Conversas → abrir o contato → seção
"Origem" que o rótulo e os campos UTM aparecem certos.
