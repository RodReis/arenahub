# PRD técnico — MVP 6: Retention AI

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026
- Dependências: dados históricos confiáveis dos MVPs 1 a 5
- Resultado: risco de churn explicável convertido em tarefa operacional e resultado mensurável
- Restrição: nenhuma decisão adversa, desconto ou mensagem é executada automaticamente pelo modelo
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Problema e objetivo

Identificar alunos com sinais objetivos de abandono antes do cancelamento e organizar intervenção humana. O MVP começa por uma baseline de regras explicáveis. Um modelo supervisionado só entra em produção se houver dados suficientes, validação temporal e ganho mensurável sobre a baseline.

“Usar IA” não é critério de sucesso. O sistema será aceito quando priorizar contatos úteis, explicar os fatores e demonstrar impacto operacional sem discriminação ou vazamento entre tenants.

## 3. Definição inicial do alvo

Para este MVP:

- data de observação: dia em que o score é calculado;
- janela de features: 90 dias anteriores;
- horizonte de previsão: próximos 30 dias;
- churn positivo: assinatura cancelada ou expirada e não reativada por 30 dias;
- população elegível: alunos com assinatura ativa ou `PAST_DUE`, ao menos 30 dias de histórico e sem pedido de exclusão pendente;
- frequência de score: diária;
- ação: criar recomendação/tarefa, nunca bloquear acesso ou aplicar oferta automaticamente.

Mudança nessa definição cria nova versão de target e invalida comparação direta sem reprocessamento documentado.

## 4. Métricas de sucesso

- cobertura de dados e qualidade publicadas junto ao score;
- 100% dos scores possuem versão, timestamp e fatores explicativos;
- precisão no top-K superior à baseline no conjunto temporal de validação;
- calibração monitorada por faixa de risco;
- tempo de resolução e resultado das tarefas mensurados;
- teste controlado demonstra uplift ou aprendizado conclusivo antes da expansão;
- nenhum dado de saúde sensível entra por padrão nas features;
- nenhuma decisão automática adversa é tomada a partir do score.

## 5. Gates de dados e modelo

### Gate para baseline operacional

- [ ] ao menos seis meses de assinaturas, acessos e pagamentos com definições estáveis;
- [ ] qualidade mínima por feature publicada;
- [ ] eventos duplicados e lacunas relevantes quantificados;
- [ ] definição de churn aprovada por produto e operação;
- [ ] capacidade da recepção para executar tarefas definida;
- [ ] base legal, transparência e opt-out quando aplicável aprovados.

### Gate adicional para modelo supervisionado

- [ ] ao menos 200 exemplos positivos de churn e 1.000 snapshots elegíveis, ou estudo estatístico que justifique outro mínimo;
- [ ] separação temporal entre treino, validação e teste;
- [ ] baseline de regras congelada para comparação;
- [ ] revisão de fairness e proxies sensíveis;
- [ ] documentação de features, target, versão e limitações;
- [ ] plano de monitoramento, fallback e desativação.

Se o gate não for atendido, o produto continua com baseline de regras; não usa modelo genérico sem validação.

## 6. Personas

- Gerente de retenção: define capacidade, prioridade e acompanha resultado.
- Recepcionista/consultor: recebe tarefa, consulta explicação e registra contato.
- Proprietário: acompanha métricas agregadas e retorno do programa.
- Analista autorizado: avalia dados, baseline, modelo e drift.
- Aluno: recebe contato apenas por canal/finalidade permitidos e pode exercer direitos aplicáveis.

## 7. Escopo

### Incluído

- contrato de dados e snapshots de features;
- baseline de regras explicáveis;
- score diário e faixas de risco;
- motivos e qualidade do score;
- fila priorizada de tarefas;
- atribuição, prazo, contato e resultado;
- templates de ação não automática;
- experimento controlado;
- treinamento e validação temporal quando o gate permitir;
- registry de versões de modelo/regra;
- monitoramento de performance, drift e fairness;
- feedback operacional e dashboard.

### Fora de escopo

