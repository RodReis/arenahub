import { type TurnstileAdapter } from '../domain/turnstile.js';
import {
  ESTADO,
  type MaquinaDeAcesso,
  type TentativaDeAcesso,
} from '../persistence/maquina-de-acesso.js';
import { FilaPorPessoa } from './fila-por-pessoa.js';

/**
 * Do reconhecimento a passagem, com a NUVEM decidindo -- F9, Task 4.
 *
 * Diferenca para `orquestrar-passagem.ts` (MVP 0): la a decisao era local,
 * para provar que a cadeia fisica funciona. Aqui quem decide e o Access
 * Decision Engine na nuvem (ADR-004, regra de arquitetura no 1), e o Edge
 * vira executor: pergunta, registra, comanda uma vez, reporta.
 *
 * A REGRA QUE ESTE ARQUIVO EXISTE PARA GARANTIR, herdada do MVP 0:
 *
 *   **`DENY` NUNCA chega perto da catraca.**
 *
 * Nao e disciplina, e estrutura: o unico `liberar()` do arquivo esta depois
 * de um `return` no caminho de negativa.
 *
 * E a regra NOVA desta fatia:
 *
 *   **Falha de comunicacao NUNCA vira ALLOW.**
 *
 * Ate a Slice 1.5 (operacao offline) existir, timeout da nuvem e `DENY`
 * explicito -- plano F9 §1. Interpretar silencio como permissao seria
 * inventar entitlement que ninguem concedeu.
 */

/** Prazo para o equipamento confirmar giro. Herdado do MVP 0. */
export const TIMEOUT_PASSAGEM_MS = 8_000;

/** Prazo para a nuvem responder a decisao. */
export const TIMEOUT_DECISAO_MS = 3_000;

export interface RespostaDeDecisao {
  accessEventId: string;
  outcome: 'ALLOW' | 'DENY';
  reason: string;
  validUntil: string | null;
}

/**
 * Reconhecimento com a origem resolvida.
 *
 * `EventoReconhecimento` (MVP 0) nao carrega `deviceId`: na bancada havia um
 * leitor so, e a origem era implicita. F9 precisa dela -- a nuvem resolve
 * identidade por `(device, externalUserId)`, e o mesmo `enrollid` em leitores
 * diferentes e outra pessoa.
 *
 * `recognitionId` cai para o `idExternoDoEvento` quando o equipamento
 * informa. Quando nao informa, quem chama gera um id estavel por
 * reconhecimento -- e ele que a unicidade do banco usa para nao transformar
 * uma rajada do leitor em varias tentativas.
 */
export interface ReconhecimentoComOrigem {
  externalEnrollId: string;
  deviceId: string;
  recognitionId: string;
  ocorridoEm: Date;
}

export interface DepsAcessoOnline {
  maquina: MaquinaDeAcesso;
  catraca: TurnstileAdapter;
  /** Pergunta a nuvem. Rejeita ou devolve `null` quando nao deu para falar. */
  pedirDecisao: (entrada: {
    deviceId: string;
    externalUserId: string;
    recognitionId: string;
    recognizedAt: Date;
    idempotencyKey: string;
  }) => Promise<RespostaDeDecisao | null>;
  /** Informa o desfecho fisico. Falha aqui NAO desfaz o giro. */
  reportarPassagem: (
    accessEventId: string,
    estado: 'CONFIRMED' | 'TIMED_OUT',
    commandId: string,
    reportedAt: Date,
  ) => Promise<boolean>;
  agoraMonotonicoMs: () => number;
}

export interface ResultadoDeAcesso {
  correlationId: string;
  estado: TentativaDeAcesso['estado'];
  outcome: 'ALLOW' | 'DENY';
  reason: string;
  accessEventId: string | null;
  /** Do reconhecimento ate a resposta da nuvem. Alimenta `M1-NFR-002`. */
  latenciaDecisaoMs: number;
  duracaoPassagemMs?: number;
}

/**
 * Processa um reconhecimento -- SEM serializacao.
 *
 * ⚠️ NAO CHAME DIRETO em producao. Use `criarProcessadorDeAcessoOnline`, que
 * serializa por pessoa. Duas chamadas concorrentes para a MESMA pessoa
 * produziriam dois `recognitionId` distintos e, portanto, duas tentativas
 * legitimas -- a unicidade do banco nao pega, porque as chaves diferem.
 *
 * Exportada porque testar a maquina isolada da fila e legitimo.
 */
