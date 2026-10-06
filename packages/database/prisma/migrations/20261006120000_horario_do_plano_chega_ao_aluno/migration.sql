-- Horario do plano chega a quem ja tem o plano (decisao do PI, 06/10/2026).
--
-- Ate hoje editar um plano so valia para assinaturas NOVAS: cada direito de
-- acesso guarda uma copia das janelas do plano (`entitlement_unit_windows`),
-- feita na ativacao e nunca mais tocada. O plano "Individuais - Protocolos"
-- foi de 06:00-22:00 (seg-sex) para 05:00-23:00 (seg-sab) em 04/10 e a catraca
-- seguiu lendo a copia: 541 dos 543 direitos ativos divergiam do plano, e quem
-- chegou as 05:18 foi barrado como "Fora do horario do plano".
--
-- O codigo passa a propagar a edicao (`editarPlano`). Esta migration conserta
-- o que ja divergiu: troca as janelas de cada direito VIVO pelas do plano da
-- assinatura dele. VIVO = agendado, ativo ou suspenso e ainda nao vencido;
-- revogado e expirado sao historico e ficam como estao.
--
-- Plano sem nenhuma janela e deixado em paz nos dois passos: apagar a janela
-- do direito sem ter com o que repor fecharia a catraca para quem esta dentro.
--
-- Idempotente: rodar de novo deixa tudo igual. Banco novo (sem direitos) nao
-- insere nada, e o seed nao precisa de par -- nao ha dado a corrigir.
--
-- RLS: `entitlement_unit_windows` esta em NO FORCE ROW LEVEL SECURITY (F67), e
-- o dono da migration atravessa a politica, como a propria F67 fez no backfill
-- de `tenant_id` desta tabela.

DELETE FROM entitlement_unit_windows w
USING entitlements e
JOIN subscriptions s ON s.id = e.subscription_id
WHERE w.entitlement_id = e.id
  AND e.status IN ('SCHEDULED', 'ACTIVE', 'SUSPENDED')
  AND e.ends_at > now()
  AND EXISTS (SELECT 1 FROM plan_access_windows p WHERE p.plan_id = s.plan_id);

INSERT INTO entitlement_unit_windows
  (id, tenant_id, entitlement_id, gym_unit_id, day_of_week, start_minute, end_minute)
SELECT gen_random_uuid(), e.tenant_id, e.id, p.gym_unit_id, p.day_of_week, p.start_minute, p.end_minute
FROM entitlements e
JOIN subscriptions s ON s.id = e.subscription_id
JOIN plan_access_windows p ON p.plan_id = s.plan_id
WHERE e.status IN ('SCHEDULED', 'ACTIVE', 'SUSPENDED')
  AND e.ends_at > now();
