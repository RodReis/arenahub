import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import { ImportService } from './import.service.js';
import type { AiAnalysisService } from './ai-analysis.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

/**
 * Publicacao automatica dispara a analise assistiva (ADR-039/ADR-040), mas o
 * consentimento do aluno continua sendo a fronteira (LGPD art. 11,
 * `M3-AC-007`): aluno sem aceite vigente, ou que recusou, NAO ganha analise
 * quando o laudo e publicado sozinho -- e isso nao pode derrubar o upload,
 * que ja gravou a medida com sucesso.
 *
 * Testa so o metodo privado `gerarAnaliseAutomatica`: as regras de quando o
 * aceite autoriza (`avaliarAceite`) e a montagem do snapshot ja tem
 * cobertura propria em `aceite-da-analise.spec.ts` e
 * `snapshot-de-analise.spec.ts`. O que este arquivo prova e a FRONTEIRA --
 * `ImportService` engolindo o erro em vez de deixa-lo subir.
 */
describe('ImportService -- analise automatica na publicacao (ADR-039/ADR-040)', () => {
  const contexto = { tenantId: 'tenant-1' } as TenantContext;
  const agora = new Date('2026-08-21T10:00:00.000Z');

  function construirServico(analiseDeIa: Partial<AiAnalysisService>): ImportService {
    // Os demais colaboradores nao sao exercitados por `gerarAnaliseAutomatica`
    // -- so `analiseDeIa.gerar` e chamado, entao ficam vazios de proposito.
    return new ImportService(
      {} as never,
      {} as never,
      {} as never,
      analiseDeIa as AiAnalysisService,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('nao propaga ForbiddenException quando o aluno nao tem consentimento vigente', async () => {
    const gerar = jest
      .fn<AiAnalysisService['gerar']>()
      .mockRejectedValue(new ForbiddenException({ code: 'AI_CONSENT_MISSING_STUDENT' }));
    const servico = construirServico({ gerar });

    // Metodo privado: acesso via cast e deliberado -- e a fronteira que este
    // teste existe para provar, e o publico `enviar()` exigiria mockar toda a
    // cadeia de upload (storage, antivirus, extrator) so para chegar aqui.
    await expect(
      (servico as unknown as { gerarAnaliseAutomatica: (...args: unknown[]) => Promise<void> })
        .gerarAnaliseAutomatica(contexto, 'aluno-sem-consentimento', 'avaliador-1', agora),
    ).resolves.toBeUndefined();

    expect(gerar).toHaveBeenCalledWith(contexto, 'aluno-sem-consentimento', 'avaliador-1', agora);
  });

  it('nao propaga ForbiddenException quando o aluno recusou o consentimento', async () => {
    const gerar = jest
      .fn<AiAnalysisService['gerar']>()
      .mockRejectedValue(new ForbiddenException({ code: 'AI_CONSENT_REFUSED_STUDENT' }));
    const servico = construirServico({ gerar });

    await expect(
      (servico as unknown as { gerarAnaliseAutomatica: (...args: unknown[]) => Promise<void> })
        .gerarAnaliseAutomatica(contexto, 'aluno-recusou', 'avaliador-1', agora),
    ).resolves.toBeUndefined();
  });

  it('nao propaga falha de provedor (M3-NFR-004) -- upload ja publicou a medida', async () => {
    const gerar = jest
      .fn<AiAnalysisService['gerar']>()
      .mockRejectedValue(new Error('provedor fora do ar'));
    const servico = construirServico({ gerar });

    await expect(
      (servico as unknown as { gerarAnaliseAutomatica: (...args: unknown[]) => Promise<void> })
        .gerarAnaliseAutomatica(contexto, 'aluno-1', 'avaliador-1', agora),
    ).resolves.toBeUndefined();
  });

  it('gera a analise normalmente quando o consentimento esta vigente', async () => {
    const gerar = jest.fn<AiAnalysisService['gerar']>().mockResolvedValue({
      id: 'analise-1',
      status: 'PUBLISHED',
      saida: null,
      motivoDaRecusa: null,
    });
    const servico = construirServico({ gerar });

    await (
      servico as unknown as { gerarAnaliseAutomatica: (...args: unknown[]) => Promise<void> }
    ).gerarAnaliseAutomatica(contexto, 'aluno-com-consentimento', 'avaliador-1', agora);

    expect(gerar).toHaveBeenCalledTimes(1);
  });
});