export async function processarAcessoOnline(
  deps: DepsAcessoOnline,
  evento: ReconhecimentoComOrigem,
  correlationId: string,
  agora: Date,
  timeoutPassagemMs: number = TIMEOUT_PASSAGEM_MS,
): Promise<ResultadoDeAcesso> {
  const inicio = deps.agoraMonotonicoMs();

  // Grava ANTES de qualquer efeito. Se o processo morrer na proxima linha, o
  // retomador encontra `RECOGNIZED` e sabe que nada foi perguntado ainda.
  const tentativa = deps.maquina.registrarReconhecimento({
    correlationId,
    externalUserId: evento.externalEnrollId,
    deviceId: evento.deviceId,
    recognitionId: evento.recognitionId,
    recognizedAt: agora,
  });

  // Reentrada: o mesmo reconhecimento ja foi processado. Devolve o que houve
  // sem repetir efeito -- e o que torna seguro o leitor disparar em rajada.
  if (tentativa.estado !== ESTADO.RECOGNIZED) {
    return {
      correlationId: tentativa.correlationId,
      estado: tentativa.estado,
      outcome: tentativa.outcome ?? 'DENY',
      reason: tentativa.reason ?? 'REENTRADA',
      accessEventId: tentativa.accessEventId,
      latenciaDecisaoMs: 0,
    };
  }

  deps.maquina.transicionar(correlationId, ESTADO.DECISION_PENDING);

  const decisao = await pedirComTimeout(deps, evento, correlationId, agora);

  const latenciaDecisaoMs = deps.agoraMonotonicoMs() - inicio;

  // Nuvem muda, timeout ou erro. Ate a Slice 1.5, isto e DENY explicito.
  if (!decisao) {
    deps.maquina.transicionar(correlationId, ESTADO.DENIED, {
      outcome: 'DENY',
      reason: 'CLOUD_UNAVAILABLE',
    });

    return {
      correlationId,
      estado: ESTADO.DENIED,
      outcome: 'DENY',
      reason: 'CLOUD_UNAVAILABLE',
      accessEventId: null,
      latenciaDecisaoMs,
    };
  }

  if (decisao.outcome === 'DENY') {
    deps.maquina.transicionar(correlationId, ESTADO.DENIED, {
      accessEventId: decisao.accessEventId,
      outcome: 'DENY',
      reason: decisao.reason,
    });

    // `M1-AC-006` e `M0-AC-004`: negado nao aciona a catraca. O `return`
    // aqui e a garantia -- nao ha `liberar()` acima deste ponto.
    return {
      correlationId,
      estado: ESTADO.DENIED,
      outcome: 'DENY',
      reason: decisao.reason,
      accessEventId: decisao.accessEventId,
      latenciaDecisaoMs,
    };
  }

  deps.maquina.transicionar(correlationId, ESTADO.ALLOWED, {
    accessEventId: decisao.accessEventId,
    outcome: 'ALLOW',
    reason: decisao.reason,
  });

  // O `commandId` SAI DO `accessEventId`: um evento de acesso, um comando
  // fisico. Se o processo morrer e o retomador reprocessar, o `commandId` se
  // repete e o adapter reconhece que ja executou.
  const commandId = decisao.accessEventId;

  // COMMAND_PENDING gravado ANTES de girar. Este e o estado que responde
  // "eu ja mandei girar?" para o retomador -- e a diferenca entre a pessoa
  // passar uma vez ou a catraca girar sozinha depois do reinicio.
  deps.maquina.transicionar(correlationId, ESTADO.COMMAND_PENDING, { commandId });

  const resultado = await deps.catraca.liberar(commandId, timeoutPassagemMs);

  deps.maquina.transicionar(correlationId, ESTADO.COMMAND_SENT);

  const confirmou = resultado.desfecho === 'girou';

  deps.maquina.transicionar(
    correlationId,
    confirmou ? ESTADO.PASSAGE_CONFIRMED : ESTADO.PASSAGE_TIMED_OUT,
  );

  // Reportar e melhor-esforco: se falhar, a tentativa fica pendente e o
  // retomador reenvia. O que NAO se faz e desfazer o giro -- a pessoa ja
  // passou, e o mundo fisico nao tem rollback.
  await reportarComSeguranca(deps, correlationId, decisao.accessEventId, commandId, confirmou);

  return {
    correlationId,
    estado: confirmou ? ESTADO.PASSAGE_CONFIRMED : ESTADO.PASSAGE_TIMED_OUT,
    outcome: 'ALLOW',
    reason: decisao.reason,
    accessEventId: decisao.accessEventId,
    latenciaDecisaoMs,
    duracaoPassagemMs: resultado.duracaoMs,
  };
}

/**
 * Pergunta a nuvem, com teto de tempo.
 *
 * `idempotencyKey` e o `correlationId`: a MESMA tentativa reenviada devolve a
 * MESMA decisao, sem gerar segundo evento na nuvem (ADR-006).
 *
 * Erro e timeout viram `null`, nao excecao: do ponto de vista da catraca, os
 * dois significam a mesma coisa -- nao houve autorizacao. Deixar a excecao
 * subir faria o chamador ter de decidir o que fazer, e "decidir o que fazer
 * quando a nuvem some" e exatamente o tipo de escolha que nao pode ficar
 * espalhada.
 */
