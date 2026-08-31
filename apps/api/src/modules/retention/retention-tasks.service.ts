import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { selecionarFila, venceEm } from './domain/selecao-de-fila.js';
import {
  estaAtiva,
  transitar,
  type ComandoDeTarefa,
  type ResultadoDeTarefa,
} from './domain/tarefa-de-retencao.js';
import {
  PORTA_DE_TAREFAS,
  type CanalDeContato,
  type CandidatoDoDia,
  type PortaDeTarefas,
} from './retention-tasks.repository.js';

/** O que uma rodada de geração de fila fez. */
export interface ResumoDaFila {
  readonly criadas: number;
  /** Cooldown, tarefa ativa, estouro de capacidade ou chave única. */
  readonly suprimidas: number;
}

export interface ContatoParaRegistrar {
  readonly canal: CanalDeContato;
  readonly resultado: ResultadoDeTarefa;
  readonly observacoes?: string | undefined;
  readonly proximoPasso?: string | undefined;
}

/** A tarefa referida não existe neste tenant. */
export class TarefaNaoEncontradaError extends Error {
  constructor(id: string) {
    super(`TAREFA_NAO_ENCONTRADA: ${id}`);
    this.name = 'TarefaNaoEncontradaError';
  }
}

/** Interação em tarefa já terminal. */
export class TarefaNaoEstaAtivaError extends Error {
  constructor(id: string, estado: string) {
    super(`TAREFA_NAO_ESTA_ATIVA: ${id} esta em ${estado}`);
    this.name = 'TarefaNaoEstaAtivaError';
  }
}

/**
 * A fila de tarefas de retencao (F38, Slice 6.3).
 *
 * ---------------------------------------------------------------------------
 * CAPACIDADE E POR UNIDADE, E SEM POLITICA NAO HA FILA
 * ---------------------------------------------------------------------------
 *
 * Candidato de unidade sem politica configurada e IGNORADO, nao pontuado com um
 * padrao mudo. O padrao silencioso pareceria funcionar -- a fila apareceria com
 * 20 tarefas --, e ninguem descobriria que a unidade nova nunca foi
 * configurada. Ignorar deixa a fila vazia, que e visivel e leva alguem a
 * perguntar por que.
 *
 * ---------------------------------------------------------------------------
 * REGISTRAR CONTATO NAO CONCLUI A TAREFA
 * ---------------------------------------------------------------------------
 *
 * Sao dois atos distintos, e colapsa-los perderia o caso mais comum: ligar tres
 * vezes ate a pessoa atender sao TRES interacoes e UMA tarefa. Se a primeira
 * tentativa sem resposta fechasse a tarefa, a fila mostraria "tratado" para
 * quem ninguem falou -- e o histórico de tentativa, que distingue "ninguem
 * tentou" de "tentou tres vezes", sumiria.
 */
@Injectable()
export class RetentionTasksService {
  constructor(@Inject(PORTA_DE_TAREFAS) private readonly porta: PortaDeTarefas) {}

  /**
   * Gera a fila do dia, unidade por unidade.
   *
   * O "agora" entra por parametro: reprocessar um dia passado tem de dar a
   * mesma fila (`M6-AC-004`), e funcao de calculo nao le relogio.
   */
  async gerarFila(contexto: TenantContext, agora: Date): Promise<ResumoDaFila> {
    const politicas = await this.porta.politicasDoTenant(contexto);
    const candidatos = await this.porta.candidatosDoDia(contexto, agora);

    const porUnidade = new Map(politicas.map((politica) => [politica.gymUnitId, politica]));

    let criadas = 0;
    let suprimidas = 0;

    // Agrupa por unidade: a capacidade e de cada recepcao, e um corte global
    // deixaria a unidade grande consumir a vaga da pequena.
    const agrupados = new Map<string, CandidatoDoDia[]>();
    for (const candidato of candidatos) {
      const lista = agrupados.get(candidato.gymUnitId);
      if (lista === undefined) {
        agrupados.set(candidato.gymUnitId, [candidato]);
      } else {
        lista.push(candidato);
      }
    }

    for (const [gymUnitId, doGrupo] of agrupados) {
      const politica = porUnidade.get(gymUnitId);

      if (politica === undefined) {
        // Unidade sem politica: nao inventa padrao. Ver o cabecalho.
        suprimidas += doGrupo.length;
        continue;
      }

      const escolhidos = selecionarFila(doGrupo, {
        capacidade: politica.capacidadeDiaria,
        cooldownEmDias: politica.cooldownEmDias,
        agora,
      });

      const escolhidosPorScore = new Set(escolhidos.map((escolhido) => escolhido.scoreId));
      suprimidas += doGrupo.length - escolhidos.length;

      for (const candidato of doGrupo) {
        if (!escolhidosPorScore.has(candidato.scoreId)) {
          continue;
        }

        const { criada } = await this.porta.criarTarefa(contexto, {
          studentId: candidato.studentId,
          gymUnitId: candidato.gymUnitId,
          scoreId: candidato.scoreId,
          estrategia: candidato.estrategia,
          venceEm: venceEm(agora, politica.slaEmDiasUteis),
          criadaEm: agora,
        });

        // `criada: false` = a chave única encontrou o que já existia. É a
        // idempotência de `M6-AC-004`, e conta como supressão, não como falha:
        // reprocessar o dia é seguro por construção.
        if (criada) {
          criadas += 1;
        } else {
          suprimidas += 1;
        }
      }
    }

    return { criadas, suprimidas };
  }

  /** Aplica uma transição de estado, validada pela máquina de estados. */
  async aplicar(
    contexto: TenantContext,
    taskId: string,
    comando: ComandoDeTarefa,
  ): Promise<void> {
    const tarefa = await this.porta.carregarTarefa(contexto, taskId);

    if (tarefa === null) {
      throw new TarefaNaoEncontradaError(taskId);
    }

    // `transitar` lança em transição inválida -- e lançar ANTES de gravar é o
    // que garante que a recusa não deixe rastro parcial no banco.
    await this.porta.salvarTarefa(contexto, taskId, transitar(tarefa, comando));
  }

  /**
   * Registra uma tentativa de contato (`M6-FR-010`).
   *
   * O responsável sai do `TenantContext`, nunca do corpo da requisição: quem
   * registra é quem está autenticado, e aceitar o id pelo body permitiria
   * atribuir a ligação a outra pessoa.
   */
  async registrarContato(
    contexto: TenantContext,
    taskId: string,
    contato: ContatoParaRegistrar,
  ): Promise<void> {
    const tarefa = await this.porta.carregarTarefa(contexto, taskId);

    if (tarefa === null) {
      throw new TarefaNaoEncontradaError(taskId);
    }
    if (!estaAtiva(tarefa.estado)) {
      throw new TarefaNaoEstaAtivaError(taskId, tarefa.estado);
    }

    await this.porta.registrarInteracao(contexto, {
      taskId,
      actorId: contexto.actorId,
      canal: contato.canal,
      resultado: contato.resultado,
      observacoes: contato.observacoes ?? null,
      proximoPasso: contato.proximoPasso ?? null,
    });
  }
}
