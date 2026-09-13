import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { estaVisivel, rotaDoAviso, type AcaoDeAviso } from './domain/aviso-do-aluno.js';

export interface AvisoDoAluno {
  readonly id: string;
  readonly tipo: 'BILLING' | 'ASSESSMENT' | 'MEMBERSHIP' | 'GENERAL';
  readonly titulo: string;
  readonly corpo: string;
  /** Rota local, ja resolvida no servidor. `null` = aviso que so informa. */
  readonly rota: string | null;
  readonly lido: boolean;
  readonly criadoEm: string;
}

export interface RespostaDeAvisos {
  readonly asOf: string;
  readonly avisos: readonly AvisoDoAluno[];
  /** Nao lidos VISIVEIS -- o numero da bolinha. */
  readonly naoLidos: number;
}

/** Teto por pagina. Caixa nao e historico: quem quer tudo rola. */
const TAMANHO_DA_PAGINA = 50;

/**
 * A caixa de avisos do aluno -- F29, Slice 4.7.
 *
 * ---------------------------------------------------------------------------
 * A CAIXA E A ENTREGA. O PUSH E SO UM ATALHO ATE ELA.
 * ---------------------------------------------------------------------------
 *
 * Consequencia pratica: nada aqui consulta subscription de push, e o aluno
 * que recusou notificacao ve exatamente os mesmos avisos de quem aceitou.
 * O desenho inverso -- push como canal, banco como registro do que foi
 * enviado -- tornaria a fatura vencida invisivel justamente para quem recusou
 * notificacao, que costuma ser quem mais precisa ve-la.
 *
 * A ROTA E RESOLVIDA AQUI, a partir do codigo guardado no banco. O app recebe
 * caminho local pronto e nao interpreta nada: com URL no banco, quem
 * escrevesse uma linha escolheria para onde o aplicativo navega.
 */
@Injectable()
export class MobileAvisosService {
  constructor(private readonly db: PrismaService) {}

  /** Os avisos do aluno da SESSAO -- nunca de id vindo da URL. */
  async listar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDeAvisos> {
    const linhas = await this.db.studentNotification.findMany({
      where: {
        tenantId: ctx.tenantId,
        // O aluno sai do CONTEXTO. Com id na rota, qualquer sessao valida
        // leria a caixa de qualquer aluno do tenant.
        studentId: ctx.studentId,
        // Expirado some da TELA, nao do banco: a linha continua existindo
        // porque "o aluno foi avisado?" e a primeira pergunta quando ele
        // contesta uma cobranca.
        OR: [{ expiresAt: null }, { expiresAt: { gt: agora } }],
      },
      orderBy: { createdAt: 'desc' },
      take: TAMANHO_DA_PAGINA,
    });

    const avisos = linhas.map((linha) => this.montar(linha));

    return {
      asOf: agora.toISOString(),
      avisos,
      naoLidos: avisos.filter((aviso) => !aviso.lido).length,
    };
  }

  /**
   * Marca como lido. IDEMPOTENTE: marcar duas vezes nao move o instante.
   *
   * O `updateMany` com `tenantId`/`studentId` no `where` e o que faz a posse
   * ser conferida NO BANCO, em vez de um `findUnique` seguido de `if` -- que
   * teria janela entre a leitura e a escrita.
   */
  async marcarComoLido(
    ctx: StudentChannelContext,
    avisoId: string,
    agora: Date,
  ): Promise<AvisoDoAluno> {
    const alterados = await this.db.studentNotification.updateMany({
      where: {
        id: avisoId,
        tenantId: ctx.tenantId,
        studentId: ctx.studentId,
        // So a primeira marcacao escreve. Sem isto, reabrir o aviso moveria
        // `readAt` para agora e apagaria quando ele foi visto de fato.
        readAt: null,
      },
      data: { readAt: agora },
    });

    const linha = await this.db.studentNotification.findFirst({
      where: { id: avisoId, tenantId: ctx.tenantId, studentId: ctx.studentId },
    });

    // Aviso de outro aluno responde 404, nunca 403: dizer "existe, mas nao e
    // seu" confirma a existencia do recurso para quem esta sondando ids.
    if (linha === null) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        detail: 'aviso nao encontrado',
      });
    }

    // `alterados.count === 0` com a linha presente significa "ja estava
    // lido" -- resultado legitimo, nao erro.
    void alterados;

    return this.montar(linha);
  }

  private montar(linha: {
    id: string;
    kind: string;
    title: string;
    body: string;
    action: string;
    actionTargetId: string | null;
    readAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  }): AvisoDoAluno {
    return {
      id: linha.id,
      tipo: linha.kind as AvisoDoAluno['tipo'],
      titulo: linha.title,
      corpo: linha.body,
      rota: rotaDoAviso(linha.action as AcaoDeAviso, linha.actionTargetId),
      lido: linha.readAt !== null,
      criadoEm: linha.createdAt.toISOString(),
    };
  }

  /** Reexportado para o teste exercitar a visibilidade sem duplicar a regra. */
  static visivel = estaVisivel;
}
