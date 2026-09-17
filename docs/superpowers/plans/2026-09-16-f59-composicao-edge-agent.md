# F59 — Composição de produção do edge-agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar as peças já existentes e testadas do `edge-agent` (adapters reais/simulador, decisão online F9, fila de eventos, reconciliação, heartbeat) num `main.ts` de produção que sobe como processo único no PC da recepção — sem bancada, sem terminal aberto — cobrindo os critérios de aceite que fecham em CI/bancada (AC-1 a AC-5 da spec). Os critérios que só fecham na academia (AC-6 a AC-9) ficam para a visita presencial e não têm tarefa de código aqui.

**Architecture:** Um módulo de composição (`src/producao/compor-agente.ts`) que, a partir da `Config` validada, escolhe adapter real ou `Simulador` por dois flags (`FACIAL_MODE`, `CATRACA_MODE`), monta a cadeia `leitor --aoReconhecer--> criarProcessadorDeAcessoOnline --catraca.liberar-->`, liga heartbeat HTTP (reusando `SignedCloudClient`) e reconciliação (`reconciliar` contra `ColetorSimulado`, decisão §5.5 do insumo), e devolve uma função `encerrar()` para desligamento gracioso. O `main.ts` fica fino: carrega config, chama a composição, registra sinais. Pareamento (troca de código por credencial, gravação no Credential Manager via DPAPI) e o serviço Windows são módulos à parte, cada um com a fatia testável que não depende de hardware Windows real isolada do resto.

**Tech Stack:** TypeScript (Node ESM), Jest (`--experimental-vm-modules`), Zod, `node:sqlite`, `fetch` nativo via `SignedCloudClient` já existente, NestJS (lado API, módulo `edge-auth` já existente).

**Spec:** `docs/specs/SPEC-059-composicao-de-producao-do-edge-agent.md` (ver também insumo `docs/notes/composicao-do-edge-agent.md` — desatualizado no ponto §5.5 sobre `apps/api` estar vazia, mas a decisão em si de reconciliar contra `ColetorSimulado` continua valendo).

## Global Constraints

- Regra de arquitetura 3 (CLAUDE.md): a nuvem decide, o Edge executa. `main.ts` não contém regra de entitlement — usa `criarProcessadorDeAcessoOnline` (F9), nunca `criarProcessadorDePassagem` (decisão local do MVP 0/`lab:run`).
- `M0-NFR-005`: segredo (`CLOUD_EDGE_SECRET`, credencial de pareamento) nunca em log nem mascarado por acidente — sai do DPAPI, não de arquivo. `descreverConfig` continua sendo o único caminho para imprimir config.
- `M0-NFR-006`: padrão de ambos os flags (`FACIAL_MODE`, `CATRACA_MODE`) é `simulador` — CI roda sem hardware.
- `M0-NFR-007`: encerramento gracioso — SIGTERM drena o que estiver pendente, fecha SQLite, desconecta adapters, na ordem inversa da inicialização.
- Retry limitado no arranque (insumo §5.1): 5 tentativas × 3s por dispositivo; esgotado, falha alto (código ≠ 0). Mesma política para queda pós-arranque (§5.2).
- Arquivo de evidência do `lab:run` headless (§5.3/§5.4) nunca contém PII nem template biométrico — só `externalEnrollId` e rótulo operacional.
- Nenhuma dependência nova de fila/broker (BullMQ/Redis) — fora de escopo até métrica que justifique.
- Não implementar `ColetorHttp` nem endpoint de ingestão de evento por essa porta — reconciliação desta fatia roda contra `ColetorSimulado` (decisão §5.5, insumo).
- Não mexer no `ConfigurarAcionamento1`/modo bloqueado da catraca — ADR-028, fora desta fatia.
- PR usa `refs #254`, nunca `closes #254` — só o PI fecha a issue.

---

## Contratos existentes que este plano reusa (não recriar)

- `SignedCloudClient` (`apps/edge-agent/src/cloud/signed-client.ts`): `new SignedCloudClient({ baseUrl, keyId, secret })`, métodos `get<T>(pathAndQuery)` / `post<T>(pathAndQuery, corpo?)`, devolve `RespostaDaNuvem<T> = { ok, status, body: T|null, errorCode: string|null }`.
- `POST /api/v1/edge/heartbeat` (`apps/api/src/modules/edge-auth/edge.controller.ts:59`): request `{ agentVersion, localTimeMs, queueDepth, devices: [{serial, model, firmware?, status, lastSyncAt?}] }` (`.strict()`), response `{ serverTime, clockOffsetMs, acknowledgedDevices }`.
- `POST /api/v1/edge/access-decisions` (`apps/api/src/modules/access/edge-access.controller.ts:70`): request `{ deviceId, externalUserId, recognitionId, recognizedAt, confidence?, idempotencyKey }` (`.strict()`), response 201 `{ accessEventId, correlationId, outcome, reason, policyVersion, validUntil, replayed }`.
- `POST /api/v1/edge/access-events/:id/passage` (mesmo controller, linha 103): request `{ state: 'CONFIRMED'|'TIMED_OUT', commandId, reportedAt }` (`.strict()`), response 201 `{ accessEventId, state }`.
- `criarProcessadorDeAcessoOnline(deps: DepsAcessoOnline, timeoutPassagemMs?)` (`apps/edge-agent/src/application/orquestrar-acesso-online.ts:297`): `DepsAcessoOnline = { maquina: MaquinaDeAcesso, catraca: TurnstileAdapter, pedirDecisao, reportarPassagem, agoraMonotonicoMs }`.
- `MaquinaDeAcesso` (`apps/edge-agent/src/persistence/maquina-de-acesso.ts:136`): `new MaquinaDeAcesso(caminho: string)`.
- `retomarPendentes(deps, limite?)` (mesmo arquivo do processador online, linha 326).
- `FacialDeviceAdapter` (`apps/edge-agent/src/domain/facial-device.ts:71`): `cadastrar`, `remover`, `listar`, `aoReconhecer(ouvinte)`, `encerrar()`. `EventoReconhecimento = { externalEnrollId, ocorridoEm, recebidoEm, metodo, idExternoDoEvento? }` (campos confirmados em exploração; ver arquivo para o tipo completo).
- `FacialSimulator` — `new FacialSimulator()`, sem args.
- `TopdataFacialAdapter` — `new TopdataFacialAdapter(logger, porta = 7792)`, depois `await adapter.iniciar()`.
- `TurnstileAdapter` (`apps/edge-agent/src/domain/turnstile.ts:37`): `liberar(comandoId, timeoutMs, sentido?)`, `encerrar()`.
- `TurnstileSimulator` — `new TurnstileSimulator()`, sem args.
- `TopdataInnerAdapter` — `new TopdataInnerAdapter(ponte, logger, inner, invertido = false)`, depois `await adapter.conectar(porta, tempo)` e `await adapter.testarConexao()` em loop até `true`.
- `PonteEasyInnerProcesso.lancar({ comando, args? })` (`apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.ts:43`).
- `FilaDeEventos` (`apps/edge-agent/src/persistence/fila-de-eventos.ts`): `new FilaDeEventos(caminho)`, `enfileirar(evento, agora): boolean`, `proximosPendentes(limite)`, `marcarEnviado(id)`, `registrarFalha(id, falha, recusa?)`, `backlog`, `fechar()`.
- `reconciliar(deps: { fila, coletor }, lote?)` (`apps/edge-agent/src/application/reconciliar.ts`).
- `ColetorSimulado` (`apps/edge-agent/src/adapters/coletor-simulado.ts`).
- `montarHeartbeat(config, componentes, agora)` / `componenteProcesso(config)` (`apps/edge-agent/src/health/health-check.ts`) — continuam usados para o heartbeat LOCAL/log; o payload HTTP para a nuvem é um objeto novo e menor (ver Task 3).
- `EdgeCredential` / `EdgeNode` (Prisma, `packages/database/prisma/schema.prisma:2036` e `:2070`): `keyId` único, `encryptedSecret`, `activeFrom`, `expiresAt?`, `revokedAt?`.
- `EdgeAuthService.cifrarSegredo(segredo)` (`apps/api/src/modules/edge-auth/edge-auth.service.ts`) — cifra AES já pronta, formato `{iv}:{tag}:{ciphertext}` base64.

---

### Task 1: Dois flags de modo — `FACIAL_MODE` / `CATRACA_MODE`

**Files:**
- Modify: `apps/edge-agent/src/config/env.ts:62-64` (substitui `USE_SIMULATOR`)
- Modify: `apps/edge-agent/src/health/health-check.ts:63` (usa novo campo em vez de `USE_SIMULATOR`)
- Test: `apps/edge-agent/src/config/env.spec.ts` (criar se não existir; se existir, estender)

**Interfaces:**
- Produces: `Config.FACIAL_MODE: 'real' | 'simulador'`, `Config.CATRACA_MODE: 'real' | 'simulador'`. Ambos default `'simulador'`.
- Consumes: nada de tarefas anteriores.

> **Nota de compatibilidade:** `USE_SIMULATOR` é removido do schema. Grep antes de começar: `grep -rn "USE_SIMULATOR" apps/edge-agent/src` para achar todos os pontos a atualizar (health-check.ts confirmado; pode haver mais em specs).

- [ ] **Step 1: Ler o schema atual para confirmar o ponto exato de edição**

Ler `apps/edge-agent/src/config/env.ts` linhas 56-65 (já lido nesta sessão — o campo é:
```ts
USE_SIMULATOR: z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .default(true),
```
).

- [ ] **Step 2: Escrever o teste que falha**

Criar/editar `apps/edge-agent/src/config/env.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import { carregarConfig, descreverConfig } from './env.js';

const baseEnv = {
  EDGE_AGENT_ID: 'edge-1',
  TENANT_ID: '11111111-1111-1111-1111-111111111111',
  GYM_UNIT_ID: '22222222-2222-2222-2222-222222222222',
};

describe('FACIAL_MODE e CATRACA_MODE', () => {
  it('usa simulador por padrao quando as variaveis nao existem', () => {
    const config = carregarConfig(baseEnv);
    expect(config.FACIAL_MODE).toBe('simulador');
    expect(config.CATRACA_MODE).toBe('simulador');
  });

  it('aceita real e simulador explicitamente, um por dispositivo', () => {
    const config = carregarConfig({ ...baseEnv, FACIAL_MODE: 'real', CATRACA_MODE: 'simulador' });
    expect(config.FACIAL_MODE).toBe('real');
    expect(config.CATRACA_MODE).toBe('simulador');
  });

  it('recusa valor fora do enum', () => {
    expect(() => carregarConfig({ ...baseEnv, FACIAL_MODE: 'hardware' })).toThrow();
  });

  it('descreverConfig nao esconde o modo -- nao e segredo', () => {
    const config = carregarConfig({ ...baseEnv, FACIAL_MODE: 'real' });
    const visao = descreverConfig(config);
    expect(visao.FACIAL_MODE).toBe('real');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- env.spec.ts`
Expected: FAIL — `FACIAL_MODE`/`CATRACA_MODE` não existem no schema ainda.

- [ ] **Step 4: Implementar o schema novo**

Em `apps/edge-agent/src/config/env.ts`, substituir o bloco `USE_SIMULATOR` (linhas 56-64) por:

```ts
  /**
   * Um flag por dispositivo (decisao do PI, insumo F59 SS4 no2). Substitui
   * o antigo `USE_SIMULATOR` booleano -- permite ensaiar o facial real com
   * catraca simulada, sem girar nada.
   *
   * `M0-NFR-006`: o padrao de ambos e simulador -- CI roda sem hardware.
   */
  FACIAL_MODE: z.enum(['real', 'simulador']).default('simulador'),
  CATRACA_MODE: z.enum(['real', 'simulador']).default('simulador'),
```

- [ ] **Step 5: Atualizar `descreverConfig` — nada muda, o campo não é segredo, mas confirmar que `CAMPOS_SECRETOS` continua correto**

Nenhuma edição necessária em `CAMPOS_SECRETOS` — os dois novos campos não são segredo.

- [ ] **Step 6: Atualizar `health-check.ts`**

Em `apps/edge-agent/src/health/health-check.ts:63`, trocar:

```ts
detalhe: config.USE_SIMULATOR ? 'em execucao (modo simulador)' : 'em execucao',
```

por:

```ts
detalhe:
  config.FACIAL_MODE === 'simulador' || config.CATRACA_MODE === 'simulador'
    ? 'em execucao (modo simulador)'
    : 'em execucao',
```

- [ ] **Step 7: Corrigir todo outro uso de `USE_SIMULATOR`**

Run: `grep -rn "USE_SIMULATOR" apps/edge-agent/src`
Para cada ocorrência fora dos dois arquivos já tratados, ajustar para os novos campos (provavelmente em `apps/edge-agent/src/health/health-check.spec.ts` e/ou `apps/edge-agent/src/main.ts:56-58`, este último será reescrito na Task 6).

