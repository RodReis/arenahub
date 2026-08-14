# PRD técnico — MVP 3: Health Intelligence

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026
- Dependência: identidade, alunos e eventos de frequência do MVP 1 estáveis
- Resultado: avaliação física rastreável, comparável e acompanhada por análise assistiva
- Limite clínico: acompanhamento informativo, nunca diagnóstico ou prescrição médica
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo

Centralizar avaliações corporais, medidas, metas e frequência para que aluno e profissionais autorizados acompanhem evolução ao longo do tempo. Dados manuais ou importados exigem proveniência; dados extraídos por OCR/IA exigem confirmação humana antes de integrar o histórico oficial.

## 3. Métricas de sucesso

- 100% das medidas oficiais possuem origem, unidade, responsável e data;
- nenhuma extração por IA é publicada sem confirmação humana;
- comparativos reproduzem os valores originais e não alteram avaliações passadas;
- todo acesso a dado de saúde respeita papel, tenant, vínculo e consentimento;
- análises de IA são auditáveis por snapshot, modelo e versão de prompt;
- nenhum texto gerado afirma diagnóstico.

## 4. Personas e permissões

| Persona | Capacidades |
|---|---|
| Avaliador físico | criar, revisar e corrigir avaliação com trilha |
| Personal Trainer | consultar alunos vinculados e registrar metas permitidas |
| Aluno | consultar os próprios dados e consentimentos |
| Gerente | indicadores agregados sem detalhe clínico desnecessário |
| Operador de importação | revisar extrações, sem permissão automática de publicação |

```text
health_assessment.create, health_assessment.read, health_assessment.correct
health_import.create, health_import.review
health_goal.manage
health_ai.generate, health_ai.read
health_report.export
```

## 5. Gates de entrada

- [ ] termo de dados de saúde versionado e aprovado;
- [ ] matriz de acesso por papel e vínculo aprovada;
- [ ] protocolo de avaliação, unidades e faixas de validação definidos por profissional habilitado;
- [ ] formatos de equipamento/importação inventariados;
- [ ] política de retenção e correção definida;
- [ ] aviso e limites da análise de IA aprovados;
- [ ] provedor/modelo de IA passa avaliação de privacidade antes da Slice 3.5.

## 6. Escopo

### Incluído

- consentimento específico para dados de saúde;
- avaliação manual estruturada;
- peso, altura, IMC e composição corporal;
- medidas segmentares quando disponíveis;
- upload privado de PDF, imagem e CSV;
- pipeline de extração, revisão e confirmação;
- histórico e comparativos;
- metas mensuráveis;
- frequência derivada de acessos concedidos/passagens confirmadas;
- frequência cardíaca e métricas adicionais registradas manualmente ou por importação homologada;
- análise de IA com snapshot e linguagem assistiva;
- exportação do histórico do aluno.

### Fora de escopo

- diagnóstico, laudo médico ou recomendação terapêutica;
- integração com prontuário médico;
- prescrição de treino ou dieta;
- decisão automática de acesso baseada em saúde;
- ranking e gamificação, tratados no MVP 5;
- wearables em tempo real;
- ingestão direta de equipamento não homologado;
- treinamento de modelo proprietário.

## 7. Slices verticais

### Slice 3.1 — Consentimento e avaliação manual

- consentimento de saúde;
- formulário versionado;
- unidades canônicas e validações;
- avaliação imutável após publicação;
- correção por nova revisão vinculada;
- auditoria.

Aceite: avaliador registra e publica avaliação consistente sem substituir silenciosamente o histórico.

### Slice 3.2 — Histórico e comparativos

- primeira, anterior, atual e meta;
- gráficos por período;
- variações absolutas e percentuais com regras explícitas;
- timeline combinando avaliação e frequência;
- exportação acessível.

Aceite: os mesmos dados sempre geram o mesmo comparativo, inclusive em unidades e arredondamento.

### Slice 3.3 — Upload e revisão

- upload privado e antivírus/validação de tipo;
- parser CSV homologado;
- OCR/extração de imagem ou PDF atrás de adapter;
- estado de revisão campo a campo;
- confirmação humana e descarte seguro de temporários.

Aceite: valor extraído incorretamente pode ser corrigido antes da publicação e a proveniência permanece visível.

### Slice 3.4 — Metas e frequência

- metas com baseline, alvo, unidade e prazo;
- progresso calculado, sem editar avaliações;
- frequência semanal/mensal/anual e consistência;
- associação de passagens confirmadas a sessões, sem inferir duração de treino quando não houver saída confiável.

Aceite: meta e frequência usam dados rastreáveis e deixam limitações explícitas.

### Slice 3.5 — Análise assistiva por IA

