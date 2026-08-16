# ARCHITECTURE.md — ArenaHub

> **Status:** vigente a partir de 14/08/2026. Deriva de `docs/prd/README.md` §5/§6 e da
> `Especificação Completa`. Onde a Especificação divergir deste documento ou de um ADR,
> **prevalece o ADR**, depois o PRD, depois este arquivo, depois a Especificação.
>
> **Nada aqui está implementado.** O repositório contém documentação e planos. Este
> documento descreve o alvo, não o construído. Cada seção marcada **`[não construído]`**
> vira realidade na fatia indicada.

---

## 1. Visão em uma tela

```
        ALUNO                        OPERAÇÃO                    PLATAFORMA
   ┌──────────────┐            ┌──────────────────┐         ┌────────────────┐
   │  mobile      │            │   admin-web      │         │  Super Admin   │
   │  (Expo)      │            │   (Next.js)      │         │  (admin-web)   │
   └──────┬───────┘            └────────┬─────────┘         └───────┬────────┘
          │                             │                           │
          │   /api/v1/mobile            │  /api/v1                  │
          └──────────────┬──────────────┴───────────────────────────┘
                         │
                 ┌───────▼────────────────────────────────────┐
                 │           apps/api  (NestJS)               │
                 │        monólito modular · REST + WS        │
                 │  ┌──────────────────────────────────────┐  │
                 │  │ auth · tenants · units · students    │  │
                 │  │ plans · subscriptions · ENTITLEMENTS │  │
                 │  │ billing · payments · devices         │  │
                 │  │ ACCESS · edge · biometrics           │  │
                 │  │ assessments · health · ai            │  │
                 │  │ rankings · achievements · notif      │  │
                 │  │ audit · outbox                       │  │
                 │  └──────────────────────────────────────┘  │
                 └───┬──────────┬───────────┬─────────┬───────┘
                     │          │           │         │
              ┌──────▼───┐ ┌────▼────┐ ┌────▼───┐ ┌───▼──────────┐
              │ Postgres │ │  Redis  │ │   S3   │ │  Provedores  │
              │ (verdade)│ │ BullMQ  │ │ (MinIO)│ │  externos    │
              └──────────┘ └─────────┘ └────────┘ └──────────────┘
                     ▲                                   ▲
                     │ /api/v1/edge (mTLS ou segredo)    │ webhooks assinados
                     │                                   │
   ══════════════════╪═══════════ INTERNET ══════════════╪═══════════════════
                     │                                   │
        ┌────────────▼────────────┐          pagamento / Wellhub / TotalPass
        │  ACADEMIA (rede local)  │
        │  ┌───────────────────┐  │
        │  │  edge-agent       │  │   Node.js + SQLite
        │  │  cache · fila     │  │   + serviço nativo p/ SDK Topdata
        │  └───┬───────────┬───┘  │
        │      │           │      │
        │  ┌───▼────┐  ┌───▼────┐ │      ┌──────────┐
        │  │ leitor │  │catraca │ │      │  kiosk   │  Next.js PWA
        │  │ facial │  │        │ │      │ (totem)  │  /api/v1/kiosk
        │  └────────┘  └────────┘ │      └──────────┘
        └─────────────────────────┘
```

**Leitura em uma frase:** a nuvem decide, o Edge executa e sobrevive à queda da internet, e o
direito de entrar é um **Entitlement** — nunca o estado de um pagamento.

---

## 2. Estilo arquitetural

### 2.1 Monólito modular, e por quê

Um único deployável (`apps/api`) com módulos de fronteira explícita. **Não** microserviços.

O motivo não é gosto: é que o gargalo do produto é **integração com hardware de terceiro e
conformidade**, não escala de tráfego. Dividir em serviços agora multiplica o custo de
operação sem resolver nenhum problema real. Extração de serviço exige **métrica que a
justifique** e ADR (`docs/prd/README.md` §5.1).

### 2.2 Regra de módulo

