# F8 — Consentimento, biometria e sync · evidência

> **Fatia:** F8 · **Spec:** [`SPEC-008`](../../specs/SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md) · **Issue:** [#8](https://github.com/RodReis/arenahub/issues/8)
> **Estado:** entrega parcial em 16/08/2026 — Tasks 1, 2, 3 e a revogação da Task 6.
> **Gate físico `M1-HW-01`: NÃO atravessado.** A fatia está em `SIMULATOR_READY`.

---

## 1. O que esta entrega cobre

| Task do plano | estado | onde |
|---|---|---|
| 1 — storage privado e readiness | ✅ | `apps/api/src/common/storage/`, `health/` |
| 2 — schema, consentimento, inventário | ✅ | `packages/database`, `modules/privacy`, `modules/devices` |
| 3 — assinatura do Edge e anti-replay | ✅ | `packages/api-contracts`, `modules/edge-auth` |
| 4 — fila BullMQ, DLQ, comandos duráveis | ❌ pendente | — |
| 5 — worker de sync no Edge Agent | ❌ pendente | — |
| 6 — revogação | ✅ | `modules/biometrics` |
| 6 — reconciliação e UI admin | ❌ pendente | — |
| 7 — sync físico em hardware | 🚫 bloqueado | gate `M1-HW-01` |

**Isto não conclui a F8.** O `M1-AC-004` e o `M1-AC-007` **não** estão atendidos: a identidade
ainda não chega a dispositivo nenhum, porque a fila e o worker do Edge não existem. O que está
pronto é a metade de cima da cadeia — consentimento, identidade, alvos de sync e autenticação do
Edge.

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

| suíte | testes |
|---|---|
| `apps/api` unidade | 137 |
| `apps/api` integração | 144 |
| `packages/database` integração | 28 |
| `packages/api-contracts` unidade | 24 |

## 6. Limites conhecidos

1. **A identidade não chega a dispositivo nenhum.** Os `DeviceSyncJob` são criados e ficam em
   `PENDING`; não há worker que os consuma. É a Task 4 + 5.
2. **Hardware homologado é lista provisória no código** (`hardware-homologado.ts`). O plano manda
   derivá-la de `supported-hardware.md`, que só existe depois do gate `M1-HW-01`. O código diz
   isso em comentário; firmware aceito é *qualquer um*, débito explícito.
3. **Expurgo dos 30 dias não roda.** Só o parâmetro existe.
4. **Sem UI.** Toda a fatia é backend; a tela de cadastro e o painel de pendência são Task 6.
5. **`ADR-003` sobre entrega de comando ao Edge não foi escrito.** O plano mandava criar
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
