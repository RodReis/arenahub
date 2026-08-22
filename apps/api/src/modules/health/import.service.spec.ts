import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import { ErroDeExtracao } from './provider/document-extractor.port.js';
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

/**
 * URL do arquivo original (ADR-041) -- a tela mostra a MINIATURA do laudo em
 * vez do nome do arquivo, e para isso precisa de uma URL que o navegador
 * consiga carregar.
 *
 * A URL e assinada e de vida CURTA (`createPrivateDownload`), nunca publica:
 * laudo de bioimpedancia e dado de saude, e um link permanente vira link
 * compartilhado por WhatsApp.
 *
 * O caso que este bloco existe para fixar e o `null`: apos a confirmacao o
 * arquivo e EXPURGADO (`apagarArquivosDaSessao`) e `objectKey` fica nulo.
 * A tela tem de saber a diferenca entre "ainda nao carregou" e "nao existe
 * mais" -- devolver uma URL quebrada faria a miniatura virar icone de imagem
 * partida, que nao explica nada a quem olha.
 */
describe('ImportService -- URL do arquivo original (ADR-041)', () => {
  const contexto = { tenantId: 'tenant-1' } as TenantContext;

  function construirServico(
    importacoes: Record<string, unknown>,
    storage: Record<string, unknown>,
  ): ImportService {
    return new ImportService(
      importacoes as never,
      {} as never,
      {} as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
    );
  }

  it('devolve URL assinada de vida curta enquanto o arquivo existe', async () => {
    const createPrivateDownload = jest.fn<() => Promise<{ downloadUrl: string; expiresAt: string }>>(
    ).mockResolvedValue({ downloadUrl: 'https://storage/assinada', expiresAt: '2026-08-21T10:05:00.000Z' });
    const servico = construirServico(
      {
        encontrar: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: 'import-1',
          objectKey: 'tenants/t1/health-imports/import-1/abc',
          originalFilename: 'balanca.png',
          fileType: 'image/png',
        }),
      },
      { createPrivateDownload },
    );

    const url = await servico.urlDoArquivo(contexto, 'import-1');

    expect(url).toEqual({ url: 'https://storage/assinada', contentType: 'image/png' });
  });

  it('devolve null quando o arquivo ja foi expurgado -- nao inventa link quebrado', async () => {
    const createPrivateDownload = jest.fn();
    const servico = construirServico(
      {
        encontrar: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: 'import-1',
          objectKey: null,
          originalFilename: 'balanca.png',
          fileType: 'image/png',
        }),
      },
      { createPrivateDownload },
    );

    await expect(servico.urlDoArquivo(contexto, 'import-1')).resolves.toBeNull();
    expect(createPrivateDownload).not.toHaveBeenCalled();
  });

  it('devolve null para importacao inexistente -- nunca vaza erro de storage', async () => {
    const servico = construirServico(
      { encontrar: jest.fn<() => Promise<unknown>>().mockResolvedValue(null) },
      { createPrivateDownload: jest.fn() },
    );

    await expect(servico.urlDoArquivo(contexto, 'nao-existe')).resolves.toBeNull();
  });
});

/**
 * O ULTIMO ARQUIVO DA SESSAO FALHOU -- os outros nao tem culpa.
 *
 * Achado na primeira medicao real com os tres laudos do PI: o ECG e um PDF
 * de tracado, sem texto extraivel. Como era o ultimo da sessao, o `catch`
 * de `enviar` retornava sem tentar publicar, e a balanca + analise --
 * extraidas com sucesso -- ficavam paradas em `EXTRACTED` para sempre.
 *
 * Testa a FRONTEIRA: o `catch` chama `publicarAutomaticamente` quando o
 * arquivo era o ultimo. Quem publica de fato ja tem cobertura propria.
 */
describe('ImportService -- ultimo arquivo da sessao falha na extracao', () => {
  const contexto = { tenantId: 'tenant-1' } as TenantContext;

  function construirServico(overrides: {
    publicar: jest.Mock;
    marcarFalha?: jest.Mock;
  }): ImportService {
    const servico = new ImportService(
      {
        criar: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'import-3' }),
        marcarFalha: overrides.marcarFalha ?? jest.fn<() => Promise<void>>(),
        // A sessao ja existe e pertence ao mesmo aluno -- o caminho normal
        // do 2o e 3o arquivo de uma medicao.
        encontrarSessao: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          studentId: 'aluno-1',
          importIds: ['import-1', 'import-2'],
        }),
      } as never,
      {} as never,
      { encontrar: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'aluno-1' }) } as never,
      {} as never,
      { putPrivateObject: jest.fn<() => Promise<void>>() } as never,
      { escanear: jest.fn<() => Promise<unknown>>().mockResolvedValue({ limpo: true }) } as never,
      {
        extrair: jest
          .fn<() => Promise<unknown>>()
          .mockRejectedValue(new ErroDeExtracao('EXTRACTOR_NO_CONTENT', false, 'ilegivel')),
      } as never,
    );

    // O metodo privado e a fronteira que este teste observa -- exercitar o
    // caminho inteiro exigiria montar antivirus, storage e extrator reais.
    (servico as unknown as Record<string, unknown>)['publicarAutomaticamente'] =
      overrides.publicar;

    return servico;
  }

  it('publica a sessao mesmo quando o ultimo arquivo e ilegivel', async () => {
    const publicar = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const servico = construirServico({ publicar });

    const resultado = await servico.enviar(
      contexto,
      'aluno-1',
      { originalFilename: 'ecg.pdf', contentType: 'application/pdf', conteudo: new Uint8Array([37, 80, 68, 70]) },
      'uploader-1',
      { reviewSessionId: '11111111-1111-4111-8111-111111111111', ultimoDaSessao: true },
      new Date('2026-08-21T10:00:00.000Z'),
    );

    expect(resultado.status).toBe('FAILED');
    expect(resultado.motivoDaFalha).toBe('EXTRACTOR_NO_CONTENT');
    // O que importa: a sessao NAO ficou presa por causa dele.
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  it('arquivo do MEIO que falha nao dispara publicacao -- ainda vem arquivo', async () => {
    const publicar = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const servico = construirServico({ publicar });

    await servico.enviar(
      contexto,
      'aluno-1',
      { originalFilename: 'x.pdf', contentType: 'application/pdf', conteudo: new Uint8Array([37, 80, 68, 70]) },
      'uploader-1',
      { reviewSessionId: '11111111-1111-4111-8111-111111111111', ultimoDaSessao: false },
      new Date('2026-08-21T10:00:00.000Z'),
    );

    expect(publicar).not.toHaveBeenCalled();
  });
});