- cancelar, bloquear ou limitar aluno pelo score;
- aplicar desconto automaticamente;
- enviar campanha sem revisão/consentimento;
- usar diagnóstico, biometria facial ou composição corporal como feature padrão;
- vender ou compartilhar score;
- treinar com dados cruzados entre tenants sem base legal, contrato e isolamento aprovados;
- LLM como motor primário de score;
- causalidade individual garantida.

## 8. Slices verticais

### Slice 6.1 — Contrato de dados e baseline analítica

- definição versionada de target, população e janelas;
- snapshot diário reproduzível;
- features iniciais e qualidade;
- label histórico sem leakage;
- dashboard de cobertura e distribuição.

Aceite: um snapshot passado pode ser reproduzido apenas com dados disponíveis naquela data.

### Slice 6.2 — Regras explicáveis e score

- regras versionadas;
- exemplos: queda de frequência, dias ausente, cobrança vencida, pausa recente e tempo sem avaliação;
- score e faixas calibradas operacionalmente;
- fatores positivos/negativos;
- API e histórico.

Aceite: operação entende e contesta o score sem interpretar modelo opaco.

### Slice 6.3 — CRM de retenção

- geração de tarefa com deduplicação e cooldown;
- fila por prioridade e capacidade;
- atribuição, SLA e status;
- registro de tentativa, canal, motivo, resultado e próximo passo;
- supressão por consentimento ou solicitação.

Aceite: cada intervenção liga score, ação, responsável e resultado.

### Slice 6.4 — Experimento operacional

- elegibilidade e randomização reproduzível;
- grupo controle e tratamento;
- templates de intervenção;
- métricas de contato, reativação, permanência e opt-out;
- análise sem mover participantes após alocação.

Aceite: resultado permite decidir continuar, ajustar ou interromper sem cherry-picking.

### Slice 6.5 — Modelo supervisionado condicionado ao gate

- pipeline offline versionado;
- split temporal e prevenção de leakage;
- comparação com baseline;
- explicações compatíveis com operação;
- aprovação e shadow mode;
- fallback imediato para regras.

Aceite: modelo só avança se superar critérios previamente fixados no teste temporal e não falhar em fairness/estabilidade.

### Slice 6.6 — Produção controlada e monitoramento

- champion/challenger;
- drift de feature, score e resultado;
- calibração por período e segmentos permitidos;
- alertas, kill switch e rollback;
- revisão periódica e expiração de versão;
- relatório de impacto.

Aceite: degradação desativa o modelo com segurança e preserva tarefas já auditadas.

## 9. Features iniciais permitidas

```text
attendance_days_7d
attendance_days_30d
attendance_days_90d
attendance_change_30d_vs_previous_30d
days_since_last_confirmed_passage
subscription_age_days
days_to_subscription_end
past_due_invoice_count
days_past_due
payment_failure_count_90d
pause_count_180d
days_since_last_published_assessment
engagement_opt_in_activity_30d
```

Restrições:

- feature ausente é marcada como ausente, não zero;
- dados posteriores à data de observação são proibidos;
- sexo, raça inferida, biometria, diagnóstico e composição corporal não entram na versão inicial;
- idade só entra após análise de necessidade e fairness;
- features cruzadas entre tenants exigem aprovação específica.

## 10. Requisitos funcionais

- `M6-FR-001`: versionar definição de target, população, janelas e features.
- `M6-FR-002`: materializar snapshot diário com data de observação e qualidade.
- `M6-FR-003`: gerar label histórico sem usar informação futura nas features.
- `M6-FR-004`: calcular baseline de regras de forma determinística e reexecutável.
- `M6-FR-005`: persistir score, faixa, fatores, versão e completude.
- `M6-FR-006`: impedir score para aluno inelegível ou com supressão aplicável.
- `M6-FR-007`: criar no máximo uma tarefa ativa por aluno e estratégia dentro do cooldown.
- `M6-FR-008`: priorizar tarefas respeitando capacidade diária da equipe.
- `M6-FR-009`: atribuir, reatribuir, concluir ou dispensar tarefa com motivo.
- `M6-FR-010`: registrar contato, canal, resultado e próximo passo.
- `M6-FR-011`: randomizar experimento por unidade de análise estável.
- `M6-FR-012`: impedir mudança de grupo após início do experimento.
- `M6-FR-013`: treinar modelo somente quando gates estiverem registrados como atendidos.
- `M6-FR-014`: registrar dataset, código, parâmetros, métricas e artefato de cada versão.
- `M6-FR-015`: executar modelo em shadow mode antes de afetar prioridade.
- `M6-FR-016`: comparar champion, challenger e baseline.
- `M6-FR-017`: desativar versão por kill switch sem deploy.
- `M6-FR-018`: monitorar drift, calibração, precisão top-K e resultados de intervenção.

