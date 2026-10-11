import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { CabecalhoDaAcademiaService } from './cabecalho-da-academia.service.js';
import {
  ConsultarRelatorioDeAlunosUseCase,
  type PaginaDoRelatorio,
} from './consultar-relatorio-de-alunos.use-case.js';
import { montarCsvDoRelatorio } from './domain/csv-do-relatorio.js';
import type { DadosDoRelatorioImpresso } from './domain/dados-do-relatorio.js';
import { descreverFiltro, lerFiltro } from './domain/filtro-do-relatorio-de-alunos.js';
import { dataParaNomeDeArquivo } from './domain/formato-brasileiro.js';
import { gerarPdfDoRelatorio } from './domain/pdf-do-relatorio.js';

const POR_PAGINA_PADRAO = 20;

type Consulta = Record<string, unknown>;

/**
 * Relatórios -- F90. Hoje só "Alunos"; a pasta existe para os próximos.
 *
 * O TENANT vem da sessão (`TenantContextService`), nunca de parâmetro: um
 * `?tenantId=` na URL é ignorado porque nenhum código o lê.
 */
@Controller('api/v1/reports/students')
export class ReportsController {
  constructor(
    private readonly consulta: ConsultarRelatorioDeAlunosUseCase,
    private readonly cabecalho: CabecalhoDaAcademiaService,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['total', 'linhas', 'proximoCursor'],
      properties: {
        total: { type: 'integer' },
        proximoCursor: { type: 'string', nullable: true },
        linhas: {
          type: 'array',
          items: {
            type: 'object',
            required: ['studentId', 'deviceIds', 'fullName', 'cpf', 'phone', 'planLabel'],
            properties: {
              studentId: { type: 'string' },
              deviceIds: { type: 'array', items: { type: 'string' } },
              fullName: { type: 'string' },
              cpf: { type: 'string', nullable: true },
              phone: { type: 'string', nullable: true },
              planLabel: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  async listar(@Query() query: Consulta): Promise<PaginaDoRelatorio> {
    const limite = z.coerce.number().int().safeParse(query['limit']);
    const cursor = z.string().uuid().safeParse(query['cursor']);

    return this.consulta.pagina(
      this.contexto.require(),
      lerFiltro(query),
      {
        limite: limite.success ? limite.data : POR_PAGINA_PADRAO,
        cursor: cursor.success ? cursor.data : undefined,
      },
      new Date(),
    );
  }

  @Get('export')
  @RequirePermissions('student.read')
  @ApiOkResponse({
    description: 'O arquivo do relatório, em PDF ou CSV conforme `format`.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async exportar(@Query() query: Consulta, @Res() resposta: Response): Promise<void> {
    const formato = z.enum(['pdf', 'csv']).safeParse(query['format']);

    if (!formato.success) {
      throw new ErroDeDominio('REPORT_FORMAT_INVALID', 400, 'Escolha o formato: pdf ou csv.');
    }

    const contexto = this.contexto.require();
    const filtro = lerFiltro(query);
    const agora = new Date();

    const [{ total, linhas }, academia, nomes] = await Promise.all([
      this.consulta.todos(contexto, filtro, agora),
      this.cabecalho.carregar(contexto, filtro.gymUnitId),
      this.cabecalho.nomesDoFiltro(contexto, filtro),
    ]);

    const dados: DadosDoRelatorioImpresso = {
      academia,
      filtros: descreverFiltro(filtro, nomes),
      geradoEm: agora,
      total,
      linhas,
    };

    const nome = `relatorio-alunos-${dataParaNomeDeArquivo(agora, academia.fuso)}.${formato.data}`;
    const arquivo =
      formato.data === 'pdf'
        ? { corpo: await gerarPdfDoRelatorio(dados), tipo: 'application/pdf' }
        : { corpo: montarCsvDoRelatorio(dados), tipo: 'text/csv; charset=utf-8' };

    resposta
      .status(200)
      .setHeader('Content-Type', arquivo.tipo)
      .setHeader('Content-Disposition', `attachment; filename="${nome}"`)
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Cache-Control', 'no-store')
      .send(arquivo.corpo);
  }
}