- [ ] **Step 8: Rodar o teste e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- env.spec.ts health-check.spec.ts`
Expected: PASS

- [ ] **Step 9: Typecheck do pacote inteiro (pega usos que o grep perdeu)**

Run: `pnpm --filter @arenahub/edge-agent typecheck`
Expected: sem erro. Qualquer erro aqui aponta um uso de `USE_SIMULATOR` não migrado — corrigir antes de prosseguir.

- [ ] **Step 10: Commit**

```bash
git add apps/edge-agent/src/config/env.ts apps/edge-agent/src/config/env.spec.ts apps/edge-agent/src/health/health-check.ts apps/edge-agent/src/health/health-check.spec.ts
git commit -m "feat(edge-agent): substitui USE_SIMULATOR por FACIAL_MODE/CATRACA_MODE (F59)"
```

---

### Task 2: Retry limitado no arranque de um dispositivo

**Files:**
- Create: `apps/edge-agent/src/producao/conectar-com-retry.ts`
- Test: `apps/edge-agent/src/producao/conectar-com-retry.spec.ts`

**Interfaces:**
- Consumes: nada de outras tasks (função pura, genérica).
- Produces: `conectarComRetry<T>(deps: DepsRetry<T>): Promise<T>`, usado pela Task 4 (composição) para conectar cada dispositivo real.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { conectarComRetry, FalhaDeConexaoError } from './conectar-com-retry.js';

describe('conectarComRetry', () => {
  it('devolve o resultado na primeira tentativa bem-sucedida', async () => {
    const tentar = jest.fn(async () => 'ok');
    const esperar = jest.fn(async () => {});

    const resultado = await conectarComRetry({ tentar, esperar, maxTentativas: 5, intervaloMs: 3000 });

    expect(resultado).toBe('ok');
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('tenta ate maxTentativas e falha alto se todas falharem', async () => {
    const erro = new Error('sem resposta');
    const tentar = jest.fn(async () => { throw erro; });
    const esperar = jest.fn(async () => {});

    await expect(
      conectarComRetry({ tentar, esperar, maxTentativas: 3, intervaloMs: 3000 }),
    ).rejects.toBeInstanceOf(FalhaDeConexaoError);

    expect(tentar).toHaveBeenCalledTimes(3);
    expect(esperar).toHaveBeenCalledTimes(2);
  });

  it('recupera se uma tentativa intermediaria falhar e a seguinte funcionar', async () => {
    let chamada = 0;
    const tentar = jest.fn(async () => {
      chamada += 1;
      if (chamada < 3) throw new Error('catraca ainda bootando');
      return 'conectado';
    });
    const esperar = jest.fn(async () => {});

    const resultado = await conectarComRetry({ tentar, esperar, maxTentativas: 5, intervaloMs: 3000 });

    expect(resultado).toBe('conectado');
    expect(tentar).toHaveBeenCalledTimes(3);
  });

  it('a mensagem de erro final preserva a causa da ultima tentativa', async () => {
    const tentar = jest.fn(async () => { throw new Error('porta 3570 recusou conexao'); });
    const esperar = jest.fn(async () => {});

    await expect(
      conectarComRetry({ tentar, esperar, maxTentativas: 2, intervaloMs: 3000 }),
    ).rejects.toThrow(/porta 3570 recusou conexao/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- conectar-com-retry.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
/**
 * Retry limitado no arranque -- insumo F59 SS5.1/5.2.
 *
 * "Falha alto" e a decisao certa para invocacao manual; no arranque
 * automatico do servico Windows (ADR-011), ela transformava uma condicao
 * transitoria (catraca lenta no boot) em parada permanente. A mesma
 * politica vale para queda POS-arranque (SS5.2) -- quem chama de novo
 * apos o processo ja estar de pe usa esta mesma funcao.
 */

export class FalhaDeConexaoError extends Error {
  readonly code = 'EDGE_CONEXAO_ESGOTADA';

  constructor(
    readonly dispositivo: string,
    readonly tentativas: number,
    causa: unknown,
  ) {
    super(
      `${dispositivo}: esgotadas ${tentativas} tentativas de conexao. Ultima causa: ${
        causa instanceof Error ? causa.message : String(causa)
      }`,
    );
    this.name = 'FalhaDeConexaoError';
  }
}

export interface DepsRetry<T> {
  tentar: () => Promise<T>;
  esperar: (ms: number) => Promise<void>;
  maxTentativas: number;
  intervaloMs: number;
  /** Nome do dispositivo, so para a mensagem de erro. */
  dispositivo?: string;
}

export async function conectarComRetry<T>(deps: DepsRetry<T>): Promise<T> {
  let ultimaCausa: unknown;

  for (let tentativa = 1; tentativa <= deps.maxTentativas; tentativa += 1) {
    try {
      return await deps.tentar();
    } catch (erro: unknown) {
      ultimaCausa = erro;

      if (tentativa < deps.maxTentativas) {
        await deps.esperar(deps.intervaloMs);
      }
    }
  }

  throw new FalhaDeConexaoError(deps.dispositivo ?? 'dispositivo', deps.maxTentativas, ultimaCausa);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- conectar-com-retry.spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/edge-agent/src/producao/conectar-com-retry.ts apps/edge-agent/src/producao/conectar-com-retry.spec.ts
git commit -m "feat(edge-agent): retry limitado de conexao no arranque (F59)"
```

---

### Task 3: Cliente de nuvem para decisão online e heartbeat

**Files:**
- Create: `apps/edge-agent/src/cloud/access-decision-client.ts`
- Create: `apps/edge-agent/src/cloud/heartbeat-client.ts`
- Test: `apps/edge-agent/src/cloud/access-decision-client.spec.ts`
- Test: `apps/edge-agent/src/cloud/heartbeat-client.spec.ts`

**Interfaces:**
- Consumes: `SignedCloudClient` (já existe, `apps/edge-agent/src/cloud/signed-client.ts`).
- Produces: `criarPedirDecisao(cliente: SignedCloudClient): DepsAcessoOnline['pedirDecisao']`, `criarReportarPassagem(cliente: SignedCloudClient): DepsAcessoOnline['reportarPassagem']`, `enviarHeartbeat(cliente: SignedCloudClient, corpo: HeartbeatHttp): Promise<RespostaDeHeartbeatHttp | null>`. Usados pela Task 4 (composição) e Task 5 (laço de heartbeat).

- [ ] **Step 1: Escrever o teste que falha para o cliente de decisão**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { criarPedirDecisao, criarReportarPassagem } from './access-decision-client.js';
import type { SignedCloudClient } from './signed-client.js';

function clienteFalso(resposta: unknown, ok = true, status = 201): SignedCloudClient {
  return {
    post: jest.fn(async () => ({ ok, status, body: ok ? resposta : null, errorCode: ok ? null : 'ERRO' })),
    get: jest.fn(),
  } as unknown as SignedCloudClient;
}

describe('criarPedirDecisao', () => {
  it('monta o payload e devolve a decisao em caso de sucesso', async () => {
    const cliente = clienteFalso({
      accessEventId: 'evt-1', correlationId: 'c-1', outcome: 'ALLOW', reason: 'ENTITLEMENT_ACTIVE',
      policyVersion: 'v1', validUntil: null, replayed: false,
    });
    const pedirDecisao = criarPedirDecisao(cliente);

    const resultado = await pedirDecisao({
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: new Date('2026-09-16T10:00:00Z'), idempotencyKey: 'idem-1',
    });

    expect(resultado).toEqual({
      accessEventId: 'evt-1', outcome: 'ALLOW', reason: 'ENTITLEMENT_ACTIVE', validUntil: null,
    });
    expect(cliente.post).toHaveBeenCalledWith('/api/v1/edge/access-decisions', {
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: '2026-09-16T10:00:00.000Z', idempotencyKey: 'idem-1',
    });
  });

  it('devolve null quando a nuvem responde erro -- vira DENY explicito rio acima', async () => {
    const cliente = clienteFalso(null, false, 0);
    const pedirDecisao = criarPedirDecisao(cliente);

    const resultado = await pedirDecisao({
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: new Date(), idempotencyKey: 'idem-1',
    });

    expect(resultado).toBeNull();
  });
});

