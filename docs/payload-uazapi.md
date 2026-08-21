# Payload do webhook uazapi — Fase 0

**Status: envelope confirmado. `ctwa_clid` ainda não confirmado.**

O envelope abaixo foi recuperado de 49 webhooks reais já gravados em
produção (tráfego orgânico do WhatsApp conectado, capturado mesmo antes de
o `extractMessage()` saber reconhecê-lo — todo `raw_payload` é sempre
persistido, então nada se perdeu). `functions/webhook/_whatsapp-core.js` já
foi corrigido pra usar esse formato.

O que falta: nenhum dos 49 payloads capturados veio de um clique real em
anúncio "Clique para o WhatsApp" (são conversas orgânicas antigas). Assim
que a campanha real gerar a primeira mensagem vinda de um anúncio, repetir
o passo 5 abaixo pra achar o campo de atribuição (`ctwa_clid` ou
equivalente) e completar o gate de decisão.

## Como completar isto

1. ~~Rodar a migration e fazer o deploy mínimo~~ — feito.
2. ~~Configurar o webhook no painel do uazapi~~ — feito.
3. Criar/rodar a campanha real "Clique para o WhatsApp" (conta
   `794250765458053`, Página `117717244686928`).
4. Clicar no anúncio de um número real, mandar uma mensagem.
5. `GET /api/whatsapp-events?key=<DASH_KEY>` (ou consulta direta no D1 via
   Console do Cloudflare, já que não há acesso `wrangler` a esse banco —
   ver CLAUDE.md) e localizar o evento mais recente pra esse contato.
6. Colar o JSON (redigindo dados pessoais sensíveis) na seção abaixo,
   substituindo o exemplo genérico.
7. Se achar o campo de atribuição, atualizar `ctwaClid` em
   `extractMessage()` (`functions/webhook/_whatsapp-core.js`) pra
   extrair de lá, e marcar o gate de decisão abaixo.

## Payload capturado (formato confirmado, exemplo genérico — sem dados de anúncio ainda)

```json
{
  "BaseUrl": "https://djhonata.uazapi.com",
  "EventType": "messages",
  "instanceName": "...",
  "chatSource": "updated",
  "chat": {
    "id": "...",
    "name": "...",
    "phone": "+55 11 99991-0621",
    "lead_status": "",
    "lead_tags": []
  },
  "message": {
    "chatid": "5511999910621@s.whatsapp.net",
    "chatlid": "182364311425240@lid",
    "sender": "182364311425240@lid",
    "sender_pn": "5511999910621@s.whatsapp.net",
    "sender_lid": "182364311425240@lid",
    "senderName": "Nome do contato",
    "fromMe": false,
    "isGroup": false,
    "text": "texto da mensagem",
    "messageType": "Conversation",
    "mediaType": "",
    "messageTimestamp": 1787230820000,
    "source": "ios",
    "track_id": "",
    "track_source": "",
    "wasSentByApi": false,
    "buttonOrListid": "",
    "quoted": ""
  }
}
```

## Mapeamento de campos

| Campo normalizado | Caminho no JSON real | Observação |
|---|---|---|
| `waId` | `message.chatid` | Sempre o telefone real, mesmo quando `sender`/`chatlid` usam o novo formato `@lid` |
| `phone` | `message.chatid` sem o sufixo `@...` | |
| `isGroup` | `message.isGroup` | Booleano direto (fallback: sufixo `@g.us`) |
| `fromMe` | `message.fromMe` | Booleano direto no topo, não aninhado em `key` |
| `pushName` | `message.senderName` | |
| `messageType` | `message.messageType` | Strings tipo Baileys: `Conversation`, `ExtendedTextMessage`, `AudioMessage`, `TemplateMessage`, `PollUpdateMessage`, etc. |
| `text` | `message.text` | String plana, já extraída pelo uazapi (não precisa navegar `content.conversation`) |
| `timestamp` | `message.messageTimestamp` ÷ 1000 | **Vem em milissegundos**, não segundos |
| `ctwaClid` | **? — não confirmado** | Nenhum dos 49 payloads reais tinha esse campo ou `externalAdReplyInfo`. Candidatos a investigar no próximo teste: `message.track_id`, `message.track_source` (presentes mas vazios em tráfego orgânico) |
| `adSourceId`/`adHeadline`/`adSourceUrl`/`adMediaType` | **? — não confirmado** | Mesma pendência acima |

## Resultado do gate de decisão

- [ ] `ctwa_clid` (ou equivalente) presente → seguir com fan-out CAPI automático (lógica já implementada em `_whatsapp-capi.js`, só ajustar a extração em `extractMessage`).
- [ ] `ctwa_clid` ausente → documentar como limitação conhecida; dashboard/qualificação seguem funcionando, envio automático ao Meta fica bloqueado até resolver (via uazapi ou migração pra API oficial).
