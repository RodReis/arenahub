import type { SignedCloudClient } from './signed-client.js';
import {
  executarLote,
  type ComandoDaNuvem,
  type DependenciasDoWorker,
  type ResultadoDeComando,
} from '../application/device-sync-worker.js';

/**
 * Busca comandos na nuvem, executa e reporta.
 *
 * PULL, e nao push: o PC da academia esta atras de NAT e nao recebe conexao
 * de fora. O WebSocket, quando existir, so avisa que ha trabalho -- a busca
 * continua sendo daqui, e perder a notificacao nao perde comando.
 */

export interface EstadoDoPoller {
  /** Maior sequencia ja vista. Ponto de retomada apos reinicio. */
  ultimaSequencia: bigint;
}

export interface ResultadoDoCiclo {
  buscados: number;
  executados: number;
  reportados: number;
  /** Codigo estavel quando o ciclo nao completou. */
  erro: string | null;
}

interface RespostaDeComandos {
  commands: ComandoDaNuvem[];
}

/**
 * Um ciclo: buscar -> arrendar -> executar -> reportar.
 *
 * O LEASE VEM ANTES DA EXECUCAO. Sem ele, duas instancias do agente (o
 * servico e alguem rodando `pnpm dev` para depurar) executariam o mesmo
 * comando no mesmo leitor.
 *
 * Comando que o lease recusa e PULADO em silencio: outro processo pegou, e
 * insistir seria justamente a execucao dupla que o lease evita.
 */
export async function rodarCiclo(
  deps: {
    cliente: SignedCloudClient;
    worker: DependenciasDoWorker;
    estado: EstadoDoPoller;
  },
  agora: Date,
): Promise<ResultadoDoCiclo> {
  const busca = await deps.cliente.get<RespostaDeComandos>(
    `/api/v1/edge/commands?after=${deps.estado.ultimaSequencia}&limit=50`,
  );

  if (!busca.ok || !busca.body) {
    return { buscados: 0, executados: 0, reportados: 0, erro: busca.errorCode };
  }

  const comandos = busca.body.commands;

  if (comandos.length === 0) {
    return { buscados: 0, executados: 0, reportados: 0, erro: null };
  }

  const arrendados: ComandoDaNuvem[] = [];

  for (const comando of comandos) {
    const lease = await deps.cliente.post<{ leased: boolean }>(
      `/api/v1/edge/commands/${comando.id}/lease`,
    );

    if (lease.ok && lease.body?.leased) arrendados.push(comando);
  }

  if (arrendados.length === 0) {
    return { buscados: comandos.length, executados: 0, reportados: 0, erro: null };
  }

  const resultados = await executarLote(deps.worker, arrendados, agora);

  const envio = await deps.cliente.post<{ accepted: number }>(
    '/api/v1/edge/sync-results/batch',
    { results: resultados as unknown as Record<string, unknown>[] },
  );

  // Avanca a sequencia SO depois de reportar com sucesso. Avancar antes
  // perderia comando se o envio falhasse: o proximo ciclo pediria a partir
  // de uma sequencia que nunca foi confirmada.
  //
  // O efeito fisico ja aconteceu de qualquer forma; o que se protege aqui e
  // o RELATO. Reexecutar e seguro (o inbox local barra), relato perdido nao.
  if (envio.ok) {
    const maior = arrendados.reduce(
      (maximo, comando) => (BigInt(comando.sequence) > maximo ? BigInt(comando.sequence) : maximo),
      deps.estado.ultimaSequencia,
    );

    deps.estado.ultimaSequencia = maior;
  }

  return {
    buscados: comandos.length,
    executados: resultados.length,
    reportados: envio.ok ? resultados.length : 0,
    erro: envio.ok ? null : envio.errorCode,
  };
}

/**
 * Laco continuo de sincronizacao.
 *
 * Erro de rede NAO derruba o laco: a academia fica sem internet, o Edge
 * continua abrindo a catraca com o que ja sabe, e a sincronizacao retoma
 * quando a rede volta. Derrubar o processo aqui transformaria queda de link
 * em catraca parada.
 *
 * Devolve uma funcao que encerra o laco -- encerramento gracioso e requisito
 * do `M0-NFR-007`.
 */
export function iniciarPoller(
  deps: {
    cliente: SignedCloudClient;
    worker: DependenciasDoWorker;
    estado: EstadoDoPoller;
    intervaloMs: number;
    aoCiclo?: (resultado: ResultadoDoCiclo) => void;
  },
): () => void {
  let ativo = true;
  let temporizador: NodeJS.Timeout | undefined;

  const agendar = (): void => {
    if (!ativo) return;

    temporizador = setTimeout(() => {
      void (async () => {
        try {
          const resultado = await rodarCiclo(deps, new Date());

          deps.aoCiclo?.(resultado);
        } catch {
          // Nem uma excecao inesperada para o laco: a proxima volta tenta de
          // novo.
        } finally {
          agendar();
        }
      })();
    }, deps.intervaloMs);

    // `unref`: um temporizador pendente nao segura o processo vivo no
    // encerramento.
    temporizador.unref?.();
  };

  agendar();

  return () => {
    ativo = false;
    if (temporizador) clearTimeout(temporizador);
  };
}

export type { ResultadoDeComando };