## 11. Regras de negócio

- `M6-BR-001`: score é recomendação operacional, não fato sobre o aluno.
- `M6-BR-002`: ausência de dado reduz confiança/completude; não aumenta risco arbitrariamente.
- `M6-BR-003`: aluno cancelado não gera nova tarefa de prevenção, salvo fluxo distinto fora deste MVP.
- `M6-BR-004`: tarefa duplicada é suprimida durante cooldown, mas novo score permanece no histórico.
- `M6-BR-005`: capacidade da equipe limita o top-K; score não cria backlog infinito.
- `M6-BR-006`: resultado de contato não altera label histórico manualmente.
- `M6-BR-007`: desconto, mensagem e canal exigem decisão humana e permissão própria.
- `M6-BR-008`: modelo novo começa em shadow mode.
- `M6-BR-009`: falha do pipeline preserva último score com marca de idade; não o apresenta como atual indefinidamente.
- `M6-BR-010`: modelo não aprovado ou degradado volta à baseline de regras.

## 12. Modelo de dados

```text
retention_target_versions
feature_definitions
student_feature_snapshots
retention_rule_versions
retention_scores
score_explanations
retention_tasks
retention_interactions
retention_suppressions
experiments, experiment_assignments
model_versions, model_evaluations
prediction_batches
drift_reports
```

Artefatos grandes ficam em storage privado com checksum. Metadados, versões e lineage ficam no PostgreSQL.

## 13. API

```text
GET    /api/v1/retention/overview
GET    /api/v1/retention/scores
GET    /api/v1/retention/students/:studentId/history
GET    /api/v1/retention/tasks
POST   /api/v1/retention/tasks/:id/assign
POST   /api/v1/retention/tasks/:id/interactions
POST   /api/v1/retention/tasks/:id/complete
POST   /api/v1/retention/tasks/:id/dismiss
GET    /api/v1/retention/experiments/:id/results
GET    /api/v1/retention/models
POST   /api/v1/retention/models/:id/activate-shadow
POST   /api/v1/retention/models/:id/promote
POST   /api/v1/retention/models/kill-switch
```

## 14. Eventos

Consumidos:

```text
PassageConfirmed
InvoiceOverdue
PaymentConfirmed
SubscriptionPaused
SubscriptionCancelled
AssessmentPublished
EngagementOptedOut
```

Produzidos:

```text
RetentionScoreCalculated
RetentionRiskIncreased
RetentionTaskCreated
RetentionInteractionRecorded
RetentionTaskCompleted
ModelDriftDetected
RetentionModelDisabled
```

## 15. Avaliação do modelo

Métricas mínimas:

- prevalência do target;
- precisão e recall no top-K compatível com a capacidade operacional;
- PR-AUC; ROC-AUC apenas como métrica complementar;
- calibração por faixa de risco;
- estabilidade temporal;
- cobertura e completude;
- fairness nos segmentos legalmente permitidos e estatisticamente viáveis;
- uplift do experimento, não apenas acurácia preditiva.

Critérios de promoção são fixados antes do treinamento para evitar seleção oportunista. Se o modelo não superar a baseline no conjunto de teste temporal, permanece fora de produção.

## 16. UX e explicabilidade

Cada score mostra:

- faixa e data de cálculo;
- completude dos dados;
- até cinco fatores objetivos;
- evolução do risco;
- ação sugerida e justificativa;
- aviso de que é estimativa;
- dados desatualizados ou faltantes;
- possibilidade de dispensar tarefa com motivo.

Não mostrar probabilidades com falsa precisão quando não calibradas. Preferir `BAIXO`, `MÉDIO`, `ALTO` e `CRÍTICO` com intervalos e versão publicados.

