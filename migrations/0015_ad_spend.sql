-- Bloco G do plano "Reconstrução visual": Relatórios precisa de custo por
-- paciente e retorno (faturado ÷ investido), e isso não existe em lugar
-- nenhum do sistema - não há integração com a API de insights do Meta/
-- Google Ads (só rastreamos o lead que veio do anúncio, não quanto ele
-- custou). Em vez de inventar um número, o investimento mensal é digitado
-- à mão em Relatórios (um valor por mês, por cliente) e usado pra calcular
-- custo/retorno na janela escolhida.

CREATE TABLE ad_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  period TEXT NOT NULL, -- 'YYYY-MM'
  amount REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(client_id, period)
);
