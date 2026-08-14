# PRD técnico — MVP 0: POC Topdata

## 1. Controle

- Status: RASCUNHO — aguardando revisão
- Responsável de produto: ArenaHub
- Tipo: prova técnica descartável com artefatos reutilizáveis apenas após revisão
- Gate de saída: decisão documentada de `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO`
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo e resultado

Eliminar o maior risco técnico antes de construir o produto: comprovar, com os equipamentos reais do Complexo Arena Positiva, que o sistema consegue gerenciar a identidade no leitor facial, receber reconhecimento, decidir acesso, comandar a catraca, registrar passagem, sobreviver à queda de internet e reconciliar eventos.

O MVP termina com uma matriz de compatibilidade e medições reproduzíveis. Uma demonstração isolada sem logs, cenários de falha ou passos reproduzíveis não é aceite.

## 3. Personas

- Operador técnico: instala, configura, executa cenários e coleta evidências.
- Desenvolvedor de integração: implementa adapters e simuladores.
- Responsável operacional: valida se a experiência física é aceitável.
- Responsável LGPD: valida finalidade, consentimento de participantes e descarte dos dados do laboratório.

## 4. Gates de entrada

- [ ] modelo e número de série de cada dispositivo inventariados;
- [ ] firmware registrado;
- [ ] SDK, DLL, protocolo e credenciais oficiais disponíveis legalmente;
- [ ] computador Windows e rede isolada de laboratório disponíveis;
- [ ] diagrama físico de conexão aprovado;
- [ ] participantes do teste consentiram com o uso de imagem/biometria;
- [ ] procedimento de parada de emergência da catraca definido.

Sem esses itens, a POC fica `BLOQUEADA`; não se substitui hardware real por suposição.

## 5. Escopo

### Incluído

- adapter para o leitor facial Topdata disponível;
- adapter EasyInner para a catraca disponível;
- cadastro, atualização quando suportada e exclusão individual de usuário;
- mapeamento entre UUID interno e `enrollid` técnico;
- recepção de identificação/reconhecimento;
- decisão local simples `ALLOW` ou `DENY`;
- comando de liberação e captura de giro/passagem;
- fila local SQLite;
- perda e retorno da conexão cloud simulada;
- heartbeat, logs estruturados e medição de latência;
- simulador mínimo para CI;
- matriz de compatibilidade e relatório final.

### Fora de escopo

- cadastro completo de alunos;
- RBAC de produção;
- assinatura, cobrança ou inadimplência;
- painel administrativo final;
- regras completas de acesso;
- distribuição automática do Edge Agent;
- alta disponibilidade cloud;
- homologação de modelos Topdata não presentes no laboratório.

## 6. Slices verticais

### Slice 0.1 — Bancada reproduzível

Entregas:

- workspace do `edge-agent` executável no Windows;
- configuração validada por schema e variáveis de ambiente;
- inventário dos equipamentos e diagrama de rede;
- health check local;
- logs com `correlationId`;
- script de diagnóstico sem segredos.

Aceite: outro desenvolvedor instala a bancada seguindo o runbook e obtém heartbeat dos componentes disponíveis.

### Slice 0.2 — Ciclo de vida facial

Entregas:

- `TopdataFacialAdapter`;
- criação de usuário individual com `externalEnrollId` não derivado do CPF;
- consulta/identificação conforme capacidade real;
- exclusão e confirmação;
- tabela local de mapeamento e estado da sincronização;
- simulador contratual para CI.

Aceite: criar, reconhecer e remover três identidades de teste sem colisão e sem deixar dado órfão no dispositivo.

### Slice 0.3 — Catraca e passagem

Entregas:

- `TopdataInnerAdapter`;
- decisão local determinística;
- comando de liberação;
- captura de confirmação de giro ou evento equivalente;
- timeout seguro e prevenção de comando duplicado.

Aceite: cenários `ALLOW` e `DENY` produzem comportamento físico e log compatíveis, sem dupla liberação.

### Slice 0.4 — Offline e reconciliação

Entregas:

- cache local de permissões de laboratório;
- fila SQLite de eventos físicos;
- simulação de queda cloud antes e depois do reconhecimento;
- reenvio idempotente após reconexão;
- métricas de latência e backlog.

Aceite: eventos ocorridos offline chegam uma única vez logicamente ao coletor após reconexão e mantêm o horário original.

### Slice 0.5 — Relatório e decisão

Entregas:

- matriz modelo/firmware/capacidade/limitação;
- percentis de latência por etapa;
- falhas conhecidas e workarounds;
- runbook de instalação e diagnóstico;
- ADR sobre tecnologia do Edge e integração EasyInner;
- recomendação `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO`.

Aceite: a decisão pode ser auditada a partir de logs, versões e procedimentos anexados.

## 7. Requisitos funcionais

- `M0-FR-001`: identificar unicamente cada dispositivo por configuração local e inventário.
- `M0-FR-002`: cadastrar um usuário facial por operação e persistir a correlação interna/externa.
- `M0-FR-003`: excluir o usuário no dispositivo e confirmar o resultado.
- `M0-FR-004`: receber evento de reconhecimento com timestamp e identificador externo.
- `M0-FR-005`: produzir decisão local `ALLOW` ou `DENY` com razão estável.
- `M0-FR-006`: comandar uma única liberação para uma decisão autorizada.
- `M0-FR-007`: registrar giro, passagem ou timeout de passagem conforme capacidade do equipamento.
- `M0-FR-008`: enfileirar eventos durante indisponibilidade do coletor cloud.
- `M0-FR-009`: reconciliar eventos com chave idempotente após reconexão.
- `M0-FR-010`: expor heartbeat e estado de conexão sem revelar credenciais.

## 8. Regras de negócio

