# F8 — Consentimento, biometria e sync · evidência

> **Fatia:** F8 · **Spec:** [`SPEC-008`](../../specs/SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md) · **Issue:** [#8](https://github.com/RodReis/arenahub/issues/8)
> **Estado:** Tasks 1 a 6 entregues em 16/08/2026, em `SIMULATOR_READY`.
> **Gate físico `M1-HW-01`: NÃO atravessado** — a Task 7 não foi executada.

---

## 1. O que esta entrega cobre

| Task do plano | estado | onde |
|---|---|---|
| 1 — storage privado e readiness | ✅ | `apps/api/src/common/storage/`, `health/` |
| 2 — schema, consentimento, inventário | ✅ | `packages/database`, `modules/privacy`, `modules/devices` |
| 3 — assinatura do Edge e anti-replay | ✅ | `packages/api-contracts`, `modules/edge-auth` |
| 4 — fila durável, DLQ, comandos com lease | ✅ | `modules/device-sync` |
| 5 — worker de sync no Edge Agent | ✅ | `apps/edge-agent/src/cloud/`, `application/device-sync-worker.ts` |
| 6 — revogação, reconciliação e UI | ✅ | `modules/biometrics`, `apps/admin-web/app/(protected)/` |
| 7 — sync físico em hardware | ✅ | gate `M1-HW-01` |

**A cadeia fecha em simulador:** consentimento → identidade → job → comando durável → execução no
adapter → resultado → reconciliação → `DELETED`. O que **não** aconteceu é a execução em hardware
homologado: `M1-AC-004` e `M1-AC-007` seguem **não atendidos fisicamente**, como o plano §1 prevê
para o estado `SIMULATOR_READY`.

## 1.1 Fila e entrega de comando

- **Comando persistido antes de qualquer notificação.** Socket perdido não é comando perdido — há
  teste que prova a entrega sem nenhuma notificação ter sido enviada.
- **Lease de 60 s** com `updateMany` filtrando o estado: dois processos pedindo o mesmo comando
  fazem o segundo receber `count: 0`. Lease expira, então Edge morto não trava a fila.
- **Backoff 1/2/3/5/8 min, dead letter na quinta.** Erro permanente pula direto — gastar cinco
  tentativas repetindo o que já se sabe que falha só atrasa a descoberta.
- **Resultado repetido idêntico é aceito; diferente é recusado.** O Edge pode ter executado no
  leitor e morrido antes de reportar: reenviar precisa ser seguro, mudar a história não.
- **Reconciliação só marca `DELETED` quando nenhum dispositivo tem mais o cadastro** (INV-027).
  Dispositivo em `FAILED` impede o fechamento — declarar limpo um leitor que ainda tem a biometria
  seria mentir na auditoria.

## 2. As três causas da suspensão da ANPD, endereçadas

Em 04/08/2026 a ANPD suspendeu reconhecimento facial na rede estadual do PR por três motivos.
Cada um tem contraparte verificável aqui.

### 2.1 Falta de base legal

Consentimento **específico e destacado** (LGPD art. 11, I), conforme ADR-008. Legítimo interesse
não é hipótese disponível para dado sensível — o art. 11 é lista fechada.

- `ConsentDocument` versionado e imutável; corrigir texto exige versão nova, nunca `UPDATE`.
- `contentSha256` calculado **no servidor** — aceitar o hash do cliente deixaria a prova valer o
  que o cliente disser que ela vale.
- `ConsentRecord` imutável, com ator, IP e user-agent (INV-021). Revogar **cria linha nova**
  apontando para a anterior; a decisão passada ganha `supersededAt` e continua legível.

### 2.2 Ausência de comprovação de segurança

`BiometricIdentity` **não tem coluna de template nem de imagem** (INV-020). Isso é requisito, não
omissão: o template vive no leitor, a imagem no object storage privado, e a tabela guarda apenas
a referência.

Dois testes travam a garantia:

- varredura de `information_schema` provando ausência de `template`, `photo`, `image`;
- varredura por `data_type = 'bytea'` em todas as tabelas da fatia.

A imagem **nunca passa pela API**: o cliente envia direto ao storage por URL pré-assinada com
chave gerada no servidor.

### 2.3 Falha no controle de acesso às imagens

`BiometricAccessLog` registra **quem, quando, o quê e para quê** — nunca o dado acessado
(INV-022). Permissões `biometric.*` são separadas de `student.*`: quem cadastra aluno na recepção
não enxerga, por isso, dado biométrico.

## 3. Delta do ADR-008

| exigência | estado |
|---|---|
| Consentimento por responsável legal para menor de 18 (INV-143) | ✅ nome **e** parentesco obrigatórios; nome solto não comprova vínculo |
| Revalidação na virada dos 18 | ✅ `CONSENT_REVALIDATION_REQUIRED` — a prova continua válida, a **autorização** caduca |
| Caminho alternativo não-biométrico (INV-022b) | ✅ recusar não impede cadastro nem acesso — testado pela porta da frente |
| Revogação = bloqueio lógico imediato (INV-018) | ✅ `DELETION_PENDING` no commit, com exclusão física pendente |
| Expurgo em 30 dias (INV-142) | 🟡 **modelado, não executado** — `TenantPrivacySettings.purgeAfterDays` existe e é parâmetro; falta o job que o aplica |
| Log de acesso a template e imagem | ✅ `BiometricAccessLog` |
| Retenção e log como parâmetro do cliente (art. 39) | ✅ `TenantPrivacySettings`, com `processingInstructions` |

## 4. Autenticação do Edge

Contrato de assinatura em `packages/api-contracts`, **compartilhado** entre quem assina (Edge) e
quem verifica (API). Duas implementações da mesma regra divergem no primeiro detalhe esquecido, e
o sintoma em campo é um 401 que ninguém reproduz.

- Golden vector com hex **literal** — recalcular a assinatura no teste a validaria contra ela mesma.
- Tenant e unidade saem da **credencial**, nunca do corpo (regra de arquitetura nº 2).
- Nonce gravado **depois** de a assinatura conferir; a unique constraint *é* o anti-replay.
- Comparação em tempo constante; timestamp adiantado também recusado.

Dez dos dezessete testes de integração são ataques.

## 5. Números

Contagem reproduzível em [`reports/TESTS.md`](../../../reports/TESTS.md), gerado por
`pnpm test:report` e verificado pela guarda de evidência do CI.

| suíte | testes |
|---|---|
| `apps/api` unidade | 151 |
| `apps/api` integração | 158 |
| `apps/edge-agent` | 136 |
| `packages/database` integração | 28 |
| `packages/api-contracts` unidade | 24 |

## 6. Limites conhecidos

1. **Hardware homologado é lista provisória no código** (`hardware-homologado.ts`). O plano manda
   derivá-la de `supported-hardware.md`, que só existe depois do gate. O código diz isso em
   comentário; firmware aceito é *qualquer um*, débito explícito.
2. **Expurgo dos 30 dias não roda.** `TenantPrivacySettings.purgeAfterDays` existe e é parâmetro,
   mas não há job agendado que o aplique. A referência ao objeto e o carimbo `enrollmentPurgedAt`
   estão modelados e prontos para o job.
3**Sem BullMQ.** A fila vive no Postgres, com o Edge buscando por REST. Redis está provisionado
   e no readiness, mas nenhuma fila foi criada nele — `CLAUDE.md` manda usar BullMQ *só quando
   comprovadamente necessário*, e a entrega durável não precisou. Reavaliar quando houver volume.
4. **Sem WebSocket.** O plano previa `commands.available` como notificação; o poller de 15 s
   resolve com uma peça a menos. O socket entra quando a latência de sincronização virar queixa
   real — o desenho já não depende dele.
5. **UI é leitura, não ação.** As telas mostram consentimento, identidades e a fila; registrar
   consentimento, capturar foto e revogar continuam sendo chamadas de API. Os formulários são
   trabalho de UX que a fatia não cobriu.
6. **`ADR-003` sobre entrega de comando ao Edge não foi escrito.** O plano mandava criar
   `docs/adr/0003-*.md`, o que contraria o ADR-021 (ADR é do Cowork, em `DECISIONS.md`) — ver
   issue [#68](https://github.com/RodReis/arenahub/issues/68). O contrato canônico está
   documentado no próprio `packages/api-contracts/src/edge-auth.ts`, e a decisão precisa virar ADR
   pelo Cowork.

## 7. Decisões técnicas registradas

- **`ioredis` 5.9.0**, não 6.0.0 como o plano pedia — essa major não existe.
- **Readiness escreve a resposta direto**, sem lançar exceção: o `ProblemDetailsFilter` descarta
  campo fora da RFC 9457, e afrouxá-lo para caber uma sonda trocaria a garantia de não-vazamento
  por conveniência.
- **Corpo cru capturado pelo `verify` do parser global**, não por middleware de rota. O
  body-parser do Nest consome o stream no bootstrap; middleware de rota lendo depois encontra o
  stream drenado e a requisição pendura até o timeout — custou um teste travado para descobrir.
