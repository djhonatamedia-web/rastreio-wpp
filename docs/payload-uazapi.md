# Payload do webhook uazapi — a preencher na Fase 0

**Status: NÃO CONFIRMADO.** Este documento existe pra ser preenchido com o
payload REAL capturado no primeiro teste end-to-end (ver plano — Fase 0).
Enquanto não for preenchido, `functions/webhook/_whatsapp-core.js` funciona
com extração best-effort marcada como `FASE 0 GUESS` nos comentários — o
`raw_payload` bruto é sempre gravado em `whatsapp_events`, então nada se
perde mesmo se as suposições abaixo estiverem erradas.

## Como preencher isto

1. Rodar a migration e fazer o deploy mínimo (adapter + D1).
2. Configurar o webhook no painel do uazapi (`https://djhonata.uazapi.com`)
   apontando pra `/webhook/whatsapp/<WHATSAPP_WEBHOOK_SLUG>`.
3. Criar uma campanha real "Clique para o WhatsApp" (orçamento baixo) na
   conta `794250765458053`, vinculada à Página `117717244686928`.
4. Clicar no anúncio de um número real, mandar uma mensagem.
5. `wrangler d1 execute --remote --command "SELECT raw_payload FROM whatsapp_events ORDER BY id DESC LIMIT 1"`
6. Colar o JSON (redigindo dados pessoais sensíveis se necessário) na seção abaixo.
7. Corrigir `extractMessage()` em `_whatsapp-core.js` pra bater com a realidade.

## Payload capturado (colar aqui)

```json
(ainda não capturado)
```

## Mapeamento de campos (preencher após o passo 6)

| Campo normalizado | Caminho no JSON real | Observação |
|---|---|---|
| `waId` | ? | |
| `phone` | ? | |
| `isGroup` | ? | |
| `fromMe` | ? | |
| `pushName` | ? | |
| `messageType` | ? | |
| `text` | ? | |
| `timestamp` | ? | |
| `ctwaClid` | ? | campo mais crítico — confirma ou derruba o Caminho A |
| `adSourceId` | ? | |
| `adHeadline` | ? | |
| `adSourceUrl` | ? | |
| `adMediaType` | ? | |

## Resultado do gate de decisão

- [ ] `ctwa_clid` presente → seguir com fan-out CAPI automático (já implementado, só ajustar `extractMessage`).
- [ ] `ctwa_clid` ausente → documentar como limitação conhecida; dashboard/qualificação seguem funcionando, envio automático ao Meta fica bloqueado até resolver (via uazapi ou migração pra API oficial).
