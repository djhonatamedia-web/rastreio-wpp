# Por que alguns IDs vão pro dashboard e credenciais não

A aba "Configurações" do dashboard deixa editar `META_PIXEL_ID`,
`META_PAGE_ID`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` e
os três `GOOGLE_ADS_CONVERSION_ACTION_*` sem precisar entrar no painel do
Cloudflare Pages — útil pra configurar cliente novo mais rápido. Lista
completa em `EDITABLE_CONFIG_KEYS`, `functions/_shared/client-config.js`.

## Por que só esses e não `META_ACCESS_TOKEN` / credenciais do Google Ads

Esses IDs não dão acesso a nada sozinhos — saber o Pixel ID de alguém não
deixa você mandar evento em nome dele. Já `META_ACCESS_TOKEN`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` e
`GOOGLE_ADS_DEVELOPER_TOKEN` são credenciais reais — quem tiver isso
consegue agir como o cliente nas APIs da Meta/Google.

Um secret configurado como env var no Cloudflare Pages é criptografado e
**nunca pode ser lido de volta**, nem pelo próprio usuário. Se esses
tokens fossem pro D1 (pra aparecer num campo editável do dashboard), eles
virariam um dado legível — por uma query, por um backup do banco, por
qualquer bug futuro num endpoint. E hoje o `DASH_KEY` já é a única
credencial que protege todo o sistema; se ele vazar, o estrago hoje é
"alguém vê os leads". Se os tokens reais estivessem no D1, o mesmo
vazamento viraria "alguém consegue mandar eventos/gastar como o cliente
nas contas de anúncio dele" — uma categoria de dano bem maior.

**Regra prática**: se o dado, sozinho, permite fazer uma chamada de API
autenticada em nome do cliente, ele é credencial e fica só no Cloudflare
env var. Se é só um identificador (Pixel ID, Page ID, Customer ID,
Conversion Action ID), pode ir pro D1/dashboard.

## Como funciona o fallback

`getConfigValues(env, keys)` (`functions/_shared/client-config.js`) olha
primeiro a tabela `client_config` no D1; se a chave não estiver lá (ou
`migrations/0005_client_config.sql` ainda não rodou), cai pro `env[key]`
do Cloudflare. Isso significa que uma implantação existente, com tudo só
em env var, continua funcionando sem nenhuma mudança — a aba
"Configurações" é opcional, não obrigatória.
