# Meta Conversions API — eventos de WhatsApp (CTWA)

Referência de formato para eventos `business_messaging`, usados por
`functions/webhook/_whatsapp-capi.js`. Confirmado via documentação/pesquisa
pública em 2026-08-03 — validar contra a resposta real do Events Manager na
Fase 0 antes de considerar 100% travado (especialmente qual ID usar como
`{PIXEL_ID}` no endpoint).

## Diferença em relação a um evento normal de site

Um evento CAPI normal (Purchase de uma sales page, por exemplo) usa
`action_source: "website"` e se atribui via `fbc`/`fbp`/`external_id`. Um
evento de WhatsApp usa `action_source: "business_messaging"` +
`messaging_channel: "whatsapp"`, e se atribui via `ctwa_clid` — o id que a
Meta embute no clique do anúncio "Clique para o WhatsApp" e que (se o gateway
repassar corretamente) aparece no contexto da primeira mensagem recebida.

## Payload

```json
{
  "data": [{
    "event_name": "Lead",
    "event_time": 1675999999,
    "event_id": "<uuid, dedup>",
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "page_id": "117717244686928",
      "ctwa_clid": "<string bruta, SEM hash>",
      "ph": ["<sha256 do telefone, opcional>"]
    },
    "custom_data": { "currency": "BRL", "value": 123 }
  }]
}
```

Enviado para `https://graph.facebook.com/v25.0/{META_PIXEL_ID}/events?access_token={META_ACCESS_TOKEN}`
— mesmo endpoint usado pelo `krob-tracking-stack-main` pra Purchase de site.
`META_PIXEL_ID` precisa estar vinculado à Página/WhatsApp Business Account
no Events Manager pra Meta aceitar o evento como atribuível.

## Sem `ctwa_clid`, não faz sentido enviar

Meta não consegue atribuir o evento a nenhum anúncio sem esse campo — por
isso `sendWhatsAppEventToMeta()` retorna `{ skipped }` em vez de mandar um
evento "solto" que não ajuda em nada e só suja o Events Manager.

## Estágios do funil → nome do evento

Ver `config/whatsapp.js` (`STAGE_TO_META_EVENT`):

| Estágio no dashboard | `event_name` enviado |
|---|---|
| Lead (automático, primeira mensagem) | `Lead` |
| Qualificado | `QualifiedLead` |
| Agendado | `Schedule` |
| Venda | `Purchase` (com `custom_data.value`) |
| Perdido | nenhum — só status interno |
