# PRD técnico — MVP 5: Engagement

## 1. Controle

- Status: RASCUNHO — aguardando revisão
- Dependências: eventos confiáveis de acesso, frequência e avaliações; app do MVP 4 disponível
- Resultado: engajamento voluntário, mensurável e seguro sem incentivar comportamento excessivo
- Princípio: participação em ranking e uso público de identidade são opt-in separados
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo

Criar conquistas, XP, streaks, metas, rankings e notificações que reforcem consistência e evolução. O sistema deve evitar premiar excesso de treino, exposição corporal indevida, manipulação de eventos e competição baseada apenas em peso absoluto.

## 3. Métricas de sucesso

- opt-in e opt-out aplicados em até uma publicação de ranking;
- nenhum aluno não consentido aparece em ranking ou desafio público;
- XP e conquistas são idempotentes e reconstruíveis a partir dos eventos de origem;
- nenhuma regra padrão recompensa múltiplas entradas no mesmo dia;
- aumento mensurável de frequência consistente no grupo participante sem aumento de alertas de uso excessivo;
- taxa de desativação e denúncia acompanhada por tipo de campanha/desafio.

## 4. Personas

- Aluno participante: controla adesão, nome público e visibilidade de métricas.
- Aluno não participante: usa o restante do produto sem penalidade.
- Gerente de engajamento: configura campanhas dentro de templates seguros.
- Profissional: acompanha metas vinculadas quando autorizado.
- Moderador/Suporte: trata nomes inadequados, abuso e contestação de pontuação.

## 5. Gates de entrada

- [ ] política de opt-in e privacidade aprovada;
- [ ] catálogo inicial de conquistas revisado por operação/profissional;
- [ ] definição de sessão de treino e deduplicação estabilizada;
- [ ] limites contra treino excessivo aprovados;
- [ ] canais de notificação e consentimentos disponíveis;
- [ ] regras de moderação, contestação e remoção definidas;
- [ ] métricas de baseline coletadas antes do piloto.

## 6. Escopo

### Incluído

- preferências de participação e identidade pública;
- XP como ledger de eventos;
- conquistas configuradas por catálogo versionado;
- streak semanal orientado à consistência;
- metas e progresso elegíveis;
- rankings por frequência, consistência e evolução relativa;
- períodos mensal, trimestral, semestral e anual quando houver dados;
- desafios por unidade com templates;
- notificações internas e push;
- moderação, contestação e recálculo;
- métricas de engajamento e segurança.

### Fora de escopo

- feed social, comentários ou mensagens entre alunos;
- prêmios em dinheiro;
- apostas;
- marketplace;
- ranking por peso absoluto perdido;
- recomendação de treino;
- WhatsApp/SMS sem provedor, consentimento e gate próprios;
- campanhas automáticas de retenção, tratadas no MVP 6.

## 7. Slices verticais

### Slice 5.1 — Preferências e identidade pública

- consentimento de ranking;
- escolha entre primeiro nome, apelido aprovado ou anonimização;
- visibilidade de posição e métrica;
- opt-out com retirada da próxima projeção;
- auditoria.

Aceite: aluno não consentido nunca aparece em API, cache, exportação ou tela pública.

### Slice 5.2 — XP e conquistas

- ledger append-only de XP;
- catálogo versionado de regras;
- consumidores idempotentes;
- concessão e revogação corretiva;
- tela de conquistas e explicação.

Aceite: reprocessar eventos não duplica XP e o saldo pode ser reconstruído.

### Slice 5.3 — Consistência e streak

- sessões elegíveis deduplicadas;
- streak semanal com meta saudável configurada;
- período de tolerância transparente;
- pausa de assinatura sem punição indevida;
- prevenção de múltipla pontuação diária.

Aceite: consistência recompensa semanas válidas, não número ilimitado de acessos.

### Slice 5.4 — Rankings privados por padrão

- snapshots por período e categoria;
- métricas relativas e critérios de elegibilidade;
- desempate determinístico;
- identidade pública conforme preferência;
- publicação e retirada.

Aceite: snapshot permanece auditável e não muda silenciosamente após publicação.

### Slice 5.5 — Desafios e notificações

- templates seguros de desafio;
- inscrição opt-in;
- progresso;
- notificações internas/push com quiet hours;
- encerramento e resultado.

Aceite: desafio não permite regra fora dos limites de segurança e respeita consentimento de canal.

### Slice 5.6 — Operação, moderação e experimento

