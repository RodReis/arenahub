import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type { DirecaoDeRegra } from './domain/regra-de-retencao.js';
import { validadeDoScore, type Validade } from './domain/validade-do-score.js';

export const PORTA_DE_CONSULTA_DE_SCORES = Symbol('PortaDeConsultaDeScores');

export interface FatorGravado {
  readonly posicao: number;
  readonly feature: string;
  readonly valorObservado: number;
  readonly contribuicao: number;
  readonly direcao: DirecaoDeRegra;
  readonly rotulo: string;
}

export interface ScoreGravado {
  readonly scoreId: string;
  readonly studentId: string;
  readonly valor: number;
  readonly faixa: FaixaDeRisco;
  readonly completude: number;
  readonly probabilidadeCalibrada: number | null;
  readonly versaoDeRegras: string;
  readonly observadoEm: Date;
  readonly calculadoEm: Date;
  readonly fatores: readonly FatorGravado[];
}

export interface PortaDeConsultaDeScores {
  filaDeRisco(contexto: TenantContext, limite: number): Promise<ScoreGravado[]>;
  historicoDoAluno(
    contexto: TenantContext,
    studentId: string,
    limite: number,
  ): Promise<ScoreGravado[]>;
}

/**
 * O aviso que acompanha TODO score na tela.
 *
 * `M6-BR-001`: "score e recomendacao operacional, nao fato sobre o aluno".
 * Codigo estavel em vez de frase: a traducao muda, o contrato nao, e o mesmo
 * codigo serve painel, app e relatorio sem tres redacoes divergentes.
 */
export const AVISO_DE_ESTIMATIVA = 'ESTIMATIVA_NAO_E_FATO';

export interface ScoreParaLeitura extends ScoreGravado {
  readonly validade: Validade;
  readonly aviso: typeof AVISO_DE_ESTIMATIVA;
}

export interface OpcoesDeLeitura {
  /** O "agora" entra por parametro -- funcao que le relogio envelhece o teste. */
  readonly agora: Date;
  readonly limite: number;
}

/**
 * Leitura da fila de risco e do historico de um aluno (F37, Slice 6.2).
 *
 * ---------------------------------------------------------------------------
 * A IDADE VIAJA JUNTO DO NUMERO
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-009` proibe as duas saidas faceis: sumir com o score quando o pipeline
 * falha (a recepcao fica sem trabalho por causa de um job) e mostra-lo como se
 * fosse de hoje (alguem liga para quem voltou a treinar ontem). Aqui todo score
 * sai com `validade` -- estado e idade em dias --, e a tela decide o que fazer
 * com isso sem precisar recalcular nada.
 *
 * O aviso de estimativa tambem viaja junto, e nao fica a cargo da tela: uma
 * superficie que esquecesse de desenha-lo transformaria recomendacao em
 * veredito sobre a pessoa.
 */
@Injectable()
export class RetentionScoresQueryService {
  constructor(
    @Inject(PORTA_DE_CONSULTA_DE_SCORES) private readonly porta: PortaDeConsultaDeScores,
  ) {}

  async fila(contexto: TenantContext, opcoes: OpcoesDeLeitura): Promise<ScoreParaLeitura[]> {
    const scores = await this.porta.filaDeRisco(contexto, opcoes.limite);
    return scores.map((score) => this.comValidade(score, opcoes.agora));
  }

  async historico(
    contexto: TenantContext,
    studentId: string,
    opcoes: OpcoesDeLeitura,
  ): Promise<ScoreParaLeitura[]> {
    const scores = await this.porta.historicoDoAluno(contexto, studentId, opcoes.limite);
    return scores.map((score) => this.comValidade(score, opcoes.agora));
  }

  private comValidade(score: ScoreGravado, agora: Date): ScoreParaLeitura {
    return {
      ...score,
      validade: validadeDoScore(score.calculadoEm, agora),
      aviso: AVISO_DE_ESTIMATIVA,
    };
  }
}
