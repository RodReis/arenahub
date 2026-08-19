-- F15 -- razao de DENY para direito suspenso por inadimplencia.
--
-- ACRESCENTADA PELO FIM (ADR-024): `access_reason` e persistido e imutavel.
-- Renomear ou reordenar valor aqui nao e refactor -- e reescrever auditoria ja
-- entregue. Todo `AccessEvent` de F9 em diante carrega este enum.
--
-- POR QUE UMA RAZAO PROPRIA, e nao reusar `NO_ENTITLEMENT`: as duas situacoes
-- exigem acoes OPOSTAS da recepcao. "Nao tem plano" manda vender um; "esta
-- devendo" manda cobrar. Colapsadas, a tela diz a mesma coisa nos dois casos e
-- quem esta no balcao decide errado.
--
-- A REGRA No 1 CONTINUA VALENDO: o motor de acesso nao consulta invoice nem
-- assinatura. Ele le `entitlement.status`. Esta razao diz POR QUE o direito
-- esta suspenso -- nao cria caminho novo entre pagamento e catraca.

ALTER TYPE "access_reason" ADD VALUE 'PAYMENT_OVERDUE';

-- Liberacao financeira excepcional com prazo (Slice 2.4). Razao propria e nao
-- reuso de `MANUAL_OVERRIDE`: aquele e por PASSAGEM (amarrado a um evento de
-- acesso, a recepcao abre a catraca uma vez); este e por PERIODO. As duas sao
-- liberacoes humanas, mas prestam contas em relatorios diferentes.
ALTER TYPE "access_reason" ADD VALUE 'FINANCIAL_OVERRIDE';