- fila de contestação;
- moderação de apelidos;
- recálculo controlado;
- feature flags e experimento com grupo controle;
- dashboard de participação, retenção e sinais adversos.

Aceite: equipe corrige pontuação e remove exposição sem editar banco diretamente.

## 8. Requisitos funcionais

- `M5-FR-001`: registrar opt-in separado para ranking, desafios e marketing/notificações opcionais.
- `M5-FR-002`: permitir escolha e alteração de identidade pública sujeita a moderação.
- `M5-FR-003`: remover participante de futuras projeções após opt-out.
- `M5-FR-004`: registrar cada concessão de XP com evento de origem e regra versionada.
- `M5-FR-005`: impedir concessão duplicada para a mesma regra e evento.
- `M5-FR-006`: conceder conquistas somente quando critérios verificáveis forem atendidos.
- `M5-FR-007`: revogar concessão incorreta por movimento compensatório auditado.
- `M5-FR-008`: calcular streak por semanas elegíveis e política versionada.
- `M5-FR-009`: excluir pausas aprovadas do rompimento de streak conforme regra.
- `M5-FR-010`: gerar snapshot imutável de ranking por tenant/unidade, período e categoria.
- `M5-FR-011`: aplicar elegibilidade mínima para proteger privacidade e qualidade estatística.
- `M5-FR-012`: calcular evolução física com métricas relativas aprovadas, sem expor valor absoluto quando oculto.
- `M5-FR-013`: criar desafios apenas a partir de templates permitidos.
- `M5-FR-014`: inscrever e retirar aluno de desafio sem afetar o restante do app.
- `M5-FR-015`: enviar notificação somente por canal consentido e dentro de quiet hours.
- `M5-FR-016`: permitir contestar XP, conquista ou ranking.
- `M5-FR-017`: recalcular projeção e registrar diferença sem apagar snapshot publicado.
- `M5-FR-018`: medir exposição, adesão, conclusão, opt-out e denúncia.

## 9. Regras de negócio

- `M5-BR-001`: nenhuma participação é habilitada por padrão.
- `M5-BR-002`: recusar ranking não reduz funcionalidade, XP privado ou acesso.
- `M5-BR-003`: no máximo uma sessão elegível por janela diária gera XP de treino.
- `M5-BR-004`: entrada sem passagem confirmada não gera XP quando a confirmação estiver disponível.
- `M5-BR-005`: streak padrão mede semanas consistentes, não dias consecutivos ilimitados.
- `M5-BR-006`: rankings físicos usam variação relativa e exigem baseline comparável.
- `M5-BR-007`: categoria não é publicada abaixo do mínimo de participantes definido pela política.
- `M5-BR-008`: empate usa critério estável publicado; sorteio não ocorre silenciosamente.
- `M5-BR-009`: alteração de regra cria nova versão e não reescreve snapshot passado.
- `M5-BR-010`: XP não possui valor financeiro e não pode ser transferido.
- `M5-BR-011`: desafio não pode exigir frequência acima do limite profissional aprovado.
- `M5-BR-012`: apelido ofensivo ou identificador pessoal sensível pode ser rejeitado com motivo.

## 10. Modelo de dados

```text
engagement_preferences
public_profiles
xp_rules, xp_ledger
achievement_definitions
student_achievements
streak_policies, student_streaks
ranking_definitions
ranking_snapshots, ranking_entries
challenge_templates
challenges, challenge_participants
notification_preferences
notifications, notification_deliveries
engagement_disputes
```

O saldo de XP é projeção do ledger. Snapshots publicados não são recalculados in-place; correções geram revisão vinculada.

## 11. API

```text
GET    /api/v1/mobile/engagement/preferences
PATCH  /api/v1/mobile/engagement/preferences
GET    /api/v1/mobile/achievements
GET    /api/v1/mobile/xp
GET    /api/v1/mobile/streak
GET    /api/v1/mobile/rankings
GET    /api/v1/mobile/challenges
POST   /api/v1/mobile/challenges/:id/join
DELETE /api/v1/mobile/challenges/:id/join
POST   /api/v1/mobile/engagement/disputes

GET    /api/v1/engagement/rules
POST   /api/v1/engagement/rankings/:id/publish
POST   /api/v1/engagement/challenges
GET    /api/v1/engagement/disputes
POST   /api/v1/engagement/disputes/:id/resolve
```

## 12. Eventos

Consumidos:

