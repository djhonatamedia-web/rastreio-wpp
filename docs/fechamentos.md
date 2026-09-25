# Fechamentos: trazer a venda pro funil

Em clínica a venda acontece **na consulta, fora do WhatsApp**. Medido em
2026-09-25 (60 dias): 1 "Venda" registrada em 4 clientes, contra ~50
"Agendado". Sem o fechamento, o dash não mostra receita e nenhuma plataforma
aprende com quem realmente pagou. A chave que une lead e fechamento é o
**telefone**.

## Como importar

Dashboard → Configurações (com o cliente certo selecionado) → **Importar
fechamentos**. Cole uma linha por paciente que atendeu e pagou:

```
telefone ; valor ; data
48991777444 ; 350,00 ; 20/09/2026
(48) 9177-7444 ; 1.200,00 ; 22/09/2026
```

- Separador `;` ou TAB (o que Excel/Planilhas copiam). Vírgula não: é o decimal.
- Data opcional (`dd/mm/aaaa`); sem ela vale "agora". É a data que entra na
  receita por dia. Data futura ou inválida vira "agora".
- O telefone casa **por DDD + últimos 8 dígitos**, então "(48) 9177-7444" e
  "554891777444" são a mesma pessoa (o 9º dígito e o +55 não atrapalham).
- Quem já é "Venda" é ignorado (não dobra a receita se a lista for colada duas
  vezes). Vale um `Purchase` por contato: paciente recorrente não gera segunda
  compra (LTV fica pra depois).
- Sem contato com aquele telefone = o paciente nunca falou com o WhatsApp da
  clínica, ou falou de outro número. Aparece na lista "sem contato correspondente".

Cada venda passa pelo mesmo caminho do botão "Venda" (`applyStageTransition`):
marca o estágio, grava o valor e, se o lead tem origem rastreada, devolve a
conversão pro Meta (`ctwa_clid` ou `fbc`) e pro Google Ads (`gclid`).
Leads sem origem entram na receita como "Orgânico / sem origem".

Código: `functions/api/sales-import.js`, `phoneMatchKey()` em
`functions/_shared/hashing.js`, card "Fechamentos" em `dash/index.html`
(receita = `revenue` de `functions/api/whatsapp-stats.js`, uma linha de
`Purchase` por contato).

## Roteiro de descoberta (por cliente, ~10 min de conversa)

1. **Onde o pagamento é registrado?** Sistema de agenda/prontuário/
   financeiro (qual?), planilha da recepção, ou não é registrado.
2. **Dá pra exportar** uma lista de "pacientes atendidos e pagos" num
   período, com **telefone, valor e data**? Em qual formato (CSV, Excel)?
3. **Com que frequência** alguém consegue exportar (diário, semanal)?
4. O sistema tem **API ou integração** (webhook de pagamento/consulta
   realizada)? Se sim, dá pra automatizar no futuro.
5. **O telefone do cadastro é o mesmo do WhatsApp** com que o paciente
   conversa? (Quando o paciente marca por outra pessoa, não casa.)
6. Quem **da recepção** poderia marcar "Venda" no painel do contato como
   plano B?

A resposta define o caminho: exportação periódica (importar como acima), API
(automatizar), ou mudança de processo (marcar a venda).