- `AIProvider` abstrato;
- minimização e pseudonimização de entrada;
- prompt versionado;
- saída estruturada validada;
- aviso de não diagnóstico;
- aprovação ou regeneração controlada;
- auditoria e custo/latência.

Aceite: análise cita tendências presentes no snapshot, não inventa medidas e pode ser reproduzida dentro das limitações do modelo.

### Slice 3.6 — Operação e qualidade

- painel de importações pendentes/falhas;
- métricas de completude e origem;
- alertas de análise inválida;
- runbook de correção e indisponibilidade do provedor;
- piloto com profissionais e alunos consentidos.

Aceite: equipe corrige falhas sem alterar banco ou apagar avaliação publicada.

## 8. Requisitos funcionais

- `M3-FR-001`: registrar, revogar e consultar consentimento de saúde versionado.
- `M3-FR-002`: criar avaliação em rascunho e publicá-la somente após validação.
- `M3-FR-003`: armazenar medida com tipo, valor decimal, unidade canônica, origem e instante.
- `M3-FR-004`: calcular IMC a partir de peso e altura válidos, preservando valores de entrada.
- `M3-FR-005`: representar medidas segmentares sem exigir campos ausentes no equipamento.
- `M3-FR-006`: corrigir avaliação por revisão vinculada, sem sobrescrever a publicada.
- `M3-FR-007`: comparar atual, anterior, primeira e meta.
- `M3-FR-008`: filtrar gráficos por 30D, 90D, 6M, 1A e todo o período.
- `M3-FR-009`: receber PDF, imagem ou CSV com limite, tipo e malware scan.
- `M3-FR-010`: registrar cada campo extraído com confiança e localização de origem quando disponível.
- `M3-FR-011`: exigir confirmação humana dos campos extraídos antes da publicação.
- `M3-FR-012`: criar meta com baseline, alvo, unidade, prazo e responsável.
- `M3-FR-013`: calcular frequência a partir de eventos físicos elegíveis e deduplicados.
- `M3-FR-014`: registrar métricas adicionais de saúde com origem e dispositivo.
- `M3-FR-015`: gerar análise estruturada a partir de snapshot imutável.
- `M3-FR-016`: registrar modelo, versão de prompt, custo, latência e saída validada.
- `M3-FR-017`: exportar dados próprios do aluno em formato legível e estruturado.

## 9. Regras de negócio

- `M3-BR-001`: avaliação publicada é imutável; correção cria nova versão.
- `M3-BR-002`: unidade original é preservada e conversão usa regra testada.
- `M3-BR-003`: arredondamento é apenas de apresentação; cálculo usa precisão armazenada.
- `M3-BR-004`: revogação impede novo processamento, respeitando retenção legal já definida.
- `M3-BR-005`: ausência de dado não equivale a zero.
- `M3-BR-006`: OCR/IA nunca publica automaticamente.
- `M3-BR-007`: acesso concedido sem passagem confirmada não conta como treino quando o hardware fornece confirmação confiável.
- `M3-BR-008`: múltiplas entradas na janela configurada contam como uma sessão para frequência, sem apagar eventos brutos.
- `M3-BR-009`: IA usa apenas dados consentidos e necessários ao tipo de análise.
- `M3-BR-010`: saída de IA fora do schema, com diagnóstico ou valor inexistente é rejeitada.

## 10. Modelo de dados

```text
health_consents
body_assessments
assessment_revisions
body_measurements
segmental_measurements
health_measurements
health_goals
assessment_imports
imported_fields
student_attendance_sessions
ai_analyses
ai_prompt_versions
```

Campos centrais de `body_assessments`:

```text
id, tenant_id, student_id, status
assessed_at, published_at
source, source_reference
evaluator_user_id
supersedes_assessment_id
created_at
```

## 11. API

```text
POST   /api/v1/students/:id/health-consents
DELETE /api/v1/students/:id/health-consents/:consentId
GET    /api/v1/students/:id/assessments
POST   /api/v1/students/:id/assessments
PATCH  /api/v1/assessments/:id/draft
POST   /api/v1/assessments/:id/publish
POST   /api/v1/assessments/:id/corrections
POST   /api/v1/students/:id/assessment-imports
GET    /api/v1/assessment-imports/:id
POST   /api/v1/assessment-imports/:id/confirm
GET    /api/v1/students/:id/health-progress
POST   /api/v1/students/:id/health-goals
GET    /api/v1/students/:id/attendance
POST   /api/v1/students/:id/ai-analyses
GET    /api/v1/ai-analyses/:id
```

## 12. Saída estruturada da IA

```ts
interface HealthAnalysisOutput {
  summary: string;
  progress: Array<{ metric: string; observation: string }>;
  positivePoints: string[];
  attentionPoints: string[];
  trends: Array<{ metric: string; direction: 'UP' | 'DOWN' | 'STABLE' }>;
  goalProgress: string[];
  questionsForProfessional: string[];
  disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
}
```