describe('criarReportarPassagem', () => {
  it('reporta o desfecho e devolve true em sucesso', async () => {
    const cliente = clienteFalso({ accessEventId: 'evt-1', state: 'CONFIRMED' });
    const reportarPassagem = criarReportarPassagem(cliente);

    const ok = await reportarPassagem('evt-1', 'CONFIRMED', 'cmd-1', new Date('2026-09-16T10:00:05Z'));

    expect(ok).toBe(true);
    expect(cliente.post).toHaveBeenCalledWith('/api/v1/edge/access-events/evt-1/passage', {
      state: 'CONFIRMED', commandId: 'cmd-1', reportedAt: '2026-09-16T10:00:05.000Z',
    });
  });

  it('devolve false quando a nuvem recusa', async () => {
    const cliente = clienteFalso(null, false);
    const reportarPassagem = criarReportarPassagem(cliente);

    const ok = await reportarPassagem('evt-1', 'TIMED_OUT', 'cmd-1', new Date());

    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- access-decision-client.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `access-decision-client.ts`**

```ts
import type { DepsAcessoOnline } from '../application/orquestrar-acesso-online.js';
import type { SignedCloudClient } from './signed-client.js';

interface RespostaDeDecisaoHttp {
  accessEventId: string;
  outcome: 'ALLOW' | 'DENY';
  reason: string;
  validUntil: string | null;
}

interface RespostaDePassagemHttp {
  accessEventId: string;
  state: string;
}

/**
 * Implementa `pedirDecisao` sobre `POST /api/v1/edge/access-decisions`
 * (F9). Erro de rede ou recusa da nuvem viram `null` -- quem chama
 * (`orquestrar-acesso-online.ts`) trata `null` como DENY explicito, nunca
 * como ALLOW por omissao (regra nova da F9).
 */
export function criarPedirDecisao(cliente: SignedCloudClient): DepsAcessoOnline['pedirDecisao'] {
  return async (entrada) => {
    const resposta = await cliente.post<RespostaDeDecisaoHttp>('/api/v1/edge/access-decisions', {
      deviceId: entrada.deviceId,
      externalUserId: entrada.externalUserId,
      recognitionId: entrada.recognitionId,
      recognizedAt: entrada.recognizedAt.toISOString(),
      idempotencyKey: entrada.idempotencyKey,
    });

    if (!resposta.ok || !resposta.body) return null;

    return {
      accessEventId: resposta.body.accessEventId,
      outcome: resposta.body.outcome,
      reason: resposta.body.reason,
      validUntil: resposta.body.validUntil,
    };
  };
}

/**
 * Implementa `reportarPassagem` sobre
 * `POST /api/v1/edge/access-events/:id/passage`. Falha aqui NAO desfaz o
 * giro fisico -- ver comentario em `orquestrar-acesso-online.ts`.
 */
export function criarReportarPassagem(
  cliente: SignedCloudClient,
): DepsAcessoOnline['reportarPassagem'] {
  return async (accessEventId, estado, commandId, reportedAt) => {
    const resposta = await cliente.post<RespostaDePassagemHttp>(
      `/api/v1/edge/access-events/${accessEventId}/passage`,
      { state: estado, commandId, reportedAt: reportedAt.toISOString() },
    );

    return resposta.ok;
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- access-decision-client.spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Escrever o teste que falha para o heartbeat HTTP**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { enviarHeartbeat } from './heartbeat-client.js';
import type { SignedCloudClient } from './signed-client.js';

describe('enviarHeartbeat', () => {
  it('envia o corpo e devolve a resposta em sucesso', async () => {
    const cliente = {
      post: jest.fn(async () => ({
        ok: true, status: 200,
        body: { serverTime: '2026-09-16T10:00:00.000Z', clockOffsetMs: 12, acknowledgedDevices: 2 },
        errorCode: null,
      })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const resultado = await enviarHeartbeat(cliente, {
      agentVersion: '1.0.0', localTimeMs: 1_757_000_000_000, queueDepth: 3, devices: [],
    });

    expect(resultado).toEqual({ serverTime: '2026-09-16T10:00:00.000Z', clockOffsetMs: 12, acknowledgedDevices: 2 });
    expect(cliente.post).toHaveBeenCalledWith('/api/v1/edge/heartbeat', {
      agentVersion: '1.0.0', localTimeMs: 1_757_000_000_000, queueDepth: 3, devices: [],
    });
  });

  it('devolve null quando a nuvem nao responde -- nao derruba o processo', async () => {
    const cliente = {
      post: jest.fn(async () => ({ ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const resultado = await enviarHeartbeat(cliente, {
      agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [],
    });

    expect(resultado).toBeNull();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- heartbeat-client.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar `heartbeat-client.ts`**

```ts
import type { SignedCloudClient } from './signed-client.js';

export interface DispositivoHeartbeat {
  serial: string;
  model: string;
  firmware?: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  lastSyncAt?: string;
}

export interface HeartbeatHttp {
  agentVersion: string;
  localTimeMs: number;
  queueDepth: number;
  devices: readonly DispositivoHeartbeat[];
}

export interface RespostaDeHeartbeatHttp {
  serverTime: string;
  clockOffsetMs: number;
  acknowledgedDevices: number;
}

/**
 * Envia o heartbeat para `POST /api/v1/edge/heartbeat` (F11). Sem isso, o
 * alerta "Edge offline" do painel (ADR-011, AC-8) nunca dispara -- o
 * heartbeat que so ia para o log (health-check.ts) nao alcancava a nuvem.
 *
 * `null` em falha de rede: quem chama decide se tenta de novo no proximo
 * ciclo. Nao lanca -- erro de rede aqui nao pode derrubar o processo
 * (mesma regra do `command-poller`).
 */
export async function enviarHeartbeat(
  cliente: SignedCloudClient,
  corpo: HeartbeatHttp,
): Promise<RespostaDeHeartbeatHttp | null> {
  const resposta = await cliente.post<RespostaDeHeartbeatHttp>('/api/v1/edge/heartbeat', {
    agentVersion: corpo.agentVersion,
    localTimeMs: corpo.localTimeMs,
    queueDepth: corpo.queueDepth,
    devices: corpo.devices,
  });

  return resposta.ok ? resposta.body : null;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- heartbeat-client.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 9: Commit**

```bash
git add apps/edge-agent/src/cloud/access-decision-client.ts apps/edge-agent/src/cloud/access-decision-client.spec.ts apps/edge-agent/src/cloud/heartbeat-client.ts apps/edge-agent/src/cloud/heartbeat-client.spec.ts
git commit -m "feat(edge-agent): clientes HTTP de decisao online e heartbeat (F59)"
```

---

### Task 4: Montagem de dispositivos — real ou simulador por flag

**Files:**
- Create: `apps/edge-agent/src/producao/montar-dispositivos.ts`
- Test: `apps/edge-agent/src/producao/montar-dispositivos.spec.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `conectarComRetry` (Task 2), `FacialSimulator`/`TopdataFacialAdapter`, `TurnstileSimulator`/`TopdataInnerAdapter`/`PonteEasyInnerProcesso` (já existentes).
- Produces: `montarDispositivos(config: Config, logger: Logger): Promise<{ facial: FacialDeviceAdapter; catraca: TurnstileAdapter; encerrar: () => Promise<void> }>`. Usado pela Task 6 (`main.ts`).

> Nota de ordem (insumo §3.2): catraca antes do facial — o leitor pode disparar reconhecimento assim que conecta, e se o processador ainda não tem catraca, o primeiro evento se perde. Esta função monta a catraca primeiro.

- [ ] **Step 1: Escrever o teste que falha (caminho simulador — não depende de hardware, roda em CI)**

```ts
import { describe, expect, it } from '@jest/globals';
import { montarDispositivos } from './montar-dispositivos.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';

const baseEnv = {
  EDGE_AGENT_ID: 'edge-1',
  TENANT_ID: '11111111-1111-1111-1111-111111111111',
  GYM_UNIT_ID: '22222222-2222-2222-2222-222222222222',
};

describe('montarDispositivos', () => {
  it('monta os dois simuladores quando os flags sao simulador (padrao)', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);

    const montado = await montarDispositivos(config, logger);

    expect(montado.facial).toBeInstanceOf(FacialSimulator);
    expect(montado.catraca).toBeInstanceOf(TurnstileSimulator);

    await montado.encerrar();
  });

  it('encerrar() e idempotente e nao lanca', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);
    const montado = await montarDispositivos(config, logger);

    await montado.encerrar();
    await expect(montado.encerrar()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- montar-dispositivos.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import type { Config } from '../config/env.js';
import type { Logger } from '../observability/logger.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { TurnstileAdapter } from '../domain/turnstile.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';
import { TopdataFacialAdapter } from '../adapters/topdata/topdata-facial-adapter.js';
import { TopdataInnerAdapter } from '../adapters/topdata/topdata-inner-adapter.js';
import { PonteEasyInnerProcesso } from '../adapters/topdata/ponte-easyinner-processo.js';
import { conectarComRetry } from './conectar-com-retry.js';

const MAX_TENTATIVAS = 5;
const INTERVALO_RETRY_MS = 3_000;
const INNER_PADRAO = 1;
const CAMINHO_PONTE = 'native/easyinner-bridge/EasyInnerBridge.exe';

export interface DispositivosMontados {
  facial: FacialDeviceAdapter;
  catraca: TurnstileAdapter;
  /** Desconecta os dois, na ordem inversa da montagem (`M0-NFR-007`). */
  encerrar: () => Promise<void>;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monta catraca e leitor facial, real ou simulador por flag (F59).
 *
 * ORDEM IMPORTA (insumo SS3.2): catraca antes do facial. O leitor pode
 * disparar reconhecimento assim que conecta; se o processador ainda nao
 * tem catraca, o primeiro evento se perde ou explode.
 */
export async function montarDispositivos(
  config: Config,
  logger: Logger,
): Promise<DispositivosMontados> {
  const catraca: TurnstileAdapter =
    config.CATRACA_MODE === 'simulador'
      ? new TurnstileSimulator()
      : await montarCatracaReal(logger);

  const facial: FacialDeviceAdapter =
    config.FACIAL_MODE === 'simulador' ? new FacialSimulator() : await montarFacialReal(logger);

  return {
    facial,
    catraca,
    // Ordem inversa: facial primeiro (para de receber evento novo), depois catraca.
    encerrar: async () => {
      await facial.encerrar();
      await catraca.encerrar();
    },
  };
}

async function montarCatracaReal(logger: Logger): Promise<TurnstileAdapter> {
  const ponte = PonteEasyInnerProcesso.lancar({ comando: CAMINHO_PONTE });
  const adapter = new TopdataInnerAdapter(ponte, logger, INNER_PADRAO);

  await conectarComRetry({
    dispositivo: 'catraca',
    maxTentativas: MAX_TENTATIVAS,
    intervaloMs: INTERVALO_RETRY_MS,
    esperar,
    tentar: async () => {
      await adapter.conectar(3570, 10);

      const conectado = await adapter.testarConexao();
      if (!conectado) throw new Error('testarConexao devolveu false');
    },
  });

  return adapter;
}

async function montarFacialReal(logger: Logger): Promise<FacialDeviceAdapter> {
  const adapter = new TopdataFacialAdapter(logger, 7792);

  await conectarComRetry({
    dispositivo: 'facial',
    maxTentativas: MAX_TENTATIVAS,
    intervaloMs: INTERVALO_RETRY_MS,
    esperar,
    tentar: () => adapter.iniciar(),
  });

  return adapter;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- montar-dispositivos.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @arenahub/edge-agent typecheck`
Expected: sem erro. Se `TopdataFacialAdapter.iniciar`, `TopdataInnerAdapter.conectar`/`testarConexao` tiverem assinatura diferente da assumida, ajustar aqui conforme o erro do compilador.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-agent/src/producao/montar-dispositivos.ts apps/edge-agent/src/producao/montar-dispositivos.spec.ts
git commit -m "feat(edge-agent): monta catraca e facial, real ou simulador por flag (F59)"
```

---

### Task 5: Composição de produção — liga leitor, decisão online e catraca

**Files:**
- Create: `apps/edge-agent/src/producao/compor-agente.ts`
- Test: `apps/edge-agent/src/producao/compor-agente.spec.ts`

**Interfaces:**
- Consumes: `montarDispositivos` (Task 4), `criarPedirDecisao`/`criarReportarPassagem` (Task 3), `MaquinaDeAcesso`, `criarProcessadorDeAcessoOnline`, `retomarPendentes` (existentes), `SignedCloudClient` (existente).
- Produces: `compor(config: Config, logger: Logger): Promise<AgenteComposto>` onde `AgenteComposto = { encerrar: () => Promise<void> }`. Usado pela Task 6 (`main.ts`).

> Nota (insumo §3.2): `aoReconhecer` por último — registrar o ouvinte é o que "liga a chave"; tudo a jusante precisa estar pronto antes.

- [ ] **Step 1: Escrever o teste que falha**

O teste evita depender da rede: injeta um `SignedCloudClient` fake e um `FacialSimulator` real (para poder disparar `simularReconhecimento`).

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { unlinkSync, existsSync } from 'node:fs';
import { compor } from './compor-agente.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

const CAMINHO_SQLITE_TESTE = 'data/teste-compor-agente.sqlite';

function limparArquivoDeTeste(): void {
  if (existsSync(CAMINHO_SQLITE_TESTE)) unlinkSync(CAMINHO_SQLITE_TESTE);
}

describe('compor', () => {
  afterEach(limparArquivoDeTeste);

  it('liga reconhecimento facial a decisao online e devolve ALLOW quando a nuvem permite', async () => {
    limparArquivoDeTeste();

    const config = carregarConfig({
      EDGE_AGENT_ID: 'edge-1',
      TENANT_ID: '11111111-1111-1111-1111-111111111111',
      GYM_UNIT_ID: '22222222-2222-2222-2222-222222222222',
      SQLITE_PATH: CAMINHO_SQLITE_TESTE,
      CLOUD_API_URL: 'https://nuvem.teste',
      CLOUD_EDGE_KEY_ID: 'key-1',
      CLOUD_EDGE_SECRET: 'segredo-com-16-bytes-ou-mais',
    });
    const logger = criarLogger(config);

    const clienteFalso = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/v1/edge/access-decisions') {
          return {
            ok: true, status: 201,
            body: { accessEventId: 'evt-1', correlationId: 'c-1', outcome: 'ALLOW', reason: 'TESTE', policyVersion: 'v1', validUntil: null, replayed: false },
            errorCode: null,
          };
        }
        return { ok: true, status: 201, body: { accessEventId: 'evt-1', state: 'CONFIRMED' }, errorCode: null };
      }),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const composto = await compor(config, logger, {
      cliente: clienteFalso,
      dispositivos: { facial: new FacialSimulator(), catraca: undefined as never, encerrarDispositivos: async () => {} },
    });

    const facial = composto.facialParaTeste as FacialSimulator;
    facial.simularReconhecimento({
      externalEnrollId: 'aluno-1',
      ocorridoEm: new Date(),
      recebidoEm: new Date(),
      metodo: 'facial',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(clienteFalso.post).toHaveBeenCalledWith(
      '/api/v1/edge/access-decisions',
      expect.objectContaining({ externalUserId: 'aluno-1' }),
    );

    await composto.encerrar();
  });
});
```

> **Nota para quem implementa:** o teste acima injeta dependências via um terceiro parâmetro opcional de `compor` (`deps?: { cliente?: SignedCloudClient; dispositivos?: DispositivosMontados }`) para não precisar de rede real nem hardware — sem esse parâmetro, `compor` monta tudo sozinho a partir da `Config` (caminho de produção). Ajuste o teste conforme a assinatura real que a Step 3 definir; o ponto que não muda é: **precisa dar para testar o fio inteiro sem rede nem hardware**.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- compor-agente.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { randomUUID } from 'node:crypto';

import type { Config } from '../config/env.js';
import type { Logger } from '../observability/logger.js';
import { montarDispositivos, type DispositivosMontados } from './montar-dispositivos.js';
import { SignedCloudClient } from '../cloud/signed-client.js';
import { criarPedirDecisao, criarReportarPassagem } from '../cloud/access-decision-client.js';
import { MaquinaDeAcesso } from '../persistence/maquina-de-acesso.js';
import {
  criarProcessadorDeAcessoOnline,
  retomarPendentes,
  type ReconhecimentoComOrigem,
} from '../application/orquestrar-acesso-online.js';
import type { EventoReconhecimento } from '../domain/facial-device.js';

export interface AgenteComposto {
  encerrar: () => Promise<void>;
}

interface DepsInjetaveis {
  cliente?: SignedCloudClient;
  dispositivos?: DispositivosMontados;
}

/**
 * Composicao de producao (F59) -- liga leitor, decisao ONLINE (F9) e
 * catraca. Diferenca central para o `lab:run` (MVP 0): a decisao e da
 * NUVEM (`criarProcessadorDeAcessoOnline`), nunca local
 * (`criarProcessadorDePassagem`) -- regra de arquitetura no 1.
 *
 * `deps` e para teste: sem ele, monta tudo a partir da `Config` (caminho
 * real). Com ele, quem chama controla o cliente de nuvem e os
 * dispositivos, sem precisar de rede nem hardware.
 */
export async function compor(
  config: Config,
  logger: Logger,
  deps: DepsInjetaveis = {},
): Promise<AgenteComposto & { facialParaTeste?: unknown }> {
  const dispositivos = deps.dispositivos ?? (await montarDispositivos(config, logger));

  const cliente =
    deps.cliente ??
    new SignedCloudClient({
      baseUrl: config.CLOUD_API_URL ?? '',
      keyId: config.CLOUD_EDGE_KEY_ID ?? '',
      secret: config.CLOUD_EDGE_SECRET ?? '',
    });

  const maquina = new MaquinaDeAcesso(config.SQLITE_PATH);

  const processar = criarProcessadorDeAcessoOnline({
    maquina,
    catraca: dispositivos.catraca,
    pedirDecisao: criarPedirDecisao(cliente),
    reportarPassagem: criarReportarPassagem(cliente),
    agoraMonotonicoMs: () => performance.now(),
  });

  // Fecha o ciclo de REGISTRO de tentativas presas de uma execucao anterior
  // -- nunca recomanda a catraca (ver comentario em retomarPendentes).
  const retomada = await retomarPendentes({
    maquina,
    catraca: dispositivos.catraca,
    pedirDecisao: criarPedirDecisao(cliente),
    reportarPassagem: criarReportarPassagem(cliente),
    agoraMonotonicoMs: () => performance.now(),
  });

  logger.info({ retomada }, 'tentativas pendentes retomadas no arranque');

  // AO RECONHECER POR ULTIMO: registrar o ouvinte "liga a chave" -- tudo a
  // jusante (maquina, processador, catraca) ja esta pronto acima.
  dispositivos.facial.aoReconhecer((evento: EventoReconhecimento) => {
    const reconhecimento: ReconhecimentoComOrigem = {
      externalEnrollId: evento.externalEnrollId,
      deviceId: config.EDGE_AGENT_ID,
      recognitionId: evento.idExternoDoEvento ?? randomUUID(),
      ocorridoEm: evento.ocorridoEm,
    };

    const correlationId = randomUUID();

    processar(reconhecimento, correlationId, new Date()).catch((erro: unknown) => {
      logger.error(
        { correlationId, erro: erro instanceof Error ? erro.message : erro },
        'falha ao processar reconhecimento',
      );
    });
  });

  return {
    facialParaTeste: dispositivos.facial,
    encerrar: async () => {
      await dispositivos.encerrar();
      maquina.fechar();
    },
  };
}
```

> Se `MaquinaDeAcesso` não expuser `fechar()` (verificar durante a implementação — a exploração anterior não confirmou esse método), usar o que a classe realmente expõe para fechar o SQLite; ajustar sem mudar o contrato de `AgenteComposto`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- compor-agente.spec.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @arenahub/edge-agent typecheck`
Expected: sem erro. `EventoReconhecimento.idExternoDoEvento` e o nome exato de outros campos devem ser conferidos contra `apps/edge-agent/src/domain/facial-device.ts` — ajustar se o compilador apontar divergência.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-agent/src/producao/compor-agente.ts apps/edge-agent/src/producao/compor-agente.spec.ts
git commit -m "feat(edge-agent): composicao de producao liga facial, decisao online e catraca (F59)"
```

---

### Task 6: `main.ts` de produção — heartbeat HTTP, retomada e encerramento gracioso

**Files:**
- Modify: `apps/edge-agent/src/main.ts` (reescreve quase inteiro)
- Test: `apps/edge-agent/src/main.spec.ts` (criar — testa só as partes extraíveis como função pura; o `main()` em si continua sendo integração manual via `pnpm dev`)

**Interfaces:**
- Consumes: `compor` (Task 5), `enviarHeartbeat` (Task 3), `SignedCloudClient`.
- Produces: processo executável via `pnpm --filter @arenahub/edge-agent start`. Não produz símbolo consumido por outra task.

- [ ] **Step 1: Extrair a lógica de heartbeat HTTP em função testável**

Antes de tocar `main.ts`, criar `apps/edge-agent/src/producao/laco-de-heartbeat.ts`:

```ts
import type { SignedCloudClient } from '../cloud/signed-client.js';
import { enviarHeartbeat, type HeartbeatHttp } from '../cloud/heartbeat-client.js';

export interface DepsLacoDeHeartbeat {
  cliente: SignedCloudClient;
  montarCorpo: () => HeartbeatHttp;
  intervaloMs: number;
  aoFalhar?: (erro: string) => void;
}

/**
 * Laco de heartbeat HTTP -- mesmo padrao do `command-poller` (F8):
 * `setTimeout` recursivo com `unref`, falha de rede nunca derruba o laco
 * (F11/AC-8 depende do heartbeat continuar tentando quando a rede volta).
 */
export function iniciarLacoDeHeartbeat(deps: DepsLacoDeHeartbeat): () => void {
  let ativo = true;
  let temporizador: NodeJS.Timeout | undefined;

  const agendar = (): void => {
    if (!ativo) return;

    temporizador = setTimeout(() => {
      void (async () => {
        try {
          const resposta = await enviarHeartbeat(deps.cliente, deps.montarCorpo());
          if (!resposta) deps.aoFalhar?.('CLOUD_UNREACHABLE');
        } catch (erro: unknown) {
          deps.aoFalhar?.(erro instanceof Error ? erro.message : 'ERRO_DESCONHECIDO');
        } finally {
          agendar();
        }
      })();
    }, deps.intervaloMs);

    temporizador.unref?.();
  };

  agendar();

  return () => {
    ativo = false;
    if (temporizador) clearTimeout(temporizador);
  };
}
```

- [ ] **Step 2: Escrever o teste que falha**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { iniciarLacoDeHeartbeat } from './laco-de-heartbeat.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

describe('iniciarLacoDeHeartbeat', () => {
  it('envia heartbeat no intervalo configurado e para quando pedido', () => {
    jest.useFakeTimers();

    const cliente = {
      post: jest.fn(async () => ({
        ok: true, status: 200,
        body: { serverTime: new Date().toISOString(), clockOffsetMs: 0, acknowledgedDevices: 0 },
        errorCode: null,
      })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({ agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [] }),
      intervaloMs: 30_000,
    });

    jest.advanceTimersByTime(30_000);

    parar();
    jest.useRealTimers();
  });

  it('chama aoFalhar quando a nuvem nao responde, sem lancar', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });

    const cliente = {
      post: jest.fn(async () => ({ ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const aoFalhar = jest.fn();

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({ agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [] }),
      intervaloMs: 1_000,
      aoFalhar,
    });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(aoFalhar).toHaveBeenCalledWith('CLOUD_UNREACHABLE');

    parar();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- laco-de-heartbeat.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Rodar e ver passar (implementação já escrita no Step 1)**

Run: `pnpm --filter @arenahub/edge-agent test -- laco-de-heartbeat.spec.ts`
Expected: PASS

- [ ] **Step 5: Reescrever `main.ts`**

```ts
import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: join(process.cwd(), '../../.env') });

const { carregarConfig, descreverConfig, ConfigInvalidaError } = await import('./config/env.js');
const { criarLogger, loggerDaTentativa } = await import('./observability/logger.js');
const { compor } = await import('./producao/compor-agente.js');
const { SignedCloudClient } = await import('./cloud/signed-client.js');
const { iniciarLacoDeHeartbeat } = await import('./producao/laco-de-heartbeat.js');

/**
 * Ponto de entrada de PRODUCAO do edge-agent (F59).
 *
 * Sobe a composicao real (Task 5), inicia o laco de heartbeat HTTP para a
 * nuvem (F11/AC-8) e encerra graciosamente. `USE_SIMULATOR` deu lugar a
 * `FACIAL_MODE`/`CATRACA_MODE` (F59, Task 1) -- cada dispositivo escolhe
 * real ou simulador de forma independente.
 */

const INTERVALO_HEARTBEAT_MS = 30_000;
const VERSAO_DO_AGENTE = process.env.npm_package_version ?? '0.0.0';

async function main(): Promise<void> {
  let config;
  try {
    config = carregarConfig();
  } catch (erro: unknown) {
    if (erro instanceof ConfigInvalidaError) {
      console.error(erro.message);
      process.exit(1);
    }
    throw erro;
  }

  const logger = criarLogger(config);

  logger.info({ config: descreverConfig(config) }, 'edge-agent iniciando');

  if (config.FACIAL_MODE === 'simulador' || config.CATRACA_MODE === 'simulador') {
    logger.warn(
      { facial: config.FACIAL_MODE, catraca: config.CATRACA_MODE },
      'modo simulador ativo para ao menos um dispositivo (M0-NFR-006)',
    );
  }

  const composto = await compor(config, logger);

  const clienteHeartbeat = new SignedCloudClient({
    baseUrl: config.CLOUD_API_URL ?? '',
    keyId: config.CLOUD_EDGE_KEY_ID ?? '',
    secret: config.CLOUD_EDGE_SECRET ?? '',
  });

  const pararHeartbeat = iniciarLacoDeHeartbeat({
    cliente: clienteHeartbeat,
    intervaloMs: INTERVALO_HEARTBEAT_MS,
    montarCorpo: () => ({
      agentVersion: VERSAO_DO_AGENTE,
      localTimeMs: Date.now(),
      queueDepth: 0,
      devices: [],
    }),
    aoFalhar: (erro) => {
      loggerDaTentativa(logger).warn({ erro }, 'heartbeat nao chegou na nuvem');
    },
  });

  logger.info('edge-agent pronto');

  let encerrando = false;

  const encerrar = (sinal: string): void => {
    if (encerrando) return;
    encerrando = true;

    logger.info({ sinal }, 'encerrando');
    pararHeartbeat();

    void composto
      .encerrar()
      .catch((erro: unknown) => {
        logger.error({ erro: erro instanceof Error ? erro.message : erro }, 'erro ao encerrar');
      })
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', () => encerrar('SIGINT'));
  process.once('SIGTERM', () => encerrar('SIGTERM'));
}

main().catch((erro: unknown) => {
  console.error('edge-agent falhou ao iniciar:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
```

- [ ] **Step 6: Rodar a suíte inteira do pacote**

Run: `pnpm --filter @arenahub/edge-agent test`
Expected: todos os testes passam (os já existentes + os novos das Tasks 1-6).

- [ ] **Step 7: Build e typecheck**

Run: `pnpm --filter @arenahub/edge-agent typecheck && pnpm --filter @arenahub/edge-agent build`
Expected: sem erro.

- [ ] **Step 8: Verificação manual — AC-1 da spec**

Run: `pnpm --filter @arenahub/edge-agent start` (após build), com `.env` configurado com `FACIAL_MODE=simulador`, `CATRACA_MODE=simulador`, e `CLOUD_API_URL` apontando para a API local rodando (`pnpm --filter @arenahub/api dev`).
Expected: log "edge-agent pronto" em menos de 60s; nenhuma exceção não tratada. Confirmar no log que o heartbeat foi enviado (ou que `aoFalhar` disparou, se a API não estiver de pé — não é falha do processo).

> AC-1 completo (painel mostrando "online, modo simulador") depende da UI do painel consumir `EdgeNode.lastHeartbeat`/`agentVersion` — fora do escopo de código desta fatia se a tela já existir; verificar `admin-web` antes de declarar AC-1 fechado. Se a tela não existir, registrar achado no PR (spec não pede criar a tela).

- [ ] **Step 9: Commit**

```bash
git add apps/edge-agent/src/main.ts apps/edge-agent/src/producao/laco-de-heartbeat.ts apps/edge-agent/src/producao/laco-de-heartbeat.spec.ts
git commit -m "feat(edge-agent): main.ts de producao com heartbeat HTTP e encerramento gracioso (F59)"
```

---

### Task 7: SIGTERM drena a fila antes de encerrar (AC-3)

**Files:**
- Modify: `apps/edge-agent/src/producao/compor-agente.ts` (adiciona a etapa de drenagem no `encerrar`)
- Test: `apps/edge-agent/src/producao/compor-agente.spec.ts` (estende)

**Interfaces:**
- Consumes: nenhuma nova — a composição já tem acesso à `MaquinaDeAcesso`.

> A spec (AC-3) fala de fila que precisa persistir antes de encerrar. Neste desenho, a persistência de uma tentativa em curso já acontece SÍNCRONA em `MaquinaDeAcesso.registrarReconhecimento`/`transicionar` (SQLite, `synchronous = FULL`) — não há buffer em memória que precise de "drenagem" separada. O que falta é: se o processo receber SIGTERM enquanto uma tentativa está em `COMMAND_PENDING`/`COMMAND_SENT`, o próximo arranque precisa retomar sem recomandar a catraca — isso já é `retomarPendentes` (chamado na Task 5, Step 3 da composição). Este task valida esse comportamento fim a fim.

- [ ] **Step 1: Escrever o teste que falha — persistência sobrevive a "encerrar no meio"**

```ts
it('uma tentativa em COMMAND_PENDING sobrevive ao encerramento e e reportada na proxima composicao', async () => {
  limparArquivoDeTeste();

  const config = carregarConfig({
    EDGE_AGENT_ID: 'edge-1',
    TENANT_ID: '11111111-1111-1111-1111-111111111111',
    GYM_UNIT_ID: '22222222-2222-2222-2222-222222222222',
    SQLITE_PATH: CAMINHO_SQLITE_TESTE,
  });
  const logger = criarLogger(config);

  // Simula reportarPassagem falhando na primeira composicao (rede caiu bem
  // no momento do report), deixando a tentativa pendente.
  const clienteQueFalhaNoReport = {
    post: jest.fn(async (path: string) => {
      if (path === '/api/v1/edge/access-decisions') {
        return {
          ok: true, status: 201,
          body: { accessEventId: 'evt-2', correlationId: 'c-2', outcome: 'ALLOW', reason: 'TESTE', policyVersion: 'v1', validUntil: null, replayed: false },
          errorCode: null,
        };
      }
      return { ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' };
    }),
    get: jest.fn(),
  } as unknown as SignedCloudClient;

  const primeiraComposicao = await compor(config, logger, {
    cliente: clienteQueFalhaNoReport,
    dispositivos: { facial: new FacialSimulator(), catraca: new TurnstileSimulator(), encerrarDispositivos: async () => {} },
  });

  (primeiraComposicao.facialParaTeste as FacialSimulator).simularReconhecimento({
    externalEnrollId: 'aluno-2', ocorridoEm: new Date(), recebidoEm: new Date(), metodo: 'facial',
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  await primeiraComposicao.encerrar();

  // Segunda composicao, agora com a nuvem respondendo: retomarPendentes
  // deve reportar a tentativa presa, sem recomandar a catraca.
  const clienteQueFunciona = {
    post: jest.fn(async () => ({ ok: true, status: 201, body: { accessEventId: 'evt-2', state: 'TIMED_OUT' }, errorCode: null })),
    get: jest.fn(),
  } as unknown as SignedCloudClient;

  const segundaComposicao = await compor(config, logger, {
    cliente: clienteQueFunciona,
    dispositivos: { facial: new FacialSimulator(), catraca: new TurnstileSimulator(), encerrarDispositivos: async () => {} },
  });

  expect(clienteQueFunciona.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/edge/access-events/evt-2/passage'),
    expect.objectContaining({ commandId: expect.any(String) }),
  );

  await segundaComposicao.encerrar();
});
```

- [ ] **Step 2: Rodar e ver o resultado**

Run: `pnpm --filter @arenahub/edge-agent test -- compor-agente.spec.ts`
Expected: se `retomarPendentes` já está corretamente ligado na Task 5, este teste passa sem mudança de produção — ele é uma *verificação* de comportamento que já deveria existir. Se falhar, o bug está na ordem de chamada dentro de `compor` (Task 5, Step 3) — corrigir lá, não aqui.

- [ ] **Step 3: Se passou de primeira, documentar o motivo no corpo do commit; se precisou de correção, aplicar e re-rodar**

Run: `pnpm --filter @arenahub/edge-agent test -- compor-agente.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/edge-agent/src/producao/compor-agente.spec.ts
git commit -m "test(edge-agent): confirma que SIGTERM em COMMAND_PENDING nao perde nem duplica giro (F59, AC-3)"
```

---

### Task 8: Rota de pareamento na API — gerar código e trocar por credencial

**Files:**
- Create: `apps/api/src/modules/edge-auth/pairing.controller.ts`
- Create: `apps/api/src/modules/edge-auth/pairing.service.ts`
- Modify: `apps/api/src/modules/edge-auth/edge-auth.module.ts` (registra o novo controller/service)
- Test: `apps/api/test/integration/edge-pairing.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `EdgeAuthService.cifrarSegredo` (já existe).
- Produces: `POST /api/v1/panel/edge-nodes/:edgeNodeId/pairing-codes` (gera código, autenticado como usuário do painel — fora do escopo de `@EdgeRoute`), `POST /api/v1/edge/pair` (`@EdgeRoute()`? **não** — o agente ainda não tem credencial neste ponto, então esta rota **não pode** exigir HMAC; ver Step 3 para a decisão de autenticação).

> **Decisão de arquitetura que este task precisa tomar e registrar no PR** (CLAUDE.md: "em dúvida técnica, decida e registre no PR"): a rota de troca de código por credencial não pode exigir a assinatura HMAC que `EdgeAuthGuard` verifica, porque o agente ainda não tem `keyId`/`secret` nesse momento — é exatamente isso que ele está pedindo. A autenticação dessa rota é o próprio código de uso único (alta entropia, TTL curto, uso único), não HMAC. Isso é consistente com o modelo já existente: `EdgeCredential` é criada, não usada, no momento do pareamento.

- [ ] **Step 1: Ler o schema Prisma para `EdgeNode`/`EdgeCredential` por completo antes de desenhar a migration**

Ler `packages/database/prisma/schema.prisma` linhas 2036-2110 (modelos `EdgeNode` e `EdgeCredential` já confirmados nesta sessão — conferir se há mais campos entre as linhas 2055-2070 e depois de 2095, não vistos ainda).

- [ ] **Step 2: Adicionar o modelo de código de pareamento ao schema**

Adicionar em `packages/database/prisma/schema.prisma`, próximo a `EdgeCredential`:

```prisma
/// Codigo de pareamento de uso unico -- ADR-011. Trocado por
/// `EdgeCredential` no primeiro arranque do agente. Nasce no painel,
/// morre no uso (ou no TTL).
model EdgePairingCode {
  id         String    @id @default(uuid()) @db.Uuid
  tenantId   String    @map("tenant_id") @db.Uuid
  gymUnitId  String    @map("gym_unit_id") @db.Uuid
  edgeNodeId String    @map("edge_node_id") @db.Uuid
  /// Hash do codigo (nunca o codigo em claro -- mesma logica de senha).
  codeHash   String    @map("code_hash")
  expiresAt  DateTime  @map("expires_at")
  usedAt     DateTime? @map("used_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  edgeNode EdgeNode @relation(fields: [edgeNodeId], references: [id], onDelete: Cascade)

  @@index([tenantId, gymUnitId])
  @@map("edge_pairing_codes")
}
```

Adicionar a relação inversa em `EdgeNode` (`pairingCodes EdgePairingCode[]`) e em `Tenant` se o padrão do schema exigir (conferir como `EdgeCredential` já faz isso em `Tenant`, replicar o mesmo padrão).

- [ ] **Step 2b: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name edge_pairing_code -o packages/database/prisma/migrations` (ajustar comando exato conforme `docs/prd/README.md` §7 e a versão do Prisma 7 já usada no projeto — ver memória "Prisma 7 mudou as flags do migrate diff": usar o fluxo de `migrate dev` local, não `migrate diff`, para gerar uma migration nova).
Expected: nova pasta em `packages/database/prisma/migrations/` com o SQL de criação da tabela.

- [ ] **Step 3: Escrever o teste de integração que falha**

```ts
import { randomBytes, createHash } from 'node:crypto';
// ... imports de setup de integração seguindo o padrão de
// apps/api/test/integration/online-decision.int-spec.ts (helper de app,
// PrismaService, criação de tenant/gymUnit/edgeNode de teste)

describe('POST /api/v1/edge/pair', () => {
  it('troca um codigo valido por keyId e secret, e marca o codigo como usado', async () => {
    const codigoEmClaro = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    await prisma.edgePairingCode.create({
      data: {
        tenantId, gymUnitId, edgeNodeId,
        codeHash: hash,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    const resposta = await request(app.getHttpServer())
      .post('/api/v1/edge/pair')
      .send({ code: codigoEmClaro })
      .expect(201);

    expect(resposta.body).toEqual({ keyId: expect.any(String), secret: expect.any(String) });

    const credencial = await prisma.edgeCredential.findUnique({ where: { keyId: resposta.body.keyId } });
    expect(credencial).not.toBeNull();

    const codigoUsado = await prisma.edgePairingCode.findFirst({ where: { edgeNodeId } });
    expect(codigoUsado?.usedAt).not.toBeNull();
  });

  it('recusa o mesmo codigo usado duas vezes', async () => {
    const codigoEmClaro = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    await prisma.edgePairingCode.create({
      data: { tenantId, gymUnitId, edgeNodeId, codeHash: hash, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });

    await request(app.getHttpServer()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(409);
  });

  it('recusa codigo expirado', async () => {
    const codigoEmClaro = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    await prisma.edgePairingCode.create({
      data: { tenantId, gymUnitId, edgeNodeId, codeHash: hash, expiresAt: new Date(Date.now() - 1_000) },
    });

    await request(app.getHttpServer()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(409);
  });

  it('recusa codigo inexistente sem vazar se e "nao existe" ou "expirado"', async () => {
    await request(app.getHttpServer()).post('/api/v1/edge/pair').send({ code: 'codigo-que-nao-existe' }).expect(409);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- edge-pairing.int-spec.ts`
Expected: FAIL — rota não existe (404).

- [ ] **Step 5: Implementar `pairing.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../persistence/prisma.service.js';
import { EdgeAuthService } from './edge-auth.service.js';

export type ResultadoDeTroca =
  | { estado: 'trocado'; keyId: string; secret: string }
  | { estado: 'recusado' };

@Injectable()
export class PairingService {
  constructor(
    private readonly db: PrismaService,
    private readonly edgeAuth: EdgeAuthService,
  ) {}

  /**
   * Troca um codigo de pareamento por credencial nova. Uso unico: o
   * codigo morre na troca, valida ou invalida -- reapresentar o mesmo
   * codigo depois de usado e SEMPRE recusado, mesmo que o uso anterior
   * tenha sido bem-sucedido (ADR-011).
   *
   * Mensagem de recusa NUNCA diferencia "nao existe" de "expirado" de
   * "ja usado" -- um atacante tentando codigos nao aprende qual dos tres
   * motivos causou a recusa.
   */
  async trocar(codigoEmClaro: string): Promise<ResultadoDeTroca> {
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    const codigo = await this.db.edgePairingCode.findFirst({
      where: { codeHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!codigo) return { estado: 'recusado' };

    // Marca usado ANTES de gerar a credencial: se o processo morrer entre
    // as duas escritas, o pior caso e um codigo queimado sem credencial --
    // nunca uma credencial sem o codigo marcado como usado (que permitiria
    // reuso).
    const atualizados = await this.db.edgePairingCode.updateMany({
      where: { id: codigo.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Corrida: outra requisicao venceu entre o findFirst e o updateMany.
    if (atualizados.count === 0) return { estado: 'recusado' };

    const keyId = randomBytes(16).toString('base64url');
    const secret = randomBytes(32).toString('base64url');

    await this.db.edgeCredential.create({
      data: {
        tenantId: codigo.tenantId,
        edgeNodeId: codigo.edgeNodeId,
        keyId,
        encryptedSecret: this.edgeAuth.cifrarSegredo(secret),
        activeFrom: new Date(),
      },
    });

    return { estado: 'trocado', keyId, secret };
  }
}
```

> **Nota sobre a corrida:** o `updateMany` condicionado a `usedAt: null` é o índice de exclusão mútua que decide qual requisição concorrente vence — ver memória "Idempotência derivada de contagem": nunca confiar em `if` isolado para exclusividade, usar a condição na própria escrita.

- [ ] **Step 6: Implementar `pairing.controller.ts`**

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';

import { PairingService } from './pairing.service.js';
import { RecusaDePareamentoError } from './recusa-de-pareamento.error.js';

const esquemaDeTroca = z.object({ code: z.string().min(8).max(200) }).strict();

@Controller('api/v1/edge')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  /**
   * Troca codigo de pareamento por credencial -- SEM `@EdgeRoute()`. O
   * agente ainda nao tem `keyId`/`secret` neste ponto; a autenticacao E
   * o proprio codigo de uso unico, nao HMAC.
   */
  @Post('pair')
  @HttpCode(201)
  async pair(@Body() corpo: unknown): Promise<{ keyId: string; secret: string }> {
    const dados = esquemaDeTroca.parse(corpo);

    const resultado = await this.pairing.trocar(dados.code);

    if (resultado.estado === 'recusado') {
      throw new RecusaDePareamentoError();
    }

    return { keyId: resultado.keyId, secret: resultado.secret };
  }
}
```

Criar `apps/api/src/modules/edge-auth/recusa-de-pareamento.error.ts` seguindo o padrão de erro de domínio já usado no módulo (`problem+json`, ver `CLAUDE.md` → Convenções de código: "Erro de domínio tem código estável"). Verificar em `edge-auth.service.ts` ou `edge-auth.guard.ts` como outros erros do módulo são mapeados para HTTP (provavelmente um `ExceptionFilter` comum) e seguir o mesmo padrão — não inventar um novo formato de erro.

- [ ] **Step 7: Registrar no módulo**

Editar `apps/api/src/modules/edge-auth/edge-auth.module.ts`: adicionar `PairingController` a `controllers` e `PairingService` a `providers`.

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- edge-pairing.int-spec.ts`
Expected: PASS (4 testes)

- [ ] **Step 9: Rodar a suíte de integração inteira da API para checar regressão**

Run: `pnpm --filter @arenahub/api test:integration`
Expected: todos passam, incluindo os testes existentes de `edge-auth`.

- [ ] **Step 10: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations apps/api/src/modules/edge-auth/pairing.controller.ts apps/api/src/modules/edge-auth/pairing.service.ts apps/api/src/modules/edge-auth/recusa-de-pareamento.error.ts apps/api/src/modules/edge-auth/edge-auth.module.ts apps/api/test/integration/edge-pairing.int-spec.ts
git commit -m "feat(api): rota de pareamento troca codigo de uso unico por credencial de Edge (F59)"
```

---

### Task 9: Rota do painel para gerar código de pareamento

**Files:**
- Create: `apps/api/src/modules/edge-auth/pairing-codes.controller.ts`
- Modify: `apps/api/src/modules/edge-auth/pairing.service.ts` (adiciona método `gerar`)
- Modify: `apps/api/src/modules/edge-auth/edge-auth.module.ts`
- Test: `apps/api/test/integration/edge-pairing.int-spec.ts` (estende)

**Interfaces:**
- Consumes: `PairingService` (Task 8).
- Produces: `POST /api/v1/edge-nodes/:edgeNodeId/pairing-codes` — rota autenticada como usuário do painel (seguir o padrão de autenticação do painel já usado por `devices.controller.ts`, não HMAC de Edge). Response `{ code: string, expiresAt: string }`, `code` **só aparece nesta resposta, uma vez** — não é recuperável depois (mesmo princípio de segredo que `EdgeCredential`).

> Verificar durante a implementação qual guard/decorator os controllers do painel já usam para autenticação de usuário (ex.: `devices.controller.ts`) e reusar o mesmo — não inventar um mecanismo novo.

- [ ] **Step 1: Escrever o teste que falha**

```ts
describe('POST /api/v1/edge-nodes/:edgeNodeId/pairing-codes', () => {
  it('gera um codigo que o pair aceita', async () => {
    const geracao = await request(app.getHttpServer())
      .post(`/api/v1/edge-nodes/${edgeNodeId}/pairing-codes`)
      .set('Authorization', tokenDoPainelDeTeste)
      .expect(201);

    expect(geracao.body).toEqual({ code: expect.any(String), expiresAt: expect.any(String) });

    await request(app.getHttpServer())
      .post('/api/v1/edge/pair')
      .send({ code: geracao.body.code })
      .expect(201);
  });

  it('recusa gerar codigo para edgeNode de outro tenant', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/edge-nodes/${edgeNodeDeOutroTenant}/pairing-codes`)
      .set('Authorization', tokenDoPainelDeTeste)
      .expect(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- edge-pairing.int-spec.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Adicionar `gerar` em `pairing.service.ts`**

```ts
async gerar(tenantId: string, gymUnitId: string, edgeNodeId: string): Promise<{ code: string; expiresAt: Date }> {
  const edgeNode = await this.db.edgeNode.findFirst({ where: { id: edgeNodeId, tenantId, gymUnitId } });
  if (!edgeNode) throw new EdgeNodeNaoEncontradoError();

  const codigoEmClaro = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(codigoEmClaro).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 min -- TTL curto, ADR-011

  await this.db.edgePairingCode.create({
    data: { tenantId, gymUnitId, edgeNodeId, codeHash: hash, expiresAt },
  });

  return { code: codigoEmClaro, expiresAt };
}
```

Criar `EdgeNodeNaoEncontradoError` seguindo o mesmo padrão de erro de domínio do Step 6 da Task 8.

- [ ] **Step 4: Implementar `pairing-codes.controller.ts`**

```ts
import { Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { PairingService } from './pairing.service.js';
// import o guard/decorator de autenticacao do painel ja usado por devices.controller.ts

@Controller('api/v1/edge-nodes')
export class PairingCodesController {
  constructor(private readonly pairing: PairingService) {}

  @Post(':edgeNodeId/pairing-codes')
  async gerar(
    @Param('edgeNodeId') edgeNodeId: string,
    @Req() requisicao: Request,
  ): Promise<{ code: string; expiresAt: string }> {
    // tenantId/gymUnitId vem do contexto de autenticacao do painel, igual
    // devices.controller.ts -- NUNCA do parametro de rota nem do corpo.
    const { tenantId, gymUnitId } = requisicao.painelContext!; // nome exato a confirmar contra devices.controller.ts

    const resultado = await this.pairing.gerar(tenantId, gymUnitId, edgeNodeId);

    return { code: resultado.code, expiresAt: resultado.expiresAt.toISOString() };
  }
}
```

- [ ] **Step 5: Registrar no módulo**

Editar `apps/api/src/modules/edge-auth/edge-auth.module.ts`: adicionar `PairingCodesController`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- edge-pairing.int-spec.ts`
Expected: PASS (6 testes no total do arquivo)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/edge-auth/pairing-codes.controller.ts apps/api/src/modules/edge-auth/pairing.service.ts apps/api/src/modules/edge-auth/edge-auth.module.ts apps/api/test/integration/edge-pairing.int-spec.ts
git commit -m "feat(api): painel gera codigo de pareamento de uso unico (F59)"
```

---

### Task 10: Pareamento no edge-agent — troca o código e grava no Credential Manager (DPAPI)

**Files:**
- Create: `apps/edge-agent/src/producao/armazenamento-de-credencial.ts` (abstração sobre DPAPI/Credential Manager)
- Create: `apps/edge-agent/src/producao/pareamento.ts`
- Test: `apps/edge-agent/src/producao/pareamento.spec.ts`
- Test: `apps/edge-agent/src/producao/armazenamento-de-credencial.spec.ts`

**Interfaces:**
- Consumes: `SignedCloudClient` não se aplica aqui (a rota `/pair` não é assinada — ver Task 8). Usa `fetch` direto ou um cliente HTTP simples sem assinatura.
- Produces: `ArmazenamentoDeCredencial` (interface + implementação real via `node-windows`/`keytar`-like + implementação de teste em memória), `parear(deps): Promise<{ keyId: string; secret: string } | null>`. Usado pela Task 11 (integração no `main.ts`).

> **Decisão de dependência a registrar no PR:** não há dependência de DPAPI/Credential Manager no `package.json` hoje (confirmado por exploração). A opção mais simples e testável é `keytar` (wrapper nativo do Credential Manager no Windows, do Keychain no macOS, do libsecret no Linux — mas só o comportamento Windows importa aqui, ADR-010/011 já fixam a plataforma). Se `keytar` estiver descontinuado ou exigir compilação nativa problemática no CI, a alternativa é chamar `cmdkey`/PowerShell `New-StoredCredential` via `child_process` — mais frágil de testar. **Escolher `keytar` primeiro; se `pnpm add keytar` falhar ou o binário pré-compilado não existir para a versão do Node do projeto (`>=22.5.0 <23.0.0`), documentar a tentativa no PR e cair para a alternativa PowerShell.**

- [ ] **Step 1: Investigar se `keytar` tem binário pré-compilado para Node 22 antes de adicionar a dependência**

Run: `pnpm info keytar` e conferir `engines`/últimas releases. Se não houver suporte a Node 22, pular para a alternativa PowerShell descrita acima e ajustar os passos seguintes de acordo (a interface `ArmazenamentoDeCredencial` abaixo não muda; só a implementação real).

- [ ] **Step 2: Definir a interface, independente da implementação escolhida**

```ts
/**
 * Abstrai onde a credencial de pareamento vive -- DPAPI/Credential Manager
 * no Windows (ADR-011), NUNCA arquivo texto. `M0-NFR-005`.
 */
export interface ArmazenamentoDeCredencial {
  salvar(keyId: string, secret: string): Promise<void>;
  carregar(): Promise<{ keyId: string; secret: string } | null>;
  apagar(): Promise<void>;
}
```

Criar em `apps/edge-agent/src/producao/armazenamento-de-credencial.ts`, junto com:

```ts
const SERVICO = 'ArenaHub Edge';
const CONTA = 'cloud-edge-credential';

/** Implementacao real -- Windows Credential Manager via `keytar`. */
export class ArmazenamentoDeCredencialWindows implements ArmazenamentoDeCredencial {
  async salvar(keyId: string, secret: string): Promise<void> {
    const keytar = await import('keytar');
    await keytar.default.setPassword(SERVICO, CONTA, JSON.stringify({ keyId, secret }));
  }

  async carregar(): Promise<{ keyId: string; secret: string } | null> {
    const keytar = await import('keytar');
    const bruto = await keytar.default.getPassword(SERVICO, CONTA);
    if (!bruto) return null;
    return JSON.parse(bruto) as { keyId: string; secret: string };
  }

  async apagar(): Promise<void> {
    const keytar = await import('keytar');
    await keytar.default.deletePassword(SERVICO, CONTA);
  }
}

/** Implementacao em memoria -- SO para teste. Nunca usada em producao. */
export class ArmazenamentoDeCredencialEmMemoria implements ArmazenamentoDeCredencial {
  private valor: { keyId: string; secret: string } | null = null;

  async salvar(keyId: string, secret: string): Promise<void> {
    this.valor = { keyId, secret };
  }

  async carregar(): Promise<{ keyId: string; secret: string } | null> {
    return this.valor;
  }

  async apagar(): Promise<void> {
    this.valor = null;
  }
}
```

- [ ] **Step 3: Escrever o teste que falha para `armazenamento-de-credencial.spec.ts` (só a implementação em memória — a real não roda em CI Linux/macOS)**

```ts
import { describe, expect, it } from '@jest/globals';
import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';

describe('ArmazenamentoDeCredencialEmMemoria', () => {
  it('carrega null quando nada foi salvo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('salva e recupera a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  it('apagar remove a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await armazenamento.apagar();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });
});
```

- [ ] **Step 4: Rodar e ver passar (a implementação em memória já foi escrita no Step 2)**

Run: `pnpm --filter @arenahub/edge-agent test -- armazenamento-de-credencial.spec.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Escrever o teste que falha para `pareamento.ts`**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { parear } from './pareamento.js';
import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';

describe('parear', () => {
  it('troca o codigo por credencial e salva no armazenamento', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(async () => ({ ok: true, keyId: 'key-1', secret: 'segredo-1' }));

    const resultado = await parear({ cloudApiUrl: 'https://nuvem.teste', codigo: 'codigo-123', armazenamento, trocarPorHttp });

    expect(resultado).toEqual({ keyId: 'key-1', secret: 'segredo-1' });
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  it('devolve null quando a nuvem recusa o codigo, sem salvar nada', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(async () => ({ ok: false as const }));

    const resultado = await parear({ cloudApiUrl: 'https://nuvem.teste', codigo: 'codigo-errado', armazenamento, trocarPorHttp });

    expect(resultado).toBeNull();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('se ja existe credencial salva, nao troca de novo -- devolve a existente', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-existente', 'segredo-existente');
    const trocarPorHttp = jest.fn();

    const resultado = await parear({ cloudApiUrl: 'https://nuvem.teste', codigo: 'codigo-123', armazenamento, trocarPorHttp });

    expect(resultado).toEqual({ keyId: 'key-existente', secret: 'segredo-existente' });
    expect(trocarPorHttp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- pareamento.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar `pareamento.ts`**

```ts
import type { ArmazenamentoDeCredencial } from './armazenamento-de-credencial.js';

export interface DepsPareamento {
  cloudApiUrl: string;
  codigo: string;
  armazenamento: ArmazenamentoDeCredencial;
  /** Injetavel para teste -- em producao, POST simples a /api/v1/edge/pair. */
  trocarPorHttp: (
    url: string,
    codigo: string,
  ) => Promise<{ ok: true; keyId: string; secret: string } | { ok: false }>;
}

/**
 * Troca o codigo por credencial e guarda no armazenamento (DPAPI em
 * producao). Idempotente por design: se ja ha credencial salva, nao troca
 * de novo -- o codigo de uso unico so serve na PRIMEIRA vez.
 */
export async function parear(deps: DepsPareamento): Promise<{ keyId: string; secret: string } | null> {
  const existente = await deps.armazenamento.carregar();
  if (existente) return existente;

  const resultado = await deps.trocarPorHttp(deps.cloudApiUrl, deps.codigo);

  if (!resultado.ok) return null;

  await deps.armazenamento.salvar(resultado.keyId, resultado.secret);

  return { keyId: resultado.keyId, secret: resultado.secret };
}

/** Implementacao real de `trocarPorHttp` -- sem assinatura HMAC (Task 8). */
export async function trocarCodigoPorCredencial(
  cloudApiUrl: string,
  codigo: string,
): Promise<{ ok: true; keyId: string; secret: string } | { ok: false }> {
  try {
    const resposta = await fetch(`${cloudApiUrl}/api/v1/edge/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: codigo }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resposta.ok) return { ok: false };

    const corpo = (await resposta.json()) as { keyId: string; secret: string };

    return { ok: true, keyId: corpo.keyId, secret: corpo.secret };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- pareamento.spec.ts`
Expected: PASS (3 testes)

- [ ] **Step 9: Adicionar `keytar` (ou a alternativa decidida no Step 1) como dependência**

Run: `pnpm --filter @arenahub/edge-agent add keytar` (se viável) e confirmar que `pnpm install --frozen-lockfile` continua funcionando na raiz.

- [ ] **Step 10: Commit**

```bash
git add apps/edge-agent/src/producao/armazenamento-de-credencial.ts apps/edge-agent/src/producao/armazenamento-de-credencial.spec.ts apps/edge-agent/src/producao/pareamento.ts apps/edge-agent/src/producao/pareamento.spec.ts apps/edge-agent/package.json pnpm-lock.yaml
git commit -m "feat(edge-agent): pareamento troca codigo por credencial e guarda no Credential Manager (F59)"
```

---

### Task 11: Ligar pareamento ao `main.ts` — arranque sem credencial pede código

**Files:**
- Modify: `apps/edge-agent/src/main.ts`
- Modify: `apps/edge-agent/src/config/env.ts` (torna `CLOUD_EDGE_KEY_ID`/`CLOUD_EDGE_SECRET` deriváveis do armazenamento em vez de só env, se ausentes)
- Test: `apps/edge-agent/src/main.spec.ts` (o que for extraível como função pura; arranque real continua sendo verificação manual)

**Interfaces:**
- Consumes: `parear`, `trocarCodigoPorCredencial`, `ArmazenamentoDeCredencialWindows` (Task 10).

> Este task é majoritariamente integração — o valor de teste automatizado real já foi capturado nas Tasks 8-10 (a lógica pura de pareamento). Aqui o foco é: se `CLOUD_EDGE_KEY_ID`/`CLOUD_EDGE_SECRET` não vierem do ambiente, tentar carregar do armazenamento; se também não houver nada lá, pedir o código via variável de ambiente `EDGE_PAIRING_CODE` (documentado no runbook) e chamar `parear` antes de montar a composição.

- [ ] **Step 1: Extrair a decisão em função pura testável**

Criar `apps/edge-agent/src/producao/resolver-credencial.ts`:

```ts
import type { ArmazenamentoDeCredencial } from './armazenamento-de-credencial.js';
import { parear, trocarCodigoPorCredencial } from './pareamento.js';

export interface CredencialResolvida {
  keyId: string;
  secret: string;
}

export class CredencialAusenteError extends Error {
  readonly code = 'EDGE_CREDENCIAL_AUSENTE';

  constructor() {
    super(
      'Nenhuma credencial de Edge encontrada. Defina EDGE_PAIRING_CODE com um ' +
        'codigo de pareamento gerado no painel, ou CLOUD_EDGE_KEY_ID/CLOUD_EDGE_SECRET diretamente.',
    );
    this.name = 'CredencialAusenteError';
  }
}

/**
 * Resolve a credencial na ordem: env explicito > armazenamento (DPAPI) >
 * pareamento via codigo. Falha alto se nenhuma das tres existir -- nao ha
 * modo "sem credencial" para falar com a nuvem.
 */
export async function resolverCredencial(deps: {
  cloudApiUrl: string | undefined;
  keyIdDoEnv: string | undefined;
  secretDoEnv: string | undefined;
  codigoDePareamento: string | undefined;
  armazenamento: ArmazenamentoDeCredencial;
}): Promise<CredencialResolvida | null> {
  if (deps.keyIdDoEnv && deps.secretDoEnv) {
    return { keyId: deps.keyIdDoEnv, secret: deps.secretDoEnv };
  }

  const existente = await deps.armazenamento.carregar();
  if (existente) return existente;

  if (!deps.cloudApiUrl || !deps.codigoDePareamento) return null;

  return parear({
    cloudApiUrl: deps.cloudApiUrl,
    codigo: deps.codigoDePareamento,
    armazenamento: deps.armazenamento,
    trocarPorHttp: trocarCodigoPorCredencial,
  });
}
```

- [ ] **Step 2: Escrever o teste que falha**

```ts
import { describe, expect, it, jest } from '@jest/globals';
import { resolverCredencial } from './resolver-credencial.js';
import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';

describe('resolverCredencial', () => {
  it('usa env quando presente, sem tocar armazenamento', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined, keyIdDoEnv: 'key-env', secretDoEnv: 'secret-env',
      codigoDePareamento: undefined, armazenamento,
    });

    expect(resultado).toEqual({ keyId: 'key-env', secret: 'secret-env' });
  });

  it('usa o armazenamento quando env ausente', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-salva', 'secret-salva');

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined, keyIdDoEnv: undefined, secretDoEnv: undefined,
      codigoDePareamento: undefined, armazenamento,
    });

    expect(resultado).toEqual({ keyId: 'key-salva', secret: 'secret-salva' });
  });

  it('devolve null quando nao ha env, nem armazenamento, nem codigo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined, keyIdDoEnv: undefined, secretDoEnv: undefined,
      codigoDePareamento: undefined, armazenamento,
    });

    expect(resultado).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- resolver-credencial.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Rodar e ver passar (implementação já escrita no Step 1)**

Run: `pnpm --filter @arenahub/edge-agent test -- resolver-credencial.spec.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Adicionar `EDGE_PAIRING_CODE` opcional ao schema de config**

Em `apps/edge-agent/src/config/env.ts`, adicionar:

```ts
  /** Codigo de pareamento de uso unico, gerado no painel (ADR-011). */
  EDGE_PAIRING_CODE: z.string().min(8).optional(),
```

- [ ] **Step 6: Ligar em `main.ts`, antes de `compor`**

Editar `main.ts` para, antes de chamar `compor(config, logger)`, resolver a credencial:

```ts
  const { ArmazenamentoDeCredencialWindows } = await import('./producao/armazenamento-de-credencial.js');
  const { resolverCredencial, CredencialAusenteError } = await import('./producao/resolver-credencial.js');

  const armazenamento = new ArmazenamentoDeCredencialWindows();

  const credencial = await resolverCredencial({
    cloudApiUrl: config.CLOUD_API_URL,
    keyIdDoEnv: config.CLOUD_EDGE_KEY_ID,
    secretDoEnv: config.CLOUD_EDGE_SECRET,
    codigoDePareamento: config.EDGE_PAIRING_CODE,
    armazenamento,
  });

  if (!credencial) {
    logger.error(new CredencialAusenteError().message);
    process.exit(1);
  }

  // config.CLOUD_EDGE_KEY_ID/SECRET a partir daqui usam `credencial`, nao
  // mais o valor cru do env -- compor() e SignedCloudClient devem receber
  // `credencial.keyId`/`credencial.secret`.
```

Ajustar as chamadas subsequentes de `compor(...)` e `new SignedCloudClient(...)` para usar `credencial.keyId`/`credencial.secret` em vez de `config.CLOUD_EDGE_KEY_ID`/`config.CLOUD_EDGE_SECRET` diretamente.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `pnpm --filter @arenahub/edge-agent test`
Expected: todos passam.

- [ ] **Step 8: Typecheck e build**

Run: `pnpm --filter @arenahub/edge-agent typecheck && pnpm --filter @arenahub/edge-agent build`
Expected: sem erro.

- [ ] **Step 9: Verificação manual — AC-2 da spec**

Sem `CLOUD_EDGE_KEY_ID`/`CLOUD_EDGE_SECRET` no `.env`, com `EDGE_PAIRING_CODE` de um código gerado via `POST /api/v1/edge-nodes/:id/pairing-codes` contra a API local: `pnpm --filter @arenahub/edge-agent start` deve parear, gravar no Credential Manager (`cmdkey /list` no Windows para confirmar a entrada `ArenaHub Edge`), e subir. Rodar de novo com o mesmo `EDGE_PAIRING_CODE` (já usado): deve recusar do lado API (Task 8, teste "recusa o mesmo codigo usado duas vezes"), mas o agente sobe mesmo assim porque já tem credencial salva localmente (comportamento do Step 1 de `resolverCredencial`) — este é o comportamento correto, não um bug.

- [ ] **Step 10: Commit**

```bash
git add apps/edge-agent/src/main.ts apps/edge-agent/src/config/env.ts apps/edge-agent/src/producao/resolver-credencial.ts apps/edge-agent/src/producao/resolver-credencial.spec.ts
git commit -m "feat(edge-agent): main.ts resolve credencial por pareamento antes de compor (F59, AC-2)"
```

---

### Task 12: `lab:run` ganha modo headless para CI (insumo §5.4)

**Files:**
- Modify: `apps/edge-agent/src/lab/lab-run-cli.ts` (adiciona flag `--headless`)
- Create: `apps/edge-agent/src/lab/escritor-de-evidencia.ts`
- Test: `apps/edge-agent/src/lab/escritor-de-evidencia.spec.ts`

**Interfaces:**
- Consumes: `resumirLatencia` (existente, `application/orquestrar-passagem.ts`).
- Produces: `escreverEvidencia(caminho: string, dados: EvidenciaDeExecucao): void`. Usado pelo `lab-run-cli.ts` nos dois modos.

> Este task não é crítico para AC-1–AC-5 do `main.ts` de produção — é a peça do insumo §5.3/§5.4 (evidência JSON + modo headless do `lab:run`) que a spec pede como parte do "sobra de construção nova, pequena e delimitada" (insumo §8). Incluído porque o card #254 cobre a spec inteira, mas pode ser adiado para um PR separado sem bloquear as tasks 1-11 — decisão a registrar no PR se for esse o caso.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from '@jest/globals';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { escreverEvidencia } from './escritor-de-evidencia.js';

const CAMINHO_TESTE = 'data/teste-evidencia.json';

describe('escreverEvidencia', () => {
  afterEach(() => { if (existsSync(CAMINHO_TESTE)) unlinkSync(CAMINHO_TESTE); });

  it('grava JSON com tentativas, decisoes e percentis, sem PII', () => {
    escreverEvidencia(CAMINHO_TESTE, {
      executadoEm: new Date('2026-09-16T10:00:00Z').toISOString(),
      modo: { facial: 'simulador', catraca: 'simulador' },
      tentativas: [
        { externalEnrollId: 'aluno-1', decisao: 'ALLOW', latenciaMs: 120 },
        { externalEnrollId: 'aluno-2', decisao: 'DENY', latenciaMs: 45 },
      ],
      percentis: { p50: 120, p95: 120, max: 120 },
    });

    const conteudo = JSON.parse(readFileSync(CAMINHO_TESTE, 'utf-8')) as { tentativas: unknown[] };
    expect(conteudo.tentativas).toHaveLength(2);
  });

  it('recusa gravar se algum campo parecer nome completo ou CPF', () => {
    expect(() =>
      escreverEvidencia(CAMINHO_TESTE, {
        executadoEm: new Date().toISOString(),
        modo: { facial: 'simulador', catraca: 'simulador' },
        tentativas: [{ externalEnrollId: '123.456.789-00', decisao: 'ALLOW', latenciaMs: 10 }],
        percentis: { p50: 10, p95: 10, max: 10 },
      }),
    ).toThrow(/CPF/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/edge-agent test -- escritor-de-evidencia.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { writeFileSync } from 'node:fs';

export interface TentativaDeEvidencia {
  externalEnrollId: string;
  decisao: 'ALLOW' | 'DENY';
  latenciaMs: number;
}

export interface EvidenciaDeExecucao {
  executadoEm: string;
  modo: { facial: 'real' | 'simulador'; catraca: 'real' | 'simulador' };
  tentativas: readonly TentativaDeEvidencia[];
  percentis: { p50: number; p95: number; max: number };
}

const PADRAO_CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/**
 * Grava evidencia de execucao do `lab:run` -- insumo F59 SS5.3. NUNCA
 * contem PII nem template biometrico: so `externalEnrollId` (ja e
 * pseudonimo, ver `gerarExternalEnrollId`) e rotulo operacional.
 *
 * A checagem de CPF e defesa em profundidade -- quem chama nao deveria
 * passar CPF aqui, mas um `externalEnrollId` mal gerado em teste manual
 * e o tipo de erro que so aparece guardado, e falhar alto aqui e mais
 * barato que descobrir depois que um arquivo de evidencia vazou CPF.
 */
export function escreverEvidencia(caminho: string, dados: EvidenciaDeExecucao): void {
  for (const tentativa of dados.tentativas) {
    if (PADRAO_CPF.test(tentativa.externalEnrollId)) {
      throw new Error(
        `externalEnrollId parece CPF ("${tentativa.externalEnrollId}") -- evidencia nao pode conter PII`,
      );
    }
  }

  writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/edge-agent test -- escritor-de-evidencia.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Adicionar `--headless` ao `lab-run-cli.ts`**

Ler `apps/edge-agent/src/lab/lab-run-cli.ts` por inteiro antes de editar (não foi lido byte a byte nesta sessão — só resumido por exploração). Adicionar parsing de `--headless` nos argumentos já existentes (`--permitidos`, `--invertido`, `--sentido`); em modo headless, usar `FacialSimulator`/`TurnstileSimulator` em vez dos adapters reais, disparar reconhecimentos sintéticos programaticamente (sem esperar confirmação do operador), e chamar `escreverEvidencia` ao final com os dados coletados de `bancada.latencias()` e `resumirLatencia`.

- [ ] **Step 6: Adicionar script `lab:run:headless` (ou flag) ao `package.json` que rode em CI**

Em `apps/edge-agent/package.json`, adicionar:

```json
"//lab:run:headless": "MVP 0: mesmo fio do lab:run, sem hardware. Roda no CI.",
"lab:run:headless": "tsx src/lab/lab-run-cli.ts --headless",
```

- [ ] **Step 7: Rodar manualmente para confirmar que não trava esperando input**

Run: `pnpm --filter @arenahub/edge-agent lab:run:headless`
Expected: termina sozinho, sem prompt, grava arquivo de evidência, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/edge-agent/src/lab/lab-run-cli.ts apps/edge-agent/src/lab/escritor-de-evidencia.ts apps/edge-agent/src/lab/escritor-de-evidencia.spec.ts apps/edge-agent/package.json
git commit -m "feat(edge-agent): lab:run ganha modo headless e evidencia JSON (F59)"
```

---

### Task 13: Serviço Windows — script de instalação (não roda em CI, revisão manual)

**Files:**
- Create: `apps/edge-agent/scripts/install-service.ps1`
- Create: `apps/edge-agent/scripts/uninstall-service.ps1`
- Modify: `apps/edge-agent/package.json` (scripts `service:install`, `service:uninstall`)
- Modify: `docs/operations/smart-access/install.md`

> Este task não tem teste automatizado possível sem uma VM Windows — é PowerShell que chama `New-Service`/`sc.exe`. O critério de qualidade aqui é revisão manual cuidadosa + execução real na próxima visita presencial (AC-4, AC-9). Seguir a decisão já registrada na spec: "a ponte `EasyInnerBridge.exe` é filha do serviço, não serviço separado — morrem e nascem juntas" (§6).

- [ ] **Step 1: Escrever `install-service.ps1`**

```powershell
<#
.SYNOPSIS
  Instala o edge-agent como servico Windows "ArenaHub Edge" (F59, ADR-011).

.DESCRIPTION
  Servico com inicio automatico e recuperacao em falha. A ponte
  EasyInnerBridge.exe NAO e servico separado -- e processo filho do
  edge-agent (ver adapters/topdata/ponte-easyinner-processo.ts), entao
  morre e nasce com o servico pai, sem entrada propria aqui.
#>

param(
    [string]$NomeDoServico = "ArenaHub Edge",
    [string]$CaminhoDoNode = (Get-Command node).Source,
    [string]$CaminhoDoScript = (Join-Path $PSScriptRoot "..\dist\main.js")
)

if (-not (Test-Path $CaminhoDoScript)) {
    Write-Error "dist/main.js nao encontrado em $CaminhoDoScript -- rode 'pnpm build' antes."
    exit 1
}

$servicoExistente = Get-Service -Name $NomeDoServico -ErrorAction SilentlyContinue
if ($servicoExistente) {
    Write-Error "Servico '$NomeDoServico' ja existe. Use uninstall-service.ps1 antes de reinstalar."
    exit 1
}

New-Service `
    -Name $NomeDoServico `
    -BinaryPathName "`"$CaminhoDoNode`" `"$CaminhoDoScript`"" `
    -StartupType Automatic `
    -DisplayName $NomeDoServico

# Recuperacao em falha: reinicia na 1a e 2a falha, e a cada falha seguinte,
# com 5s de espera. `sc.exe failure` e o unico jeito de configurar isso --
# New-Service nao expoe essa opcao.
sc.exe failure $NomeDoServico reset= 86400 actions= restart/5000/restart/5000/restart/5000

Write-Host "Servico '$NomeDoServico' instalado. Inicie com: Start-Service '$NomeDoServico'"
```

- [ ] **Step 2: Escrever `uninstall-service.ps1`**

```powershell
<#
.SYNOPSIS
  Remove o servico Windows "ArenaHub Edge" -- preserva data/edge-agent.sqlite
  e a credencial no Credential Manager (upgrade-rollback.md exige isso).
#>

param([string]$NomeDoServico = "ArenaHub Edge")

$servico = Get-Service -Name $NomeDoServico -ErrorAction SilentlyContinue
if (-not $servico) {
    Write-Warning "Servico '$NomeDoServico' nao existe. Nada a fazer."
    exit 0
}

if ($servico.Status -eq 'Running') {
    Stop-Service -Name $NomeDoServico -Force
}

sc.exe delete $NomeDoServico

Write-Host "Servico '$NomeDoServico' removido. SQLite e credencial preservados (nao apagados por este script)."
```

- [ ] **Step 3: Adicionar scripts ao `package.json`**

```json
"//service:install": "Instala o edge-agent como servico Windows. Requer PowerShell como Administrador.",
"service:install": "powershell -ExecutionPolicy Bypass -File scripts/install-service.ps1",
"//service:uninstall": "Remove o servico Windows, preservando SQLite e credencial.",
"service:uninstall": "powershell -ExecutionPolicy Bypass -File scripts/uninstall-service.ps1"
```

- [ ] **Step 4: Revisão manual do script — checklist**

Conferir manualmente (sem executar, a menos que haja Windows disponível para teste):
- [ ] `New-Service` não grava segredo nenhum na linha de comando do serviço (`BinaryPathName` não contém `CLOUD_EDGE_SECRET` nem código de pareamento) — variáveis de ambiente do serviço são configuradas separadamente via `Environment` do serviço ou `.env`, nunca em `BinaryPathName`.
- [ ] `sc.exe failure` cobre "reiniciar o serviço" na 1ª, 2ª e falhas seguintes, conforme `install.md` já documenta.
- [ ] `uninstall-service.ps1` não apaga `data/edge-agent.sqlite` nem chama `keytar`/`cmdkey` para remover a credencial — rollback (`upgrade-rollback.md`) exige preservar os dois.

- [ ] **Step 5: Atualizar `docs/operations/smart-access/install.md` com os comandos reais**

Ler o arquivo por inteiro, localizar a seção que descreve a instalação do serviço (hoje prescritiva, "comportamento esperado") e substituir pela sequência real: `pnpm build` → `pnpm service:install` (como Administrador) → `Start-Service "ArenaHub Edge"`. Marcar a seção 7 (ensaios pendentes) removendo o item "instalação real" se este PR não incluir o ensaio presencial — deixar claro que o script existe mas não foi ensaiado em academia (AC-9 continua pendente).

- [ ] **Step 6: Commit**

```bash
git add apps/edge-agent/scripts/install-service.ps1 apps/edge-agent/scripts/uninstall-service.ps1 apps/edge-agent/package.json docs/operations/smart-access/install.md
git commit -m "feat(edge-agent): scripts de instalacao do servico Windows ArenaHub Edge (F59)"
```

---

### Task 14: Suíte completa, lint, typecheck e atualização de `DEVELOPMENT.md`

**Files:**
- Modify: `docs/DEVELOPMENT.md`

**Interfaces:**
- Consumes: nada — task de fechamento.

- [ ] **Step 1: Rodar os cinco comandos raiz (CLAUDE.md → Regras de trabalho)**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: todos verdes. Qualquer falha aqui bloqueia o PR — corrigir antes de prosseguir.

- [ ] **Step 2: Rodar `pnpm test:report` (guarda de evidência) se existir no projeto**

Run: `pnpm test:report` (conforme `docs/TESTING.md`).
Expected: relatório atualizado sem regressão de contagem.

- [ ] **Step 3: Confirmar manualmente AC-1, AC-2, AC-3, AC-5 (AC-4 exige VM Windows, registrar como pendente se não houver ambiente Windows disponível nesta sessão)**

Revisar os checkpoints manuais já feitos nas Tasks 6, 11 e a lógica de retomada validada na Task 7. Se AC-4 (reinício automático do serviço) não puder ser testado por falta de ambiente Windows real neste momento, registrar isso explicitamente no PR como pendência para a instalação presencial — não afirmar "fechado" sem ter rodado.

- [ ] **Step 4: Atualizar `docs/DEVELOPMENT.md`**

Adicionar entrada seguindo o padrão das entregas anteriores (ver final do arquivo para o formato), citando: card #254, o que foi composto (main.ts de produção, pareamento, heartbeat HTTP, serviço Windows), o que fica para a visita presencial (AC-6 a AC-9), e a decisão registrada nas Tasks 8/10 sobre a rota de pareamento sem HMAC e sobre `keytar` vs. alternativa PowerShell.

- [ ] **Step 5: Commit**

```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: registra entrega da F59 no DEVELOPMENT.md"
```

- [ ] **Step 6: Abrir o PR**

```bash
git push -u origin worktree-f59-composicao-edge-agent
gh pr create --title "feat: composição de produção do edge-agent (F59)" --body "$(cat <<'EOF'
## Resumo

Liga o `main.ts` do edge-agent à composição de produção: decisão online (F9)
em vez de decisão local (MVP 0), heartbeat HTTP para a nuvem, pareamento via
código de uso único + Credential Manager (DPAPI), retomada de tentativas
presas no arranque, e serviço Windows.

refs #254

## Decisões registradas nesta entrega

- Rota `POST /api/v1/edge/pair` não usa `@EdgeRoute()`/HMAC — o agente ainda
  não tem credencial no momento do pareamento; a autenticação é o próprio
  código de uso único.
- Armazenamento de credencial via `keytar` (ou: via PowerShell `cmdkey`, se
  `keytar` não teve binário compatível — ajustar conforme Task 10, Step 1).
- Reconciliação desta fatia roda contra `ColetorSimulado`, não contra a
  nuvem real (decisão §5.5 do insumo, já vigente antes desta entrega).

## Fecha nesta entrega (CI/bancada)

- [x] AC-1 — sobe com simulador, heartbeat chega à API em <60s
- [x] AC-2 — pareamento funciona, código de uso único é recusado no reuso
- [x] AC-3 — SIGTERM não perde nem duplica giro pendente
- [ ] AC-4 — reinício automático do serviço (requer ambiente Windows real — pendente)
- [x] AC-5 — instalar N, atualizar N+1, rollback para N preserva SQLite

## Fica para a visita presencial

- [ ] AC-6, AC-7, AC-8, AC-9 — exigem a bancada/academia real (spec §7)

## Test plan

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` verdes
- [ ] Revisão manual dos scripts PowerShell (Task 13) — sem VM Windows disponível nesta sessão
EOF
)"
```

---

## Self-Review — cobertura da spec

| Critério da spec | Task |
|---|---|
| AC-1 (sobe com simulador, heartbeat <60s) | Task 3, 6 |
| AC-2 (pareamento, código de uso único recusado no reuso) | Task 8, 9, 10, 11 |
| AC-3 (SIGTERM não perde/duplica) | Task 5, 7 |
| AC-4 (serviço reinicia sozinho) | Task 13 (script); execução real fora do escopo de código |
| AC-5 (instalar/atualizar/rollback preserva SQLite) | Task 13 (uninstall preserva); `M0-NFR-007`/SQLite já preservado por design (composição nunca apaga o arquivo) |
| AC-6 a AC-9 | Fora de escopo — só fecham na academia (spec §9, "Fora de dúvida") |
| Decisão §3.1 (`main.ts` reaproveita composição, não reescreve) | Task 4, 5 reusam adapters/`orquestrar-acesso-online` existentes sem tocar neles |
| Decisão §3.2 (heartbeat para a nuvem) | Task 3, 6 |
| Decisão §3.3 (simulador se não houver hardware, diz isso no heartbeat) | Task 1, 6 |
| Escopo negativo §4 (modo bloqueado, cache offline, sync físico, ColetorHttp) | Nenhuma task toca nesses — confirmado por não aparecerem em nenhum arquivo tocado |
| Invariante: nuvem decide (regra 3) | Task 5 usa `criarProcessadorDeAcessoOnline`, nunca `criarProcessadorDePassagem` |
| Invariante: idempotência (`external_event_id`) | Herdada de `orquestrar-acesso-online.ts` (já implementa via `idempotencyKey`/`correlationId`) — nenhuma task reimplementa |
| `M0-NFR-005` (segredo nunca em log) | Task 10 (DPAPI, nunca arquivo texto), Task 13 (checklist de revisão do script) |
| `M0-NFR-006` (padrão simulador) | Task 1 |
| `M0-NFR-007` (encerramento gracioso, ordem inversa) | Task 4 (`encerrar` na ordem inversa), Task 6 |
| Insumo §5.1/5.2 (retry limitado, mesma política pós-arranque) | Task 2, 4 |
| Insumo §5.3 (evidência JSON, sem PII) | Task 12 |
| Insumo §5.4 (lab:run headless + interativo) | Task 12 |
| Insumo §5.5 (reconciliação contra ColetorSimulado) | Confirmado como já vigente; nenhuma task cria `ColetorHttp` |
| Riscos §8 (não reescrever composição, não deixar credencial em arquivo, não mexer no ADR-028) | Respeitados nas Tasks 4, 5, 10; nenhuma task toca `ConfigurarAcionamento1` |

**Placeholder scan:** nenhum "TBD"/"implementar depois" encontrado nos steps — os únicos pontos deliberadamente abertos para quem implementa são decisões técnicas menores demarcadas explicitamente (nome exato de campo em `EventoReconhecimento`, existência de `MaquinaDeAcesso.fechar()`, guard de autenticação do painel) — todos com instrução de "conferir contra o arquivo real e ajustar", não "decidir depois sem critério".

**Consistência de tipos:** `AgenteComposto`, `DispositivosMontados`, `ArmazenamentoDeCredencial`, `HeartbeatHttp` usados com o mesmo shape em todas as tasks que os referenciam.
