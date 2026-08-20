# PRD técnico — MVP 3: Health Intelligence

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026 · **emendado em 19/08/2026** (§6, §12, §16 —
  ADR-035 e ADR-036, decididos pelo PI)
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
- treinamento de modelo proprietário;
- **interpretação de qualquer achado clínico vindo de equipamento do aluno** — inclusive
  reclassificar, normalizar para taxonomia própria, atribuir faixa de referência ou gerar texto
  explicativo personalizado por achado;
- **exames laboratoriais** — nem anexo, nem extração, nem acompanhamento de tendência
  ([ADR-037](../../DECISIONS.md#adr-037), 19/08/2026). Faixa de referência de exame varia por
  laboratório, método e sexo, e lê-la é ato clínico bem mais claro que ler composição corporal.
  Entra como fatia própria se o PI priorizar, com ADR novo.

> **Emenda de 19/08/2026 — [ADR-035](../../DECISIONS.md#adr-035), decidida pelo PI.** Laudo de
> **eletrocardiograma** (ECG) **deixa de ser exclusão absoluta** e passa a ser escopo, com uma
> fronteira estreita: o ArenaHub **anexa o arquivo e cita o achado do aparelho literalmente**, com
> `origem` e `classificado_por: equipamento`, e **nada além disso**. A base é a exclusão da **RDC
> 657/2022** da ANVISA — software que apenas armazena, arquiva, transmite ou exibe não é
> dispositivo médico; interpretar é o que enquadra.
>
> Consequências normativas desta emenda:
>
> 1. **O ECG não entra no payload enviado à IA.** Viaja só o par `pendingMedicalReferral` /
>    `pendingReferralSince` (§12) — sem traçado, sem o texto do achado, sem bpm de origem ECG.
>    Exige teste que **falha** se campo de origem `ECG` vazar para o snapshot.
> 2. **A extração do ECG não usa IA.** O PDF do OmronConnect tem camada de texto legível por
>    `pdftotext`; parser determinístico, não adapter de OCR.
> 3. **Achado aberto vira pendência visível** na lista de alunos, resolvida por
>    `Registrar encaminhamento` (data + responsável), emitindo `HealthReferralRegistered`.
> 4. O texto que o aluno lê sobre a pendência é **fixo, revisado por profissional de saúde e
>    idêntico para todos** — não gerado, não personalizado.
>
> O **gate de protocolo clínico** do §5 foi **recusado pelo PI em 19/08/2026** e substituído por
> esta fronteira. Os demais itens do §5 seguem valendo.

## 7. Slices verticais

### Slice 3.1 — Consentimento e avaliação manual

- consentimento de saúde;
- formulário versionado;
- unidades canônicas e validações;
- **contexto de saúde do aluno — lista fechada de fatores, registrada pelo avaliador**;
- avaliação imutável após publicação;
- correção por nova revisão vinculada;
- auditoria.

Aceite: avaliador registra e publica avaliação consistente sem substituir silenciosamente o histórico.

> **Emenda de 19/08/2026 — [ADR-037](../../DECISIONS.md#adr-037).** O **contexto de saúde** é uma
> lista fechada de fatores que mudam como o laudo deve ser lido, e **cada fator suprime um alerta
> específico** — nenhum gera texto. **Não há campo de texto livre**: fator individual é dado de
> saúde (art. 11), e campo aberto preenchido no balcão vira depósito de informação médica sem
> finalidade declarada no termo.
>
> | fator | efeito determinístico |
> |---|---|
> | `suplementacao_creatina` | suprime alerta de água intracelular alta |
> | `composicao_atipica` | suprime alertas de compartimento **absoluto** (água total, proteína, minerais, massa livre de gordura); **mantém** os de **razão** |
> | `gestante_ou_pos_parto` | **bloqueia** a análise — a avaliação é registrada, não interpretada |
> | `edema_relatado` | invalida a leitura de água; demais campos seguem |
> | `uso_de_diuretico` | idem `edema_relatado` |
> | `atleta_competitivo` | suprime comparação com faixa populacional; mantém comparação com o próprio histórico |
>
> **Por que isto existe:** no laudo real de 03/08/2026, com 69,7 kg de massa livre de gordura
> contra a faixa do aparelho de 52,0–64,8 kg, **seis campos saem "acima" numa única medição** —
> e nenhum significa o que o aparelho sugere. Produto que dispara seis alertas falsos por
> avaliação é abandonado na terceira semana, e junto param de ser lidos os alertas verdadeiros.
>
> Fator novo entra por PR do Code **com o teste que prova o que ele suprime**. Sem teste, não
> entra. Quem registra é o **avaliador**, com autor e versão — nunca a recepção.

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
- **fatores de contexto no snapshot, com o que cada um suprimiu** (ADR-037);
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
student_health_context
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

  // ADR-035 — estado, não dado clínico. A IA sabe que há pendência; não sabe qual é.
  pendingMedicalReferral: boolean;
  pendingReferralSince: string | null;

  // ADR-037 — o que a regra já suprimiu, para a análise não reintroduzir em prosa.
  contextFactors: string[];
  suppressedFindings: Array<{ metric: string; reason: string }>;
  analysisBlocked: boolean;          // gestante_ou_pos_parto
}
```

Texto livre é sanitizado e validado contra políticas antes de publicação.

> **Emenda de 19/08/2026 — [ADR-035](../../DECISIONS.md#adr-035).** Os dois campos novos existem
> para impedir o defeito oposto ao de interpretar: sem eles, a análise diria *"sua evolução está
> ótima"* com uma pendência cardíaca aberta na ficha. Com o texto do achado, a IA viraria a
> intérprete. O booleano é o único caminho que evita os dois.
>
> **`attentionPoints` e `questionsForProfessional` aparecem nas três superfícies** — painel, app e
> totem. O tom muda; a existência do item, não. Suprimir um ponto de atenção no app porque a
> linguagem ali é mais leve é omissão de dado de saúde ao titular (LGPD art. 18), não adaptação
> de voz.

> **Emenda de 19/08/2026 — [ADR-037](../../DECISIONS.md#adr-037).** Três campos novos, e uma
> palavra que sai do vocabulário.
>
> `contextFactors` e `suppressedFindings` existem para a IA **não reintroduzir em prosa o alerta
> que a regra determinística já tirou** — sem eles, o modelo lê "água intracelular 31,5 acima de
> 30,4" e escreve o ponto de atenção que o fator `suplementacao_creatina` acabou de suprimir.
> `analysisBlocked` cobre o caso em que a medição não é interpretável (gestação): a avaliação é
> **registrada e não analisada**, e a tela diz isso.
>
> **"Alerta clínico" não existe neste produto.** O que existe é **valor fora da faixa do
> equipamento** — o fato, com a faixa ao lado, sem conduta. A dúvida vai para
> `questionsForProfessional`, que é onde ela tem dono. O nome governa o que o modelo gera:
> *"alerta clínico"* convida a diagnosticar.

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
- `M3-NFR-005`: análise de IA possui timeout, **teto de gasto por tenant** e circuit breaker.
  Estourado o teto, a análise **degrada para modo manual** — a avaliação continua funcionando
  (`M3-NFR-004`), em vez de faturar sem limite. Teto é parâmetro do cliente, não constante
  ([ADR-036](../../DECISIONS.md#adr-036)).
- `M3-NFR-009`: o snapshot enviado ao provedor de IA é **pseudonimizado** — sem nome, sem CPF, sem
  imagem, sem identificador direto — e **nenhum campo de origem `ECG`** o integra. Testado, não
  declarado ([ADR-035](../../DECISIONS.md#adr-035), [ADR-036](../../DECISIONS.md#adr-036)).
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