- Módulo **não lê tabela privada** de outro módulo. Conversa por caso de uso público ou evento.
- Módulo publica **evento de domínio**; não chama consumidor diretamente.
- Controller valida transporte e delega. **Caso de uso controla transação.**
- Cálculo é **função pura**: sem banco, sem rede, sem relógio — o "agora" entra por parâmetro.

### 2.3 Os quatro deployáveis do cliente

| App | Runtime | Rede | Atualização |
|---|---|---|---|
| `admin-web` | Next.js (SSR) | internet | contínua |
| `mobile` | Expo / RN | internet | loja (ver `M4-DIST-01`) |
| `kiosk` | Next.js PWA em quiosque | rede da academia | contínua |
| `edge-agent` | serviço Windows no **PC da recepção** (ADR-011) | rede local | atualização com rollback (`M1-NFR-006`); identidade por **código de pareamento de uso único**, credencial de **segredo por dispositivo** no DPAPI/Credential Manager, rotação automática e revogação no painel (ADR-011) |

O `edge-agent` é o componente de missão crítica hospedado em infraestrutura que **não
controlamos**. Se ele cair, a catraca para. Todo desenho do módulo `edge` parte disso.

---

## 3. Multi-tenancy

**Modelo:** discriminador por linha (`tenant_id`) num banco único. Sem schema por tenant,
sem banco por tenant.

> **Fonte normativa das regras: `docs/CONVENTION.md` INV-001 a INV-008.** O texto abaixo é
> leitura arquitetural delas — em caso de divergência, vale o `CONVENTION.md`.

Regras de aplicação (não negociáveis):

1. Toda entidade de negócio tem `tenant_id`; quando o dado é físico, também `gym_unit_id`.
2. O tenant vem **da identidade autenticada**. Nunca do corpo da requisição, nunca do
   payload de webhook (o webhook resolve o tenant pela conta do provedor — `M2-BR-003`).
3. Repositório recebe `TenantContext` obrigatório. Query sem contexto **não compila** — o
   acesso ao Prisma client é encapsulado em factory que exige o contexto.
4. Unicidade é **dentro do tenant** quando o dado não é global (matrícula, código de unidade,
   `billing_period` de invoice).
5. Super Admin opera por **contexto elevado auditado**, com justificativa e expiração. Não
   existe bypass silencioso.
6. Todo caso de uso multi-tenant crítico tem teste que **tenta cruzar tenants e falha**.

> **Resolvido (ADR-002): dois níveis.** `Tenant` é a academia contratante; `GymUnit` é a unidade
> física. A Especificação §6, que desenha três, é que precisa de nota de emenda. Multiunidade
> está em uso desde o dia 1 — o teste de isolamento por `gym_unit_id` vale tanto quanto o de
> `tenant_id`.

---

## 4. O caminho crítico: da catraca ao entitlement

### 4.1 A cadeia canônica

```
Pagamento confirmado
      │  (webhook assinado, idempotente)
      ▼
   Invoice ──► PAID
      │
      ▼
 Subscription ──► ACTIVE
      │  (regras do plano: unidades, dias, horários, validade)
      ▼
  ENTITLEMENT ──► ACTIVE            ◄── também: cortesia, funcionário, visitante,
      │                                  aula experimental, dependente,
      │                                  convênio corporativo (Wellhub/TotalPass)
      ▼
Access Decision Engine ──► ALLOW / DENY + reason + validUntil + policyVersion
      │
      ▼
  edge-agent ──► comando na catraca ──► PassageConfirmed
```

**A catraca nunca consulta assinatura nem invoice.** Se o motor de acesso precisar saber se
alguém pagou, o desenho está errado — quem sabe disso é o entitlement, e ele já foi resolvido
antes. Isso é o que permite entrada de aluno corporativo, cortesia e visitante sem gambiarra.

### 4.2 Onde a decisão acontece

**Decidido (ADR-004): a nuvem decide. Sempre.** O Edge executa e reporta; não julga.

