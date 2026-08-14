# ArenaHub — PRDs técnicos do módulo Academia

> Fonte operacional para desenvolvimento. A visão ampla permanece em `docs/Especificação Completa — Plataforma Inteligente de Gestão para Academias.md`.

## 1. Estado do documento

- Produto: ArenaHub
- Módulo inicial: Academia
- Modelo: SaaS multi-tenant
- Cliente inaugural: Complexo Arena Positiva
- Arquitetura: monólito modular no cloud e Edge Agent local
- Status dos PRDs: APROVADOS para planejamento
- Aprovação: 14/08/2026
- Última revisão estrutural: 14/08/2026

## 2. Objetivo

Transformar a visão do produto em sete entregas incrementais, testáveis e independentes. Cada MVP possui gates de entrada e saída, requisitos identificados, slices verticais, critérios de aceite e orientações suficientes para Codex ou Claude implementar uma slice por vez sem reinterpretar o roadmap inteiro.

O primeiro marco comercial é operar uma academia com cadastro, direito de acesso, reconhecimento facial, catraca e contingência offline. Os MVPs posteriores adicionam faturamento, saúde, autosserviço, engajamento e retenção sem comprometer esse núcleo.

## 3. Limites do ArenaHub

```text
ArenaHub
├── Core compartilhado
│   ├── tenants e unidades
│   ├── identidade, RBAC e auditoria
│   ├── feature flags
│   ├── eventos e notificações
│   └── observabilidade
└── Módulos de negócio
    └── Academia
```

O Core não será construído como produto abstrato antecipadamente. Cada capacidade compartilhada nasce no primeiro MVP que a consumir, com interface estável para futuros módulos do Complexo Arena Positiva.

## 4. Roadmap e dependências

| Ordem | PRD | Resultado de saída | Depende de |
|---|---|---|---|
| 0 | [POC Topdata](./academia/MVP-00-poc-topdata.md) | Hardware e protocolo comprovados em laboratório | Hardware, SDK e rede de laboratório |
| 1 | [Smart Access](./academia/MVP-01-smart-access.md) | Academia operando acesso online e offline | MVP 0 aprovado |
| 2 | [Smart Billing](./academia/MVP-02-smart-billing.md) | Pagamento controlando entitlement automaticamente | MVP 1 estável e provedor homologado |
| 3 | [Health Intelligence](./academia/MVP-03-health-intelligence.md) | Evolução física rastreável e análise assistiva | Consentimento e protocolo de avaliação |
| 4 | [App e Totem](./academia/MVP-04-app-totem.md) | Autosserviço seguro para o aluno | APIs dos MVPs 1 a 3 estáveis |
| 5 | [Engagement](./academia/MVP-05-engagement.md) | Engajamento opt-in mensurável | Eventos confiáveis de acesso e avaliação |
| 6 | [Retention AI](./academia/MVP-06-retention-ai.md) | Risco explicável convertido em ação operacional | Base histórica e métricas mínimas |

Um MVP só entra em desenvolvimento quando todos os gates obrigatórios de entrada possuem evidência registrada. Dependência futura não pode ser usada para aceitar uma entrega incompleta.

## 5. Arquitetura de referência

```text
apps/
├── admin-web/       # Next.js 16, App Router
├── api/             # NestJS 11, monólito modular
├── edge-agent/      # Node.js/TypeScript, serviço Windows
├── kiosk/           # Next.js PWA, criado no MVP 4
└── mobile/          # Expo/React Native, criado no MVP 4

packages/
├── api-contracts/   # tipos gerados do OpenAPI
├── ui/              # componentes web compartilhados
├── config/          # TypeScript, lint e formatação
└── testing/         # fixtures e utilitários

infra/
├── docker/
├── database/
└── observability/
```

### 5.1 Decisões fixadas

- pnpm workspaces e Turborepo;
- Node.js LTS fixado no repositório e compatível com Next.js 16;
- TypeScript em modo estrito;
- PostgreSQL e Prisma no cloud;
- SQLite no Edge Agent;
- Redis e BullMQ somente para filas persistentes comprovadamente necessárias;
- REST versionado em `/api/v1`, documentado por OpenAPI;
- WebSocket apenas para eventos em tempo real e comunicação autenticada do Edge;
- Object Storage privado compatível com S3;
- transactional outbox para publicação confiável de eventos;
- cloud como source of truth; Edge como executor físico e contingência offline;
- sem microserviços antes de métricas demonstrarem necessidade.

