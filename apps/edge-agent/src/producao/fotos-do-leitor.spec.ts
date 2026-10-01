import { describe, expect, it, jest } from '@jest/globals';
import pino from 'pino';

import type { SignedCloudClient } from '../cloud/signed-client.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import { ligarImportacaoDeFotos } from './fotos-do-leitor.js';

/**
 * #503 -- a foto de cadastro do leitor vira a foto do aluno no ArenaHub.
 *
 * A nuvem diz QUEM precisa (numero vinculado, aluno sem foto); o Edge le uma
 * foto por vez e envia. Nada de foto no log.
 */

const FOTO = '/9j/4AAQSkZJRgABAQAAAQABAAD-FOTO-NAO-VAI-AO-LOG';

function montar(opcoes: {
  pendentes?: string[];
  fotos?: Record<string, string | null | Error>;
  respostaDoEnvio?: (numero: string) => { ok: boolean; status: number; body: unknown };
  pendentesOk?: boolean;
}) {
  const lerFoto = jest.fn((numero: string): Promise<string | null> => {
    const foto = opcoes.fotos && numero in opcoes.fotos ? (opcoes.fotos[numero] ?? null) : FOTO;

    return foto instanceof Error ? Promise.reject(foto) : Promise.resolve(foto);
  });

  const facial = { nome: 'facial-falso', lerFoto } as unknown as FacialDeviceAdapter;

  const post = jest.fn((caminho: string, corpo: Record<string, unknown>) => {
    if (caminho.endsWith('/photos/pending')) {
      return Promise.resolve(
        opcoes.pendentesOk === false
          ? { ok: false, status: 0, body: null }
          : { ok: true, status: 200, body: { externalUserIds: opcoes.pendentes ?? [] } },
      );
    }

    const numero = String(corpo['externalUserId']);

    return Promise.resolve(
      opcoes.respostaDoEnvio?.(numero) ?? { ok: true, status: 200, body: { result: 'IMPORTED' } },
    );
  });

  const cliente = { post } as unknown as SignedCloudClient;

  const linhas: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (l: string) => linhas.push(JSON.parse(l) as Record<string, unknown>) },
  );

  const ligado = ligarImportacaoDeFotos({ facial, cliente, logger, pausaMs: 0 });

  const resumo = (): Record<string, unknown> | undefined =>
    linhas.find((l) => l['msg'] === 'fotos do leitor importadas');

  return { lerFoto, post, linhas, ligado, resumo };
}

async function ate(condicao: () => boolean, tetoMs = 2_000): Promise<void> {
  const limite = Date.now() + tetoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('condicao nao ocorreu a tempo');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('ligarImportacaoDeFotos', () => {
  it('pede os pendentes, le cada foto no leitor e envia uma por vez', async () => {
    const { ligado, lerFoto, post, resumo } = montar({ pendentes: ['1491', '2002'] });

    ligado.importar('AYTI11108174');
    await ate(() => resumo() !== undefined);

    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/edge/device-users/photos/pending', {
      deviceSerial: 'AYTI11108174',
    });
    expect(lerFoto.mock.calls.map((c) => c[0])).toEqual(['1491', '2002']);
    expect(post).toHaveBeenCalledWith('/api/v1/edge/device-users/photos', {
      deviceSerial: 'AYTI11108174',
      externalUserId: '1491',
      imageBase64: FOTO,
    });
    expect(resumo()).toMatchObject({ pendentes: 2, importadas: 2, semFotoNoLeitor: 0, falhas: 0 });
  });

  it('pula quem nao tem foto no leitor, sem chamar a nuvem para ele', async () => {
    const { ligado, post, resumo } = montar({ pendentes: ['1491'], fotos: { '1491': null } });

    ligado.importar('AYTI11108174');
    await ate(() => resumo() !== undefined);

    expect(post).toHaveBeenCalledTimes(1);
    expect(resumo()).toMatchObject({ importadas: 0, semFotoNoLeitor: 1 });
  });

  it('nunca escreve a foto no log', async () => {
    const { ligado, linhas, resumo } = montar({ pendentes: ['1491'] });

    ligado.importar('AYTI11108174');
    await ate(() => resumo() !== undefined);

    expect(JSON.stringify(linhas)).not.toContain('FOTO-NAO-VAI-AO-LOG');
  });

  it('roda uma vez por leitor quando tudo deu certo', async () => {
    const { ligado, post, resumo, linhas } = montar({ pendentes: ['1491'] });

    ligado.importar('AYTI11108174');
    await ate(() => resumo() !== undefined);
    ligado.importar('AYTI11108174');
    await new Promise((r) => setTimeout(r, 30));

    expect(post.mock.calls.filter((c) => c[0].endsWith('/pending'))).toHaveLength(1);
    expect(linhas.filter((l) => l['msg'] === 'fotos do leitor importadas')).toHaveLength(1);
  });

  it('tenta de novo no proximo registro quando a lista de pendentes nao chegou', async () => {
    const { ligado, post, linhas } = montar({ pendentesOk: false });

    ligado.importar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'fotos do leitor: pendentes nao chegaram'));
    ligado.importar('AYTI11108174');
    await ate(() => post.mock.calls.length === 2);
  });

  it('conta falha de envio e libera nova tentativa', async () => {
    const { ligado, resumo, post } = montar({
      pendentes: ['1491', '2002'],
      respostaDoEnvio: (n) =>
        n === '1491'
          ? { ok: false, status: 400, body: null }
          : { ok: true, status: 200, body: { result: 'ALREADY_HAS_PHOTO' } },
    });

    ligado.importar('AYTI11108174');
    await ate(() => resumo() !== undefined);

    expect(resumo()).toMatchObject({ importadas: 0, jaTinhamFoto: 1, falhas: 1 });

    ligado.importar('AYTI11108174');
    await ate(() => post.mock.calls.filter((c) => c[0].endsWith('/pending')).length === 2);
  });

  it('interrompe depois de tres falhas seguidas no leitor -- leitor caiu', async () => {
    const erro = new Error('leitor facial nao esta conectado');
    const { ligado, lerFoto, linhas } = montar({
      pendentes: ['1', '2', '3', '4', '5'],
      fotos: { '1': erro, '2': erro, '3': erro, '4': erro, '5': erro },
    });

    ligado.importar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'fotos do leitor importadas'));

    expect(lerFoto).toHaveBeenCalledTimes(3);
    expect(linhas.find((l) => l['msg'] === 'fotos do leitor importadas')).toMatchObject({
      interrompida: true,
    });
  });

  it('nao faz nada com leitor que nao sabe ler foto', () => {
    const post = jest.fn();
    const ligado = ligarImportacaoDeFotos({
      facial: { nome: 'simulador' } as unknown as FacialDeviceAdapter,
      cliente: { post } as unknown as SignedCloudClient,
      logger: pino({ level: 'silent' }),
      pausaMs: 0,
    });

    ligado.importar('SIM-1');

    expect(post).not.toHaveBeenCalled();
  });
});