| modo | quem decide | fonte | quando vale |
|---|---|---|---|
| online | `apps/api` | Postgres | **MVP 1** — caminho único |
| sem nuvem | ninguém decide automaticamente | — | **MVP 1**: liberação manual pela recepção, com registro (`M1-FR-023`) |
| degradado por snapshot | `edge-agent` | snapshot SQLite | **MVP 1.5** (ADR-012), dentro de `offline_cache_validity` + `offline_grace_period` |
| snapshot vencido | `edge-agent` | — | **DENY ou fallback operacional explícito. Nunca allow ilimitado** (`M1-BR-008`) |

> **Gatilho de reabertura.** O orçamento de 300 ms passa a incluir a internet da academia. A POC
> (F3) mede o p95 real; **acima de 300 ms, o ADR-004 reabre** e volta a ser decisão do PI. Até
> essa medição existir, nenhuma promessa de latência é feita a cliente.

### 4.3 Resposta do motor

```jsonc
{
  "outcome": "ALLOW",              // ALLOW | DENY — vocabulário único (ADR-005)
  "studentId": "…",
  "reason": "ACTIVE_ENTITLEMENT",  // código estável, lista fechada
  "validUntil": "2026-09-20T23:59:59-03:00",
  "policyVersion": "2026.08.1"
}
```

**Lista canônica fechada pelo ADR-024 em 16/08/2026** — oito rótulos, dois de `ALLOW` e seis de
`DENY`:

`ACTIVE_ENTITLEMENT` e `MANUAL_OVERRIDE` (allow); `ADMIN_BLOCK`, `STUDENT_BLOCKED`,
`STUDENT_INACTIVE`, `NO_ENTITLEMENT`, `WRONG_UNIT`, `OUTSIDE_SCHEDULE` (deny).

A lista mora em `packages/access-policy/src/types.ts`, junto do motor que a produz — o motor roda
também no Edge, onde não há Zod.

> **Correção de 16/08/2026.** Este parágrafo listava `SUBSCRIPTION_OVERDUE` e `UNIT_NOT_ALLOWED`,
> e dizia que a lista não estava fechada. `UNIT_NOT_ALLOWED` virou `WRONG_UNIT`;
> `SUBSCRIPTION_OVERDUE` **não é razão do motor** — a catraca não consulta assinatura nem invoice
> (Regra de arquitetura 1, ADR-003), e inadimplência chega como `NO_ENTITLEMENT`. A versão errada
> deste parágrafo foi copiada para os três documentos de `docs/design/`, corrigidos junto.

### 4.4 A tela pública nunca vaza

A tela da catraca **não exibe dívida, valor, CPF ou qualquer dado sensível**. Bloqueio por
inadimplência mostra *"Plano pendente. Procure a recepção."* — nada mais (Especificação §114,
`M1 §14`, `M2 §15`).

---

## 5. Integração com hardware

### 5.1 Porta única

São **duas** portas, não uma — conforme `MVP-00` §10. Separá-las importa porque leitor e
catraca podem ser de fabricantes diferentes, e a catraca pode existir sem leitor facial.

```ts
interface FacialDeviceAdapter {
  health(): Promise<DeviceHealth>;
  upsertUser(...): Promise<UpsertResult>;
  deleteUser(...): Promise<void>;
  subscribeToRecognitions(handler): void;
}

interface TurnstileAdapter {
  health(): Promise<DeviceHealth>;
  grantPassage(...): Promise<void>;
  subscribeToPassages(handler): void;
}
```

Implementação inicial: **Topdata** — leitor T4/F4 via WebSocket, catraca via SDK Inner Acesso.

**Não escreva adapters especulativos.** A Especificação §23 já lista ControlID, Henry,
Intelbras e Wiegand — nenhum será implementado antes de existir demanda real. Abstração com
uma implementação só é abstração honesta; abstração desenhada para cinco implementações
imaginárias é dívida.

