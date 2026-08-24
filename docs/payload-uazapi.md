# Payload do webhook uazapi — Fase 0

**Status: FECHADA. Envelope confirmado, `ctwa_clid` confirmado.**

O envelope foi recuperado de 49 webhooks reais gravados em produção (tráfego
orgânico, capturado mesmo antes de o `extractMessage()` saber reconhecê-lo —
todo `raw_payload` é sempre persistido, então nada se perdeu).

`ctwa_clid` foi confirmado depois, contra 3 leads reais vindos da primeira
campanha "Clique para o WhatsApp" de teste (conta `794250765458053`, Página
`117717244686928`) — o campo existe, só não estava onde o primeiro chute
(baseado em Baileys puro) esperava: não é `message.track_id`/
`message.track_source` (esses ficaram vazios em toda mensagem, de anúncio
ou não — eram um caminho morto), e sim
`message.content.contextInfo.externalAdReply.ctwaClid`. `functions/webhook/_whatsapp-core.js`
já foi corrigido pra extrair de lá.

## Passos (todos concluídos)

1. ~~Rodar a migration e fazer o deploy mínimo~~ — feito.
2. ~~Configurar o webhook no painel do uazapi~~ — feito.
3. ~~Criar/rodar a campanha real~~ — feito, 3 leads reais capturados.
4. ~~Clicar no anúncio, mandar mensagem~~ — feito (3 pessoas diferentes).
5. ~~Inspecionar o payload real via `/api/whatsapp-events`~~ — feito.
6. ~~Colar o JSON e mapear os campos~~ — feito abaixo.
7. ~~Corrigir `extractMessage()`~~ — feito.

## Payload capturado (mensagem de anúncio real, dados sensíveis redigidos)

```json
{
  "BaseUrl": "https://djhonata.uazapi.com",
  "EventType": "messages",
  "instanceName": "whats-teste",
  "chatSource": "updated",
  "chat": { "phone": "556182044009", "wa_name": "Reibson", "lead_status": "", "lead_tags": [] },
  "message": {
    "chatid": "556182044009@s.whatsapp.net",
    "fromMe": false,
    "isGroup": false,
    "senderName": "Reibson",
    "text": "Olá! Posso ter mais informações sobre isso?",
    "messageType": "ExtendedTextMessage",
    "messageTimestamp": 1787515466000,
    "source": "android",
    "track_id": "",
    "track_source": "",
    "content": {
      "text": "Olá! Posso ter mais informações sobre isso?",
      "title": "Estou Online Agora 🟢",
      "description": "É só chamar e receber o material...",
      "contextInfo": {
        "conversionSource": "FB_Ads",
        "entryPointConversionSource": "ctwa_ad",
        "externalAdReply": {
          "title": "Estou Online Agora 🟢",
          "body": "É só chamar e receber o material...",
          "mediaType": 1,
          "sourceType": "ad",
          "sourceID": "120248173256020393",
          "sourceURL": "https://fb.me/dpuxXlHZj",
          "sourceApp": "facebook",
          "clickToWhatsappCall": true,
          "ctwaClid": "Afj8G_VXdsBJqPRMsX45t6ZBZI99Jr...(redigido)"
        }
      }
    }
  }
}
```

Confirmado em 3 leads reais diferentes (Reibson via Facebook, Kelen e Wagner
via Instagram) — o campo `contextInfo.externalAdReply` aparece dentro de
`content` tanto na primeira mensagem de texto (`ExtendedTextMessage`) quanto
na resposta do formulário WhatsApp Flow que a campanha usa
(`InteractiveResponseMessage`, com `flow_name: "Padrão CTWA_0afe7"` —
coleta Nome+Email antes do chat abrir). `sourceID` é o mesmo nas 3 (mesmo
anúncio); `sourceApp`/`sourceURL` variam por rede (Facebook vs Instagram).

## Mapeamento de campos

| Campo normalizado | Caminho no JSON real | Observação |
|---|---|---|
| `waId` | `message.chatid` | Sempre o telefone real, mesmo quando `sender`/`chatlid` usam o novo formato `@lid` |
| `phone` | `message.chatid` sem o sufixo `@...` | |
| `isGroup` | `message.isGroup` | Booleano direto (fallback: sufixo `@g.us`) |
| `fromMe` | `message.fromMe` | Booleano direto no topo, não aninhado em `key` |
| `pushName` | `message.senderName` | |
| `messageType` | `message.messageType` | Strings tipo Baileys: `Conversation`, `ExtendedTextMessage`, `AudioMessage`, `TemplateMessage`, `PollUpdateMessage`, `InteractiveResponseMessage`, etc. |
| `text` | `message.text` | String plana, já extraída pelo uazapi (não precisa navegar `content.conversation`) |
| `timestamp` | `message.messageTimestamp` ÷ 1000 | **Vem em milissegundos**, não segundos |
| `ctwaClid` | `message.content.contextInfo.externalAdReply.ctwaClid` | **Confirmado.** `message.track_id`/`track_source` eram um caminho morto — ficaram vazios até nos leads reais de anúncio. |
| `adSourceId` | `...externalAdReply.sourceID` | ID do anúncio no Meta (mesmo valor pras 3 mensagens de um mesmo anúncio) |
| `adHeadline` | `...externalAdReply.title` | Título/texto de destaque do criativo |
| `adSourceUrl` | `...externalAdReply.sourceURL` | Link do post do anúncio (Facebook ou Instagram) |
| `adMediaType` | `...externalAdReply.mediaType` | Numérico (ex.: `1`), guardado como string |

## Resultado do gate de decisão

- [x] `ctwa_clid` presente → fan-out CAPI automático segue o fluxo já implementado em `_whatsapp-capi.js`, extração corrigida em `extractMessage()` (`functions/webhook/_whatsapp-core.js`).