```text
PassageConfirmed
AssessmentPublished
HealthGoalReached
SubscriptionPaused
SubscriptionActivated
```

Produzidos:

```text
XPGranted
XPAdjusted
AchievementUnlocked
StreakExtended
StreakBroken
RankingPublished
ChallengeJoined
ChallengeCompleted
EngagementOptedOut
```

## 13. UX e segurança comportamental

- sempre mostrar por que o aluno recebeu XP/conquista;
- exibir datas e regras do ranking;
- não usar linguagem de culpa ao romper streak;
- pausa ou lesão não gera mensagem de pressão;
- configuração permite ocultar posição e valores absolutos;
- notificações possuem frequência máxima e quiet hours;
- telas não apresentam gordura, peso ou outras medidas de terceiros;
- denúncia e opt-out ficam acessíveis, não escondidos em menus profundos.

## 14. Segurança, privacidade e antifraude

- snapshot filtra opt-in antes de materializar entradas;
- caches e analytics não recebem identidade pública de não participantes;
- jobs usam eventos deduplicados;
- padrões impossíveis de acesso geram revisão, não punição automática;
- operadores não concedem XP arbitrário sem permissão e justificativa;
- exportações de ranking respeitam a mesma política da tela;
- métricas de saúde usadas no ranking exigem consentimento específico e escopo mínimo.

## 15. Requisitos não funcionais

- `M5-NFR-001`: processamento de evento é idempotente e reexecutável.
- `M5-NFR-002`: projeções de XP e streak podem ser reconstruídas a partir do ledger/eventos.
- `M5-NFR-003`: opt-out reflete em novas leituras e publicação em até 15 minutos.
- `M5-NFR-004`: ranking publicado responde p95 menor que 500 ms sem cálculo síncrono pesado.
- `M5-NFR-005`: geração de snapshot não bloqueia eventos operacionais.
- `M5-NFR-006`: notificações possuem rate limit por aluno, tenant e campanha.
- `M5-NFR-007`: critérios e versão de regra são auditáveis.
- `M5-NFR-008`: UX essencial atende acessibilidade equivalente ao MVP 4.

## 16. Testes obrigatórios

- opt-in, alteração de nome público, opt-out e cache;
- reprocessamento e concorrência de XP;
- múltiplas entradas diárias e evento sem passagem;
- semana incompleta, pausa e timezone da unidade;
- ranking com poucos participantes, empate e dado ausente;
- métrica física sem consentimento;
- snapshot imutável e correção por revisão;
- desafio acima do limite seguro rejeitado;
- quiet hours, limite de frequência e revogação de push;
- tenant isolation, moderação e disputa;
- experimento sem contaminar grupo controle.

## 17. Critérios de aceite

- `M5-AC-001`: aluno não opt-in não aparece em qualquer representação pública.
- `M5-AC-002`: reprocessar cem vezes o mesmo evento gera uma concessão de XP.
- `M5-AC-003`: duas entradas no mesmo dia não duplicam XP de treino.
- `M5-AC-004`: streak respeita semanas válidas, pausa e timezone.
- `M5-AC-005`: ranking físico não expõe medida absoluta oculta.
- `M5-AC-006`: categoria abaixo do mínimo não é publicada.
- `M5-AC-007`: regra alterada não muda snapshot histórico silenciosamente.
- `M5-AC-008`: desafio inseguro é rejeitado antes da publicação.
- `M5-AC-009`: opt-out remove o aluno da próxima leitura/publicação dentro do SLO.
- `M5-AC-010`: contestação é resolvida com trilha e movimento corretivo.

## 18. Rollout

1. XP privado e conquistas internas;
2. streak para grupo piloto;
3. ranking sem identidade pública para validação;
4. opt-in e publicação em uma unidade;
5. desafios com templates limitados;
6. experimento controlado e expansão após análise de sinais positivos/adversos.

Feature flags: `XP`, `ACHIEVEMENTS`, `STREAKS`, `RANKINGS`, `CHALLENGES`, `ENGAGEMENT_PUSH`.

## 19. Checklist

- [ ] Gates de privacidade e segurança comportamental aprovados
- [ ] Slice 5.1 — Preferências e identidade pública
- [ ] Slice 5.2 — XP e conquistas
- [ ] Slice 5.3 — Consistência e streak
- [ ] Slice 5.4 — Rankings
- [ ] Slice 5.5 — Desafios e notificações
- [ ] Slice 5.6 — Operação e experimento
- [ ] piloto analisado contra baseline