### 5.2 Sincronização de identidade

O protocolo facial **não tem operação em lote** (Especificação §16). Consequência estrutural:

- Uma operação de sync **por usuário e por dispositivo** (`M1-FR-015`).
- `DeviceUser` é a tabela de junção: `Student.id → DeviceUser → external_user_id (enrollid)`.
- `external_user_id` é **único por dispositivo**, não global.
- A identidade só está *entregue* quando chegou a **todos** os dispositivos-alvo (`M1-AC-004`).
- Fila com retry, backoff e dead letter. Job esgotado é **incidente operacional visível**, não
  linha de log — o aluno fica sem acesso e alguém precisa saber.

> **Risco declarado:** o SDK do leitor facial Topdata é documentado apenas em C# e distribuído
> como DLL. Se for Windows-only, o `edge-agent` precisa de um processo nativo companheiro.
> Isso é o objeto do MVP 0 e do **ADR-010**.

### 5.3 Confirmação de passagem

`ALLOW` **não é presença**. Acesso concedido sem giro confirmado não conta como treino quando
o hardware fornece confirmação confiável (`M3-BR-007`). A máquina `Passage`
(`NOT_APPLICABLE | PENDING | CONFIRMED | TIMED_OUT`) existe justamente para isso — sem ela,
frequência, streak e ranking ficam inflados.

---

## 6. Operação offline

### 6.1 O que o Edge guarda

Snapshot assinado por unidade, com: alunos autorizados, entitlements com janela de validade,
regras essenciais (unidade, dias, horários), identificadores biométricos e configuração dos
dispositivos. **Nunca** dado financeiro, nunca PII além do necessário para decidir.

### 6.2 Parâmetros por academia

| parâmetro | significado |
|---|---|
| `offline_access_enabled` | a academia aceita operar offline? |
| `offline_cache_validity` | por quanto tempo o snapshot é considerado confiável |
| `offline_grace_period` | janela adicional após a validade em que se decide com aviso |

> A Especificação §27 exemplifica cache de 12 h com carência de 24 h — o que deixa 12 h de
> semântica indefinida. **ADR-007** fixa a relação.

### 6.3 Reconciliação

Eventos locais são persistidos **antes** de confirmar o efeito físico (`M1-FR-028`) e
reconciliados depois **mantendo o horário original** (`M1-FR-029`), com idempotência por
`external_event_id`.

Conflito real e previsível: aluno entrou offline com entitlement que a nuvem já havia
revogado. O evento **é aceito e marcado** — a passagem física já aconteceu, negá-la no
histórico seria mentir. O tratamento comercial disso é decisão do PI (**ADR-007**).

---

## 7. Dados

### 7.1 Postgres é a verdade

- Prisma como ORM; schema, migrations, client factory e `seed.ts` moram em **`packages/database`**
  (ADR-020). `infra/database/` fica com o que é infraestrutura de verdade. Pendência que sobra:
  emenda ao `prd/README.md` §5, que ainda não prevê o pacote.
- Migração é **reversível ou tem rollback documentado** (`docs/prd/README.md` §10.1).
- Dinheiro é **inteiro na menor unidade** (`M2-BR-001`). Nunca float.
- Datas persistidas em **UTC (ISO 8601)**; apresentação no timezone da **unidade**.
- `access_events` cresce sem limite — índice por `(tenant_id, gym_unit_id, occurred_at)` desde
  o dia 1; particionamento quando a métrica exigir, não antes.

### 7.2 SQLite é operacional

Banco do `edge-agent`: snapshot, fila de sync, eventos pendentes. Descartável e reconstruível
a partir da nuvem. Nunca é fonte de verdade de nada.

### 7.3 Object Storage

Fotos, documentos e laudos em bucket **privado**, acesso só por URL temporária. Arquivo
temporário de OCR tem retenção curta e **deleção verificável** (`M3 §15`).

---

## 8. Contratos de API