- `M0-BR-001`: CPF nunca é `enrollid` nem chave de integração.
- `M0-BR-002`: comando repetido com a mesma chave não pode liberar a catraca novamente.
- `M0-BR-003`: ausência de permissão local válida resulta em `DENY`, não em liberação implícita.
- `M0-BR-004`: evento físico mantém `occurredAt` local e recebe `receivedAt` separado no coletor.
- `M0-BR-005`: dado biométrico do laboratório é removido ao encerrar a POC, salvo retenção formalmente autorizada.
- `M0-BR-006`: comportamento não documentado pelo fabricante é registrado como observação, não tratado como contrato.

## 9. Modelo mínimo local

```text
lab_devices
- id
- manufacturer
- model
- serial_number
- firmware
- adapter_type
- configuration_fingerprint

lab_device_users
- id
- device_id
- internal_subject_id
- external_user_id
- sync_status
- last_error_code
- updated_at

lab_access_permissions
- internal_subject_id
- outcome
- valid_until
- cache_version

lab_access_events
- id
- idempotency_key
- device_id
- external_user_id
- decision
- passage_state
- occurred_at
- delivered_at
- attempt_count
```

Nenhum dado pessoal real é necessário além dos participantes consentidos do laboratório.

## 10. Interfaces

```ts
interface FacialDeviceAdapter {
  health(): Promise<DeviceHealth>;
  upsertUser(command: UpsertDeviceUser): Promise<DeviceUserResult>;
  deleteUser(command: DeleteDeviceUser): Promise<DeviceUserResult>;
  subscribeToRecognitions(handler: RecognitionHandler): Promise<Unsubscribe>;
}

interface TurnstileAdapter {
  health(): Promise<DeviceHealth>;
  grantPassage(command: GrantPassage): Promise<GrantResult>;
  subscribeToPassages(handler: PassageHandler): Promise<Unsubscribe>;
}
```

O contrato deve esconder DLL, socket e protocolo específicos. Código do fabricante não pode vazar para regras de acesso.

## 11. Falhas obrigatórias de laboratório

- leitor facial indisponível na inicialização;
- catraca desconectada durante comando;
- reconhecimento duplicado;
- usuário inexistente;
- `enrollid` já utilizado;
- timeout sem giro;
- queda do coletor cloud;
- queda da rede local;
- reinício abrupto do Edge com fila pendente;
- relógio local divergente;
- evento malformado do dispositivo;
- retorno da rede com backlog.

Cada falha deve possuir resultado esperado, código de erro, telemetria e procedimento de recuperação.

## 12. Requisitos não funcionais

- `M0-NFR-001`: medir p50, p95 e máximo entre reconhecimento e comando de liberação.
- `M0-NFR-002`: objetivo de p95 local menor que 300 ms; divergência não reprova automaticamente, mas exige análise.
- `M0-NFR-003`: reinício do processo não pode perder evento confirmado no SQLite.
- `M0-NFR-004`: logs devem permitir reconstruir uma tentativa por `correlationId`.
- `M0-NFR-005`: credenciais devem ser carregadas externamente e mascaradas.
- `M0-NFR-006`: simuladores devem executar em CI sem hardware.
- `M0-NFR-007`: o serviço deve iniciar sem interface gráfica e encerrar graciosamente.

## 13. Testes e comandos

```bash
pnpm --filter edge-agent lint
pnpm --filter edge-agent typecheck
pnpm --filter edge-agent test
pnpm --filter edge-agent test:integration
pnpm --filter edge-agent test:simulator
pnpm --filter edge-agent build
pnpm --filter edge-agent lab:diagnose
pnpm --filter edge-agent lab:run
```

`lab:run` exige confirmação explícita e nunca deve executar no CI. O runbook lista modelo, firmware, cabos, IPs de laboratório e procedimento de rollback.

## 14. Critérios de aceite

- `M0-AC-001`: três usuários são cadastrados e reconhecidos individualmente.
- `M0-AC-002`: os três usuários são removidos e a ausência é confirmada no dispositivo.
- `M0-AC-003`: dez acessos autorizados não produzem dupla liberação.
- `M0-AC-004`: acessos negados não acionam fisicamente a catraca.
- `M0-AC-005`: giro ou ausência de giro é correlacionado à tentativa correta.
- `M0-AC-006`: durante queda cloud, ao menos 100 eventos são persistidos e reconciliados sem duplicação lógica.
- `M0-AC-007`: reinício abrupto com backlog não perde eventos já persistidos.
- `M0-AC-008`: relatório apresenta p50, p95, máximo, taxa de erro e limitações por equipamento.
- `M0-AC-009`: os dados biométricos de laboratório são removidos conforme o termo aplicável.
- `M0-AC-010`: a decisão final e suas restrições são aprovadas por tecnologia e operação.

## 15. Gate de saída

### GO

Todos os critérios críticos atendidos e nenhum bloqueio estrutural.

### GO_WITH_CONSTRAINTS

Operação viável, mas modelos, firmware, topologia ou latência exigem restrições explícitas incorporadas ao MVP 1.

### NO_GO

Não é possível realizar com segurança o ciclo cadastrar → reconhecer → decidir → liberar → registrar, ou a integração depende de condição incompatível com a operação.

O MVP 1 não começa até o gate possuir assinatura do responsável técnico e operacional.

## 16. Checklist de execução

- [ ] Slice 0.1 concluída e evidenciada
- [ ] Slice 0.2 concluída e evidenciada
- [ ] Slice 0.3 concluída e evidenciada
- [ ] Slice 0.4 concluída e evidenciada
- [ ] Slice 0.5 concluída e evidenciada
- [ ] dados de laboratório removidos
- [ ] decisão de saída registrada
- [ ] restrições propagadas para o MVP 1
