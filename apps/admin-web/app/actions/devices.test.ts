import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { cadastrarDispositivo } from './devices';

const UNIDADE = '11111111-1111-4111-8111-111111111111';

function formulario(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('gymUnitId', UNIDADE);
  dados.set('kind', 'FACIAL_READER');
  dados.set('model', 'Inner Fit');
  dados.set('serial', 'AYTI11108174');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function criado() {
  return { ok: true, dados: { id: 'dev-1', serial: 'AYTI11108174' }, cookiesDaApi: [] };
}

describe('cadastrarDispositivo', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('cadastra o dispositivo com os campos obrigatorios', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado());

    const estado = await cadastrarDispositivo({}, formulario());

    expect(estado.sucesso).toBeDefined();
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe('/api/v1/devices');
  });

  /**
   * FIRMWARE VAZIO TEM DE SUMIR DO CORPO.
   *
   * O schema da API e `.strict()` e declara `firmware` como
   * `.max(40).optional()` -- string vazia passaria como valor INFORMADO, e o
   * dispositivo nasceria com firmware `''` em vez de sem firmware. Campo
   * opcional em branco nao e "o valor e vazio", e sim "nao informado".
   */
  it('nao manda firmware no corpo quando o campo fica em branco', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado());

    await cadastrarDispositivo({}, formulario({ firmware: '' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('firmware');
  });

  it('manda o firmware quando informado', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado());

    await cadastrarDispositivo({}, formulario({ firmware: '1.4.2' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['firmware']).toBe('1.4.2');
  });

  /**
   * O ERRO MAIS PROVAVEL desta tela: so o Topdata Inner Fit e homologado
   * hoje. A frase precisa dizer o que fazer -- "nao foi possivel cadastrar"
   * mandaria a recepcao conferir serie e modelo atras de um erro de
   * digitacao que nao existe.
   */
  it('traduz hardware nao homologado em frase acionavel', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Hardware nao homologado',
        status: 400,
        code: 'DEVICE_UNSUPPORTED_HARDWARE',
        correlationId: 'teste',
      },
      cookiesDaApi: [],
    });

    const estado = await cadastrarDispositivo({}, formulario({ model: 'Catraca XPTO' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.erro).toContain('não é homologado');
    // O preenchimento volta: a recepcao nao redigita a serie por causa disso.
    expect(estado.valores?.['serial']).toBe('AYTI11108174');
  });

  it('preserva o preenchimento quando a validacao local falha', async () => {
    const estado = await cadastrarDispositivo({}, formulario({ serial: '' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.valores?.['model']).toBe('Inner Fit');
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });
  /**
   * A CATRACA entrou na homologacao em 24/08/2026 (decisao do PI, com o
   * inventario do painel fisico em `field-notes/2026-08-15`). O par que
   * viaja e `TURNSTILE` + `Inner` -- trocar o `kind` descreveria um
   * equipamento que nao existe, e a API recusaria.
   */
  it('manda o par TURNSTILE + Inner ao cadastrar a catraca', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado());

    await cadastrarDispositivo({}, formulario({ kind: 'TURNSTILE', model: 'Inner', serial: '247000797' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['kind']).toBe('TURNSTILE');
    expect(corpo['model']).toBe('Inner');
  });
});
