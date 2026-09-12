import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';

/**
 * Politica de versao minima -- `M4-NFR-008`.
 *
 * `GRACE` existe para a atualizacao nao ser um paredao: o aluno que abre o app
 * na catraca precisa entrar AGORA, e obriga-lo a baixar 40 MB na porta da
 * academia e pior do que deixa-lo passar com a versao de ontem.
 */
export type EstadoDaVersao = 'SUPPORTED' | 'GRACE' | 'BLOCKED';

export interface RespostaDaHome {
  /** Quando o servidor respondeu. O app mostra "atualizado as HH:MM". */
  readonly asOf: string;
  /**
   * `UNAVAILABLE` quando o BFF nao conseguiu montar o conteudo.
   *
   * O app mostra o SHELL e diz que nao conseguiu atualizar -- nunca o dado
   * anterior como se fosse atual (`M4-NFR-002`). A tela vazia incomoda; a
   * tela que PARECE certa e errada engana.
   */
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly saudacao: string;
  readonly versionPolicy: {
    readonly state: EstadoDaVersao;
    readonly updateUrl: string | null;
  };
}

@Injectable()
export class MobileHomeService {
  constructor(private readonly db: PrismaService) {}

  async montar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDaHome> {
    const aluno = await this.db.student.findUnique({
      where: { id: ctx.studentId },
      select: { fullName: true },
    });

    if (!aluno) {
      // Sessao valida apontando para aluno que sumiu (arquivado, apagado):
      // shell sem conteudo, e nao um nome em branco que pareceria dado real.
      return {
        asOf: agora.toISOString(),
        status: 'UNAVAILABLE',
        saudacao: '',
        versionPolicy: { state: 'SUPPORTED', updateUrl: null },
      };
    }

    return {
      asOf: agora.toISOString(),
      status: 'AVAILABLE',
      saudacao: `${this.periodoDoDia(agora)}, ${this.primeiroNome(aluno.fullName)}`,
      versionPolicy: { state: 'SUPPORTED', updateUrl: null },
    };
  }

  /**
   * So o PRIMEIRO nome na saudacao.
   *
   * Nao e estetica: a Home e a tela que fica aberta na mao do aluno dentro da
   * academia, a vista de quem estiver ao lado. Nome completo ali e PII
   * exposta a terceiro sem necessidade -- "Boa tarde, Ana" cumpre o mesmo
   * papel.
   */
  private primeiroNome(nomeCompleto: string): string {
    return nomeCompleto.trim().split(/\s+/)[0] ?? '';
  }

  /**
   * Periodo pelo fuso de Sao Paulo, nao pelo do servidor.
   *
   * "Bom dia" as 23h porque o servidor esta em UTC e o aluno em Brasilia e o
   * tipo de erro que faz o app parecer quebrado sem nada estar.
   */
  private periodoDoDia(agora: Date): string {
    const hora = Number(
      new Intl.DateTimeFormat('pt-BR', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/Sao_Paulo',
      }).format(agora),
    );

    if (hora < 12) return 'Bom dia';
    if (hora < 18) return 'Boa tarde';

    return 'Boa noite';
  }
}
