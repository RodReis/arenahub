import { Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import type { SaidaDaAnalise } from './domain/saida-da-analise.js';

/**
 * Analise assistiva por IA (F21, Slice 3.5).
 *
 * Rotas conforme o PRD (`MVP-03` secao 11):
 *
 *     POST /api/v1/students/:id/ai-analyses
 *     GET  /api/v1/students/:id/ai-analyses/latest
 *
 * A rota de leitura e a que TOTEM e APP consomem. Ela devolve apenas analise
 * PUBLICADA -- o filtro mora no repositorio, nao aqui: deixar para o
 * consumidor significaria que basta uma tela esquecer para o texto recusado
 * pela regra no 8 aparecer.
 */

interface AnaliseDto {
  id: string;
  status: string;
  /** Nulo quando rejeitada ou falha -- saida recusada nao vira conteudo. */
  analysis: SaidaDaAnalise | null;
  rejectionReason: string | null;
}

interface UltimaAnaliseDto {
  id: string;
  studentId: string;
  generatedAt: string;
  analysis: SaidaDaAnalise;
}

@Controller('api/v1')
export class AiAnalysisController {
  constructor(
    private readonly analises: AiAnalysisService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Gera a analise (`M3-FR-015`).
   *
   * `health.assess` e nao `health.read`: pedir a analise e o ato do
   * PROFISSIONAL que endossa (F21), nao consulta de quem passa pela recepcao.
   * Quem tem `health.read` le o resultado; quem tem `health.assess` o produz.
   *
   * Sem o aceite duplo responde 403 com o motivo -- `AI_CONSENT_MISSING_STUDENT`,
   * `AI_CONSENT_MISSING_PROFESSIONAL`, `AI_CONSENT_REFUSED_STUDENT`... A tela
   * usa o codigo para dizer QUAL assinatura falta, em vez de um "proibido"
   * que nao ajuda ninguem no balcao.
   */
  @Post('students/:id/ai-analyses')
  @RequirePermissions('health.assess')
  async gerar(@Param('id') studentId: string, @Req() req: Request): Promise<AnaliseDto> {
    const contexto = this.contexto.require();
    const solicitante = contexto.actorId;

    if (!solicitante) {
      // O endosso profissional precisa de dono. Sem ator identificado nao ha
      // quem responda por ter pedido a analise daquele aluno.
      throw new NotFoundException({ code: 'ACTOR_REQUIRED' });
    }

    const resultado = await this.analises.gerar(contexto, studentId, solicitante, new Date());

    void req;

    return {
      id: resultado.id,
      status: resultado.status,
      analysis: resultado.saida,
      rejectionReason: resultado.motivoDaRecusa,
    };
  }

  /** A ultima analise publicada -- consumida por totem e app. */
  @Get('students/:id/ai-analyses/latest')
  @RequirePermissions('health.read')
  async ultima(@Param('id') studentId: string): Promise<UltimaAnaliseDto> {
    const ultima = await this.analises.ultimaPublicada(this.contexto.require(), studentId);

    if (ultima === null) {
      // 404 e nao objeto vazio: "nunca houve analise" e um estado que a tela
      // trata de forma diferente de "analise sem conteudo".
      throw new NotFoundException({ code: 'AI_ANALYSIS_NOT_FOUND' });
    }

    return {
      id: ultima.id,
      studentId,
      generatedAt: ultima.geradaEm.toISOString(),
      analysis: ultima.saida,
    };
  }
}