| prefixo | consumidor | autenticação |
|---|---|---|
| `/api/v1/*` | admin-web | sessão + RBAC, MFA obrigatório para perfis administrativos |
| `/api/v1/mobile/*` | app do aluno | token de aluno + refresh rotativo |
| `/api/v1/kiosk/*` | totem | credencial de dispositivo + sessão efêmera |
| `/api/v1/edge/*` | edge-agent | **certificado ou segredo rotacionável por dispositivo** |
| `/webhooks/{provider}` | provedores | assinatura verificada antes de qualquer efeito |

Regras transversais (`docs/prd/README.md` §6.2):

- Erro sempre em `application/problem+json` com `type`, `title`, `status`, `code`,
  `correlationId`. **Nunca** detalhe interno, PII, biometria, token ou cartão.
- Paginação **por cursor**. Nunca offset em lista que cresce.
- Operação idempotente aceita `Idempotency-Key` ou identificador externo estável.

> `/api/v1/edge/*` é o contrato mais rígido do sistema: roda em máquina de terceiro que **não
> atualiza sozinha**. Breaking change nele exige versão paralela e janela de convivência.
> Ver **ADR-011**.

---

## 9. Eventos e filas

**Transactional outbox.** O evento é persistido na mesma transação da mudança de estado; um
publisher separado o entrega. Publicar antes de commitar é bug de arquitetura, não detalhe.

Envelope obrigatório:

```jsonc
{ "eventId": "…", "eventType": "PaymentConfirmed", "occurredAt": "…",
  "tenantId": "…", "aggregateId": "…", "schemaVersion": 1 }
```

- Nome de evento: **inglês, no passado** (`EntitlementActivated`, `PassageConfirmed`).
- Consumidor registra a **chave idempotente antes** do efeito externo.
- Backoff exponencial **só para falha recuperável**. Falha permanente vai para DLQ **com
  painel operacional** — DLQ sem painel é lixeira.
- Redis + BullMQ entram **quando necessário**, não por padrão (`docs/prd/README.md` §5.1).

---

## 10. Segurança e LGPD

Não é seção de conformidade — é requisito funcional. **Fonte do fato e das datas:
`docs/LANDSCAPE.md` §4.1.** Em **04/08/2026** a ANPD determinou
suspensão imediata de reconhecimento facial na rede estadual do Paraná por três motivos:
**falta de base legal**, **ausência de comprovação de segurança** e **falha no controle de
acesso às imagens** São exatamente as três coisas que este sistema precisa provar.

| requisito | onde vive |
|---|---|
| Consentimento versionado, revogável, com versão/finalidade/ator/IP/dispositivo | `Consent` |
| **Caminho alternativo não-biométrico funcional** (QR, cartão, PIN, recepção) | motor de acesso |
| Revogação = bloqueio lógico imediato + `DeviceSyncJob DELETE` + auditoria | `biometrics` |
| Template biométrico não persistido quando o dispositivo não exigir | `M1-FR-014` |
| Log de quem acessou template/imagem | `audit` |
| **Expurgo em 30 dias** após o fim do vínculo, no banco e nos leitores, com evidência | INV-142 (ADR-008) |
| **Consentimento de menor por responsável legal** — há aluno menor; escopo obrigatório de F8 | INV-143 (ADR-008) |
| Dado de cartão nunca transita pelo ArenaHub (tokenização hospedada) | `payments` |
| Segredo em secret manager, nunca no Git | infra |
| MFA obrigatório para perfis administrativos | `auth` |
| Exportação e exclusão LGPD assíncronas, auditadas e **testadas** | `students` |

---

## 11. Observabilidade

Log estruturado com `timestamp`, `level`, `service`, `correlationId`, `tenantId` (quando
permitido) e código de evento. Tracing distribuído API ↔ worker ↔ Edge.

Métricas mínimas: latência, taxa de erro, **backlog de fila**, **dead letters**,
**disponibilidade de Edge e dispositivos**.

