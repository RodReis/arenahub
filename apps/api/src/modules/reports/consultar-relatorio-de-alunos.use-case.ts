import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type {
  FiltroDoRelatorioDeAlunos,
  LinhaDoRelatorioDeAlunos,
} from './domain/filtro-do-relatorio-de-alunos.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

/**
 * Teto de linhas de UMA exportação. Existe porque o arquivo é montado em
 * memória: sem teto, uma base grande vira o processo da API sem memória num
 * download. 20.000 é ~10x a maior academia atendida hoje (~2.000 alunos).
 *
 * GATILHO DE REVISÃO: se alguém bater nesse erro com filtro razoável, o
 * caminho é exportação assíncrona por job (como `access-events/exports`), não
 * subir o número.
 */
export const TETO_DE_LINHAS_DA_EXPORTACAO = 20_000;

/** Máximo de uma página da TELA. Mesmo teto de `GET /students`. */
export const LIMITE_MAXIMO_DA_PAGINA = 100;

export interface PaginaDoRelatorio {
  readonly total: number;
  readonly linhas: readonly LinhaDoRelatorioDeAlunos[];
  /** `studentId` da última linha, ou `null` quando não há próxima página. */
  readonly proximoCursor: string | null;
}

/**
 * A consulta do Relatório de Alunos -- UMA, para a tela e para a exportação.
 *
 * O arquivo que a pessoa baixa é, por construção, o que ela viu na tela: as
 * duas rotas chamam o mesmo repositório com o mesmo filtro, e só a janela
 * (página x tudo) muda.
 */
@Injectable()
export class ConsultarRelatorioDeAlunosUseCase {
  constructor(private readonly repositorio: RelatorioDeAlunosRepository) {}

  async pagina(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    janela: { limite: number; cursor?: string | undefined },
    agora: Date,
  ): Promise<PaginaDoRelatorio> {
    const limite = Math.min(Math.max(janela.limite, 1), LIMITE_MAXIMO_DA_PAGINA);

    const [total, lidas] = await Promise.all([
      this.repositorio.contar(contexto, filtro, agora),
      // limite+1: a linha a mais só diz que HÁ próxima página; não é devolvida.
      this.repositorio.listar(contexto, filtro, agora, { limite: limite + 1, cursor: janela.cursor }),
    ]);

    const linhas = lidas.slice(0, limite);
    const ultima = linhas[linhas.length - 1];

    return {
      total,
      linhas,
      proximoCursor: lidas.length > limite && ultima ? ultima.studentId : null,
    };
  }

  async todos(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    agora: Date,
  ): Promise<{ total: number; linhas: readonly LinhaDoRelatorioDeAlunos[] }> {
    const total = await this.repositorio.contar(contexto, filtro, agora);

    if (total > TETO_DE_LINHAS_DA_EXPORTACAO) {
      throw new ErroDeDominio(
        'REPORT_TOO_LARGE',
        422,
        `O relatório tem ${total} alunos e o limite de exportação é ${TETO_DE_LINHAS_DA_EXPORTACAO}. Refine os filtros.`,
      );
    }

    if (total === 0) return { total: 0, linhas: [] };

    const linhas = await this.repositorio.listar(contexto, filtro, agora, { limite: total });

    return { total, linhas };
  }
}