Referências oficiais de implementação:

- [Next.js App Router](https://nextjs.org/docs/app);
- [NestJS](https://docs.nestjs.com/);
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction).

No `admin-web`, Server Components são o padrão. `use client` fica restrito a fronteiras que realmente precisam de estado, efeitos ou APIs do navegador. Server Components consultam a API NestJS diretamente; não chamam Route Handlers internos para criar um salto HTTP desnecessário.

### 5.2 Fluxo operacional

```text
Admin, Mobile ou Totem
          ↓
        API
          ↓
PostgreSQL + Outbox
          ↓
 Worker / BullMQ
          ↓
Edge Agent autenticado
          ↓
SQLite + Device Adapters
          ↓
Leitor facial e catraca
```

## 6. Padrões transversais

### 6.1 Multi-tenancy

- Toda entidade de negócio aplicável possui `tenant_id` e, quando física, `gym_unit_id`.
- O tenant é obtido da identidade autenticada, nunca aceito livremente do corpo da requisição.
- Repositórios recebem `TenantContext` obrigatório.
- Índices e unicidades são definidos dentro do tenant quando o dado não é global.
- Testes de integração tentam explicitamente acessar e alterar dados de outro tenant.
- Super Admin usa contexto elevado auditado, nunca bypass silencioso.

### 6.2 API e erros

- Respostas de erro seguem `application/problem+json`.
- Todo erro exposto contém `type`, `title`, `status`, `code` e `correlationId`.
- Detalhes internos, PII, biometria, tokens e dados de cartão não aparecem em respostas ou logs.
- Listagens usam paginação por cursor quando o volume pode crescer continuamente.
- Datas são ISO 8601 em UTC; apresentação respeita o timezone da unidade.
- Operações idempotentes aceitam `Idempotency-Key` ou identificador externo estável.

### 6.3 Eventos e filas

- Eventos de domínio são persistidos na mesma transação da mudança de estado.
- Consumidores registram chave idempotente antes de produzir efeito externo.
- Retry usa backoff exponencial somente para falhas recuperáveis.
- Falhas permanentes ou tentativas esgotadas vão para dead-letter queue e painel operacional.
- Payloads possuem `eventId`, `eventType`, `occurredAt`, `tenantId`, `aggregateId` e `schemaVersion`.

### 6.4 Segurança e LGPD

- TLS em trânsito e criptografia do provedor em repouso.
- Segredos ficam em secret manager ou variáveis protegidas; nunca no Git.
- Access token de curta duração e refresh token rotativo, revogável e armazenado com hash.
- MFA é obrigatório para perfis administrativos antes da operação comercial.
- Consentimentos são versionados e revogáveis.
- Biometria e dados de saúde recebem finalidade, retenção, trilha de auditoria e exclusão verificável.
- Dados completos de cartão nunca transitam pelo ArenaHub; somente tokens do provedor homologado.
- Toda exportação ou exclusão LGPD é assíncrona, auditada e testada.

### 6.5 Observabilidade

- Logs estruturados incluem `timestamp`, `level`, `service`, `correlationId`, `tenantId` quando permitido e código do evento.
- Métricas mínimas: latência, taxa de erro, backlog de fila, dead letters e disponibilidade do Edge/dispositivos.
- Tracing distribuído cobre API, worker e Edge quando houver chamada remota.
- Alertas devem apontar impacto e ação operacional, não apenas exceções técnicas.

## 7. Comandos obrigatórios

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Comandos específicos de hardware e carga são definidos no MVP correspondente. O bootstrap do repositório deve fazer esses comandos existirem antes da primeira feature.

## 8. Estilo de código

- nomes de domínio em inglês no código e português na interface;
- módulos com fronteiras explícitas; nenhum módulo consulta tabelas privadas de outro módulo;
- controllers validam transporte e delegam; regras ficam em application/domain services;
- DTOs de entrada não são entidades de persistência;
- `unknown` antes de validar dados externos; `any` exige justificativa local;
- erros de domínio possuem código estável;
- arquivos focados; extração é obrigatória quando responsabilidades distintas se misturam.

Exemplo de contrato esperado:

```ts
export type AccessDecision =
  | { outcome: 'ALLOW'; reason: 'ACTIVE_ENTITLEMENT'; validUntil: string }
  | {
      outcome: 'DENY';
      reason: 'NO_ENTITLEMENT' | 'OUTSIDE_SCHEDULE' | 'ADMIN_BLOCK';
    };
```

## 9. Estratégia de testes

| Nível | Responsabilidade |
|---|---|
| Unitário | Jest no API/Edge; Vitest e Testing Library nos componentes web; regras, cálculos, políticas e máquinas de estado |
| Integração | Testcontainers para PostgreSQL/Redis, banco SQLite descartável e adapters externos simulados |
| Contrato | OpenAPI, eventos, API ↔ Edge e webhooks |
| E2E | Playwright nas jornadas web/API; runner mobile compatível com a versão Expo fixada no MVP 4 |
| Hardware | protocolo, latência e recuperação usando equipamentos reais |
| Segurança | tenant isolation, autorização, idempotência e abuso de endpoints |
| Carga | decisão de acesso, ingestão de eventos e webhooks financeiros |

Regras de domínio devem manter cobertura mínima de 80%. Cobertura não substitui os cenários de aceite. Testes removidos ou enfraquecidos exigem aprovação explícita.

## 10. Contrato para Codex e Claude

1. Ler este índice e apenas o PRD do MVP ativo.
2. Selecionar a primeira slice cujo gate esteja atendido e status não seja concluído.
3. Confirmar no repositório os padrões já existentes antes de criar novos.
4. Escrever ou ajustar o teste que demonstra o comportamento esperado.
5. Implementar a menor alteração que faça o teste passar.
6. Executar testes da área, lint, typecheck e build antes de encerrar a slice.
7. Atualizar checklist, evidências, migrações e decisões no PRD.
8. Não iniciar a próxima slice se a atual deixou falha conhecida, migração incompleta ou documentação divergente.

### 10.1 Sempre fazer

- preservar isolamento de tenant;
- validar toda entrada externa;
- manter idempotência em integrações;
- criar migrações reversíveis ou plano explícito de rollback;
- auditar ações sensíveis;
- atualizar OpenAPI, testes e PRD na mesma slice.

### 10.2 Perguntar antes

- adicionar dependência de runtime;
- alterar contratos públicos ou schemas de eventos;
- modificar CI/CD, provedor cloud ou estratégia de autenticação;
- criar serviço separado;
- mudar retenção de dados ou regra de bloqueio financeiro;
- executar migração destrutiva.

### 10.3 Nunca fazer

- versionar segredos ou dados reais de alunos;
- usar CPF como identificador técnico de dispositivo;
- confiar em `tenant_id` fornecido pelo cliente;
- registrar template biométrico, token ou cartão em log;
- processar o mesmo webhook ou evento duas vezes logicamente;
- inserir dado de saúde extraído por IA sem confirmação humana;
- remover teste falhando para liberar entrega.

## 11. Definição de pronto de uma slice

- requisitos e critérios de aceite da slice atendidos;
- migrações aplicadas e rollback documentado;
- testes relevantes verdes;
- lint, typecheck e build verdes;
- OpenAPI e contratos de eventos atualizados;
- telemetria e mensagens operacionais presentes;
- segurança, tenant isolation e auditoria verificadas quando aplicáveis;
- evidência registrada no checklist do PRD;
- nenhuma decisão bloqueante pendente.

## 12. Convenções de rastreabilidade

- requisito funcional: `M{n}-FR-{nnn}`;
- requisito não funcional: `M{n}-NFR-{nnn}`;
- regra de negócio: `M{n}-BR-{nnn}`;
- critério de aceite: `M{n}-AC-{nnn}`;
- evento: nome no passado, em inglês, por exemplo `PaymentConfirmed`;
- status de PRD: `RASCUNHO`, `APROVADO`, `EM_DESENVOLVIMENTO`, `CONCLUÍDO` ou `BLOQUEADO`.

## 13. Decisões que exigem evidência, não suposição

- modelos, firmware, SDK e topologia Topdata: resolvidos no MVP 0;
- provedor financeiro: homologado antes do MVP 2;
- equipamento ou formato de bioimpedância: homologado antes da ingestão automática do MVP 3;
- publicação em lojas mobile: decisão de release do MVP 4;
- canal de WhatsApp/SMS: só entra com provedor e consentimento definidos;
- modelo de churn: somente após baseline mensurável no MVP 6.

Esses itens não são placeholders: cada PRD define um gate objetivo para resolvê-los antes da implementação dependente.