async function pedirComTimeout(
  deps: DepsAcessoOnline,
  evento: ReconhecimentoComOrigem,
  correlationId: string,
  agora: Date,
): Promise<RespostaDeDecisao | null> {
  try {
    const decisao = await Promise.race([
      deps.pedirDecisao({
        deviceId: evento.deviceId,
        externalUserId: evento.externalEnrollId,
        recognitionId: evento.recognitionId,
        recognizedAt: agora,
        idempotencyKey: correlationId,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), TIMEOUT_DECISAO_MS).unref?.();
      }),
    ]);

    return decisao;
  } catch {
    // Sem log do erro cru aqui: ele carrega URL e cabecalho assinado. Quem
    // registra e a camada de cliente, que sabe mascarar.
    return null;
  }
}

async function reportarComSeguranca(
  deps: DepsAcessoOnline,
  correlationId: string,
  accessEventId: string,
  commandId: string,
  confirmou: boolean,
): Promise<void> {
  deps.maquina.contarEnvio(correlationId);

  try {
    const ok = await deps.reportarPassagem(
      accessEventId,
      confirmou ? 'CONFIRMED' : 'TIMED_OUT',
      commandId,
      new Date(),
    );

    if (ok) deps.maquina.transicionar(correlationId, ESTADO.REPORTED);
  } catch {
    // Fica pendente de proposito. O retomador reenvia.
  }
}

/**
 * Cria o processador -- ESTE e o caminho de producao.
 *
 * Serializa por pessoa, como no MVP 0: o leitor dispara em rajada enquanto
 * alguem esta parado na frente dele, e sem a fila duas rajadas da mesma
 * pessoa viram duas decisoes e dois comandos.
 *
 * Pessoas diferentes continuam em paralelo.
 */
export function criarProcessadorDeAcessoOnline(
  deps: DepsAcessoOnline,
  timeoutPassagemMs: number = TIMEOUT_PASSAGEM_MS,
): (
  evento: ReconhecimentoComOrigem,
  correlationId: string,
  agora: Date,
) => Promise<ResultadoDeAcesso> {
  const fila = new FilaPorPessoa();

  return (evento, correlationId, agora) =>
    fila.executar(evento.externalEnrollId, () =>
      processarAcessoOnline(deps, evento, correlationId, agora, timeoutPassagemMs),
    );
}

/**
 * Retoma tentativas presas apos reinicio -- `M1-NFR-004`.
 *
 * A REGRA CENTRAL: **nunca recomanda a catraca**. Uma tentativa em
 * `COMMAND_PENDING` ou `COMMAND_SENT` ja pode ter girado o equipamento, e o
 * SDK Inner Acesso nao tem id de comando no protocolo para consultarmos.
 * Diante da duvida, a escolha e NAO girar: uma pessoa que passa a catraca de
 * novo e um incidente de acesso; uma pessoa que precisa se reapresentar ao
 * leitor e um incomodo.
 *
 * O que a retomada faz e fechar o ciclo de REGISTRO: reportar a nuvem o que
 * ja aconteceu fisicamente, para que o evento nao fique sem desfecho.
 */
export async function retomarPendentes(
  deps: DepsAcessoOnline,
  limite = 100,
): Promise<{ reportadas: number; abandonadas: number }> {
  const pendentes = deps.maquina.pendentes(limite);

  let reportadas = 0;
  let abandonadas = 0;

  for (const tentativa of pendentes) {
    // Ainda nem perguntou a nuvem: nao ha o que reportar, e refazer a
    // decisao aqui atropelaria a fila. A pessoa se reapresenta ao leitor.
    if (
      tentativa.estado === ESTADO.RECOGNIZED ||
      tentativa.estado === ESTADO.DECISION_PENDING
    ) {
      abandonadas += 1;
      continue;
    }

    if (!tentativa.accessEventId) {
      abandonadas += 1;
      continue;
    }

    // `COMMAND_PENDING` e o caso ambiguo: gravamos a intencao, e nao sabemos
    // se o comando saiu. Fecha-se como `TIMED_OUT` -- o desfecho honesto e
    // "nao confirmamos giro", nao "girou".
    const estadoFinal =
      tentativa.estado === ESTADO.PASSAGE_CONFIRMED ? 'CONFIRMED' : 'TIMED_OUT';

    if (tentativa.estado === ESTADO.COMMAND_PENDING) {
      deps.maquina.transicionar(tentativa.correlationId, ESTADO.COMMAND_SENT);
      deps.maquina.transicionar(tentativa.correlationId, ESTADO.PASSAGE_TIMED_OUT);
    } else if (tentativa.estado === ESTADO.COMMAND_SENT) {
      deps.maquina.transicionar(tentativa.correlationId, ESTADO.PASSAGE_TIMED_OUT);
    }

    deps.maquina.contarEnvio(tentativa.correlationId);

    try {
      const ok =
        tentativa.outcome === 'DENY'
          ? true
          : await deps.reportarPassagem(
              tentativa.accessEventId,
              estadoFinal,
              tentativa.commandId ?? tentativa.accessEventId,
              new Date(),
            );

      if (ok) {
        deps.maquina.transicionar(tentativa.correlationId, ESTADO.REPORTED);
        reportadas += 1;
      } else {
        abandonadas += 1;
      }
    } catch {
      abandonadas += 1;
    }
  }

  return { reportadas, abandonadas };
}
