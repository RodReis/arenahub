import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  analisarPorIntencaoDeTratar,
  type ResultadoDoExperimento,
} from './domain/analise-itt.js';
import { sortearGrupo, type GrupoDoExperimento } from './domain/randomizacao.js';
import {
  PORTA_DE_EXPERIMENTOS,
  type PortaDeExperimentos,
} from './retention-experiments.repository.js';

export interface ResumoDaAlocacao {
  readonly alocados: number;
  /** Já estavam no experimento — reprocessar é seguro (`M6-FR-012`). */
  readonly jaAlocados: number;
}

/**
 * O experimento operacional (F39, Slice 6.4).
 *
 * ---------------------------------------------------------------------------
 * ALOCA COM HASH, LÊ DO BANCO
 * ---------------------------------------------------------------------------
 *
 * A assimetria é deliberada. Na ALOCAÇÃO o grupo é calculado — hash de
 * `(semente, aluno)`, verificável por qualquer pessoa que recalcule. Na
 * LEITURA o grupo vem gravado.
 *
 * Recalcular também na leitura pareceria mais simples e seria pior: uma
 * correção de semente (mesmo legítima, mesmo em `DRAFT`) moveria alunos de
 * grupo **retroativamente**, e as tarefas já criadas passariam a pertencer a um
 * braço que a pessoa nunca esteve. O trigger do banco impede a correção depois
 * de `RUNNING`, mas a leitura não deve depender disso para estar certa.
 *
 * A gravação prova QUANDO o aluno entrou; o hash prova que o grupo dele não foi
 * escolhido a dedo. As duas coisas juntas são o que o aceite da Slice 6.4 pede.
 *
 * ---------------------------------------------------------------------------
 * SEM EXPERIMENTO ATIVO, TUDO SEGUE COMO ANTES
 * ---------------------------------------------------------------------------
 *
 * `grupoDoAluno` devolve `null` quando não há experimento, e a fila da F38 lê
 * isso como "sem restrição" — todo mundo elegível entra. O experimento é uma
 * camada opcional sobre o CRM, não um pré-requisito dele: sem ele o produto
 * funciona, com ele a operação passa a saber se funciona.
 */
@Injectable()
export class RetentionExperimentsService {
  constructor(
    @Inject(PORTA_DE_EXPERIMENTOS) private readonly porta: PortaDeExperimentos,
  ) {}

  /**
   * Aloca alunos no experimento ativo.
   *
   * `agora` entra por parâmetro e é gravado explícito: a janela de medição
   * conta a partir da alocação, POR ALUNO, e misturar o relógio da aplicação
   * com o do banco foi o defeito que a F38 achou por canário.
   */
  async alocar(
    contexto: TenantContext,
    studentIds: readonly string[],
    agora: Date,
  ): Promise<ResumoDaAlocacao> {
    const experimento = await this.porta.experimentoAtivo(contexto);

    if (experimento === null) {
      return { alocados: 0, jaAlocados: 0 };
    }

    let alocados = 0;
    let jaAlocados = 0;

    for (const studentId of studentIds) {
      const grupo = sortearGrupo(
        experimento.semente,
        studentId,
        experimento.fracaoDeControle,
      );

      const { criada } = await this.porta.gravarAlocacao(contexto, {
        experimentoId: experimento.id,
        studentId,
        grupo,
        alocadoEm: agora,
      });

      if (criada) {
        alocados += 1;
      } else {
        jaAlocados += 1;
      }
    }

    return { alocados, jaAlocados };
  }

  /**
   * O grupo do aluno no experimento ativo, ou `null` se não participa.
   *
   * A fila da F38 chama isto antes de criar tarefa: `CONTROLE` nunca vira
   * tarefa, e é justamente essa ausência que torna a comparação possível.
   */
  async grupoDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<GrupoDoExperimento | null> {
    const experimento = await this.porta.experimentoAtivo(contexto);

    if (experimento === null) {
      return null;
    }

    const alocacoes = await this.porta.alocacoesDoExperimento(contexto, experimento.id);

    return alocacoes.find((a) => a.studentId === studentId)?.grupo ?? null;
  }

  /** O relatório por intenção de tratar, ou `null` sem experimento ativo. */
  async analisar(contexto: TenantContext): Promise<ResultadoDoExperimento | null> {
    const experimento = await this.porta.experimentoAtivo(contexto);

    if (experimento === null) {
      return null;
    }

    const participantes = await this.porta.participantesParaAnalise(
      contexto,
      experimento.id,
    );

    return analisarPorIntencaoDeTratar(participantes);
  }
}