## 17. Segurança, privacidade e governança

- acesso a scores e tarefas por tenant, unidade e papel;
- logs não registram vetor completo de features;
- datasets de treino são pseudonimizados e têm retenção definida;
- exclusão/opt-out propaga para futuros snapshots e datasets conforme política;
- nenhum treinamento cruzado entre tenants por padrão;
- promoção e kill switch exigem permissão e auditoria;
- model card registra propósito, dados, métricas, limitações e uso proibido;
- decisão humana e contato permanecem auditáveis.

## 18. Requisitos não funcionais

- `M6-NFR-001`: snapshot e score diário concluem antes do início da operação configurada.
- `M6-NFR-002`: reexecução para mesma versão/data não duplica score ou tarefa.
- `M6-NFR-003`: pipeline possui lineage de origem a score.
- `M6-NFR-004`: dashboard p95 menor que 1 s para filas paginadas.
- `M6-NFR-005`: falha de modelo não afeta acesso, cobrança ou app.
- `M6-NFR-006`: kill switch produz efeito em até cinco minutos.
- `M6-NFR-007`: métricas e drift são calculados por versão e período.
- `M6-NFR-008`: dados de outro tenant nunca influenciam score sem aprovação explícita do modelo compartilhado.
- `M6-NFR-009`: tarefas e interações permanecem disponíveis se o scoring estiver indisponível.

## 19. Testes obrigatórios

- point-in-time correctness e ausência de leakage;
- timezone, janelas e aluno inelegível;
- ausência de feature e completude;
- reexecução, concorrência, cooldown e capacidade top-K;
- randomização estável e não contaminação entre grupos;
- split temporal e comparação congelada com baseline;
- drift simulado e kill switch;
- tenant isolation em snapshots, scores, tarefas e artefatos;
- exclusão/opt-out e retenção;
- explicações coerentes com features do snapshot;
- E2E: eventos → snapshot → score → tarefa → contato → resultado;
- fallback do modelo para regras.

## 20. Critérios de aceite

- `M6-AC-001`: snapshot passado não contém dado conhecido somente depois da observação.
- `M6-AC-002`: baseline produz score e fatores reproduzíveis.
- `M6-AC-003`: aluno inelegível ou suprimido não gera tarefa.
- `M6-AC-004`: reprocessamento não duplica tarefa ativa.
- `M6-AC-005`: fila respeita capacidade e apresenta os fatores principais.
- `M6-AC-006`: interação registra responsável, canal, horário e resultado.
- `M6-AC-007`: experimento preserva atribuição e apresenta análise por intenção de tratar.
- `M6-AC-008`: modelo sem gate ou sem ganho sobre baseline não pode ser promovido.
- `M6-AC-009`: drift crítico aciona alerta e permite fallback pelo kill switch.
- `M6-AC-010`: score nunca altera acesso, cobrança ou desconto automaticamente.
- `M6-AC-011`: relatório final mede impacto operacional e efeitos adversos, não apenas acurácia.

## 21. Rollout

1. qualidade e snapshots sem exposição a usuários;
2. baseline em shadow mode;
3. score visível apenas para gerentes;
4. tarefas para equipe piloto com capacidade limitada;
5. experimento controlado;
6. modelo supervisionado somente se gate e métricas forem atendidos;
7. expansão por tenant/unidade com monitoramento.

Feature flags: `RETENTION_BASELINE`, `RETENTION_TASKS`, `RETENTION_EXPERIMENT`, `RETENTION_ML_SHADOW`, `RETENTION_ML_ACTIVE`.

## 22. Checklist

- [ ] Gate de dados aprovado
- [ ] Slice 6.1 — Contrato de dados
- [ ] Slice 6.2 — Regras e score
- [ ] Slice 6.3 — CRM de retenção
- [ ] Slice 6.4 — Experimento operacional
- [ ] Gate de modelo supervisionado aprovado ou registrado como não atendido
- [ ] Slice 6.5 — Modelo supervisionado, se elegível
- [ ] Slice 6.6 — Produção e monitoramento
- [ ] relatório de impacto aprovado