Texto livre é sanitizado e validado contra políticas antes de publicação.

## 13. Eventos

```text
HealthConsentGranted
HealthConsentRevoked
AssessmentDrafted
AssessmentPublished
AssessmentCorrected
AssessmentImportRequiresReview
HealthGoalCreated
HealthGoalReached
AIAnalysisGenerated
AIAnalysisRejected
```

## 14. UX e acessibilidade

- gráficos possuem tabela e descrição textual equivalentes;
- cores não são o único indicador de melhora ou atenção;
- formulário mostra unidade junto ao campo;
- valores extraídos exibem origem e confiança, sem induzir aceite automático;
- correção explica que o histórico será preservado;
- aluno vê quem registrou e quando, dentro da política de privacidade;
- análise de IA mostra aviso persistente e canal para falar com profissional.

## 15. Segurança e privacidade

- autorização considera tenant, papel e vínculo profissional-aluno;
- storage privado com URLs temporárias e malware scan;
- arquivos temporários de OCR têm retenção curta e deleção verificável;
- dados enviados à IA são minimizados, sem identificador direto quando possível;
- provedor de IA não pode usar dados para treinamento sem contrato explícito;
- exportação, acesso, correção e análise são auditados;
- agregados executivos aplicam limiar mínimo para evitar reidentificação.

## 16. Requisitos não funcionais

- `M3-NFR-001`: cálculos determinísticos possuem testes com tolerância decimal explícita.
- `M3-NFR-002`: visualização de histórico p95 menor que 1 s para até cinco anos de avaliações.
- `M3-NFR-003`: upload não bloqueia request durante extração.
- `M3-NFR-004`: indisponibilidade de OCR/IA não impede avaliação manual.
- `M3-NFR-005`: análise de IA possui timeout, orçamento e circuit breaker.
- `M3-NFR-006`: todo dado oficial possui proveniência consultável.
- `M3-NFR-007`: WCAG 2.2 AA nos formulários, tabelas e gráficos essenciais.
- `M3-NFR-008`: exclusão e exportação respeitam política LGPD testada.

## 17. Testes obrigatórios

- cálculos, conversões, arredondamento e ausência de valor;
- revisão imutável e concorrência de publicação;
- tenant, papel e vínculo profissional;
- upload inválido, excessivo, malicioso e duplicado;
- parser de cada formato homologado com golden files anonimizados;
- OCR incorreto e confirmação humana;
- frequência com eventos duplicados e passagens ausentes;
- saída de IA fora do schema, diagnóstico, hallucinação de medida e timeout;
- E2E: consentir → avaliar → publicar → comparar → exportar;
- E2E: importar → revisar → corrigir → publicar;
- revogação de consentimento e bloqueio de novo processamento.

## 18. Critérios de aceite

- `M3-AC-001`: avaliação manual válida é publicada com proveniência completa.
- `M3-AC-002`: tentativa de editar avaliação publicada cria correção vinculada.
- `M3-AC-003`: comparativos exibem primeira, anterior, atual e meta corretamente.
- `M3-AC-004`: campos ausentes permanecem ausentes, nunca zero.
- `M3-AC-005`: arquivo extraído exige revisão humana antes de afetar gráficos.
- `M3-AC-006`: frequência ignora duplicatas conforme política sem remover eventos brutos.
- `M3-AC-007`: aluno sem consentimento não recebe nova análise de IA.
- `M3-AC-008`: saída com diagnóstico é rejeitada e registrada.
- `M3-AC-009`: profissional autorizado acessa apenas alunos vinculados quando essa restrição se aplica.
- `M3-AC-010`: aluno exporta histórico próprio com avaliações, medidas, origem e datas.

## 19. Rollout

1. avaliação manual em homologação;
2. piloto com avaliadores treinados;
3. histórico e gráficos para alunos piloto;
4. importação por formato homologado;
5. IA em modo revisão interna;
6. IA para aluno somente após auditoria de amostra e aprovação jurídica/profissional.

Feature flags: `HEALTH_ASSESSMENTS`, `HEALTH_IMPORT`, `HEALTH_AI` e `HEALTH_STUDENT_VIEW`.

## 20. Checklist

- [ ] Gates de saúde e privacidade aprovados
- [ ] Slice 3.1 — Consentimento e avaliação manual
- [ ] Slice 3.2 — Histórico e comparativos
- [ ] Slice 3.3 — Upload e revisão
- [ ] Slice 3.4 — Metas e frequência
- [ ] Slice 3.5 — Análise assistiva
- [ ] Slice 3.6 — Operação e qualidade
- [ ] piloto profissional aprovado