**Alerta aponta impacto e ação, não exceção técnica.** "Catraca da unidade Centro offline há 5
minutos — recepção precisa liberar manualmente" é alerta. `ECONNREFUSED` não é.

Stack (OpenTelemetry, Sentry, Prometheus, Grafana, Loki) é **possibilidade, não compromisso** —
entra quando houver o que observar.

---

## 12. Resiliência

| falha | comportamento exigido |
|---|---|
| Internet cai na academia | Edge decide por snapshot dentro da política; eventos enfileirados |
| Edge reinicia | **nenhum evento persistido se perde** (`M1-NFR-004`) |
| Provedor de pagamento fora | leitura de invoices já armazenadas não degrada (`M2-NFR-008`) |
| Webhook atrasado | consulta ativa de status (`M2-FR-006`); confirmação do provedor prevalece sobre retorno visual |
| Webhook fora de ordem | não regride estado terminal válido (`M2-FR-009`) |
| OCR/IA fora | avaliação manual continua funcionando (`M3-NFR-004`) |
| IA lenta ou cara | timeout, orçamento e circuit breaker (`M3-NFR-005`) |
| Job de sync esgota retries | incidente visível na operação, não log silencioso |

---

## 13. Fronteiras externas (todo dublê vive aqui)

> **Fonte desta tabela: `docs/TESTING.md` §3.** Mudou lá, muda aqui — nunca o contrário.

| boundary | porta | dublê de teste |
|---|---|---|
| Leitor facial Topdata | `FacialDeviceAdapter` | simulador contratual (`M0-NFR-006`) |
| Catraca Topdata | `TurnstileAdapter` | simulador contratual (`M0-NFR-006`) |
| Provedor de pagamento | `PaymentProvider` | `FakePaymentProvider` |
| Extração de laudo (OCR) | `DocumentExtractor` | fake + golden files anonimizados |
| Análise de IA | `AIProvider` | fake determinístico |
| Antivírus de upload | `MalwareScanner` | fake |
| Convênio corporativo | `CorporateCheckInProvider` | fake *(fatia futura — ver ADR-009)* |
| Notificação (push/e-mail/WhatsApp) | `NotificationChannel` | fake |

**Regra:** o dublê substitui o processo externo, **nunca a regra de domínio**. Teste que
mocka o próprio caso de uso não testa nada.

---

## 14. O que este documento deliberadamente não define

Está aberto, com ADR correspondente. Não invente resposta — pergunte ao PI.

| tema | ADR |
|---|---|
| Semântica de validade × carência offline e conflito de reconciliação | ADR-007 *(sem urgência — migrou com F10 para o MVP 1.5)* |
| Provedor de pagamento e modelo de `Payment` | ADR-013 *(sai do card `[GATE]` de homologação)* |
| **Transferência internacional** de dado sensível, se o provedor de IA de saúde estiver fora do Brasil | ADR-008, ponto remanescente *(bloqueia **F21**, não F8)* |

**Decididos em 14/08/2026** — não reabrir sem ADR novo: hierarquia de dois níveis (ADR-002),
decisão de acesso na nuvem (ADR-004), vocabulário único (ADR-005), retenção de 30 dias e
consentimento de menor (ADR-008), entitlement sem convênio hoje (ADR-009), Edge no PC da
recepção (ADR-011), offline no MVP 1.5 (ADR-012), âncora de bloqueio configurável (ADR-019) e
`packages/database` (ADR-020). Detalhe em `docs/DECISIONS.md`.

**Acrescentado na segunda rodada de 14/08/2026:** identidade e credencial do Edge por pareamento
de uso único + segredo por dispositivo, com rotação automática (ADR-011); base legal da biometria
por **consentimento específico e destacado**, academia controladora e ArenaHub operador, RIPD por
template nosso (ADR-008). **Correção registrada:** legítimo interesse não é hipótese disponível
para dado sensível — o art. 11 da LGPD é lista fechada.
