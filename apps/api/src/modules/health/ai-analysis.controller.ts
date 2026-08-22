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
   * `health.assess` e nao `health.read`: quem tem `health.read` LE o
   * resultado; quem tem `health.assess` o PRODUZ -- e produzir envia dado de
   * saude a um provedor externo, o que a recepcao nao faz.
   *
   * O endosso do profissional saiu do ACEITE com o ADR-040 (a analise nao
   * espera ninguem endossar), mas isso nao afrouxou quem pode DISPARAR o
   * envio: sao coisas diferentes, e confundi-las daria a quem atende o
   * balcao o poder de mandar saude de aluno para fora.
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

  /**
   * Por que NAO ha analise -- consumido pela tela de avaliacao.
   *
   * Rota separada de `latest` de proposito: `latest` responde 404 quando
   * nao ha analise, e 404 nao carrega motivo. Espremer o motivo dentro dele
   * exigiria trocar o 404 por um 200 com corpo vazio, e ai todo consumidor
   * (totem, app) passaria a tratar "nao existe" como "existe e esta vazio".
   *
   * Devolve so o veredito do aceite -- NUNCA a assinatura, a data ou o
   * documento: quem opera a recepcao precisa saber que FALTA consentimento,
   * nao o conteudo dele.
   */
  @Get('students/:id/ai-analyses/consent')
  @RequirePermissions('health.read')
  async aceite(
    @Param('id') studentId: string,
  ): Promise<{ autorizado: boolean; motivo: string | null }> {
    return this.analises.estadoDoAceite(this.contexto.require(), studentId, new Date());
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
