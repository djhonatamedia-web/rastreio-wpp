# Funil dinâmico por palavra-chave

Alternativa ao clique manual no dashboard: quando o **atendente** (nunca o
lead) escreve uma frase cadastrada, o estágio do contato muda sozinho e o
evento correspondente é enviado à Meta — mesmo caminho que o botão manual
usaria (`applyStageTransition()` em `functions/_shared/stage-transition.js`).

## Por que não é IA

É comparação de texto determinística, sem custo e sem chamada externa.
`functions/_shared/text-normalize.js` deixa a mensagem e a frase cadastrada
em minúsculas e sem acento antes de comparar (`"Agendado com Sucesso!"`,
`"agendado com sucesso"` e `"AGÉNDADO COM SUCESSO"` são a mesma coisa pro
matcher). O match é por substring: se a frase cadastrada aparece em
qualquer lugar da mensagem, dispara.

## Por que só mensagens do atendente contam

Decisão explícita: uma frase parecida dita pelo *lead* nunca deveria
disparar — o lead não controla o funil, o atendente sim. O check roda em
`functions/webhook/_whatsapp-core.js`, só para mensagens com
`fromMe: true`.

## Onde as frases ficam

Na tabela `stage_keywords` (D1), gerenciada pela aba **"Palavras-chave"**
do dashboard — não em `config/whatsapp.js`. Motivo: esse repo é reaproveitado
pra clientes bem diferentes (uma clínica que agenda consulta, uma loja que
fecha venda), e a frase certa depende do negócio, não do código. Cada
implantação configura as suas próprias frases sem precisar de deploy.

`config/whatsapp.js` só guarda `KEYWORD_STATUSES` — quais estágios aceitam
gatilho por frase (`qualified`, `scheduled`, `sale`; não `lead` nem `lost`).

## Sem trava de "funil só anda pra frente"

Ao contrário de uma eventual classificação por IA (descartada nesta rodada,
ver plano em `C:\Users\Djhonata Filho\.claude\plans\`), o match por
palavra-chave não tem restrição de ordem — é tão determinístico e
intencional quanto clicar o botão, então se comporta exatamente como o
botão (pode até "retroceder" se o atendente digitar a frase de um estágio
anterior, embora isso não devesse acontecer na prática).

## Auditoria

Toda mudança por palavra-chave grava um evento em `whatsapp_events` (mesma
tabela dos cliques manuais, `source: 'webhook'` em vez de `'dashboard'`)
e atualiza `whatsapp_contacts.status_source` para `'keyword'` — a aba
Conversas mostra um badge "🔤 frase" quando foi assim que o estágio mudou,
pra diferenciar de um clique manual.
