import { describe, expect, it, jest } from '@jest/globals';
import pino from 'pino';

import type { SignedCloudClient } from '../cloud/signed-client.js';
import type { FacialDeviceAdapter, IdentidadeNoDispositivo } from '../domain/facial-device.js';
import {
  ligarVinculoLegado,
  MAXIMO_DE_FALHAS_SEGUIDAS,
  MAXIMO_DE_NOMES,
  TAMANHO_DO_LOTE,
} from './vinculo-legado.js';

/**
 * #468 -- a base do leitor vai para a nuvem vincular os alunos legados.
 *
 * O leitor da Arena Positiva so reenviou `senduser` na PRIMEIRA conexao (424)
 * e nenhum depois: o que ja foi confirmado nao volta. Por isso a base sai de
 * uma LISTAGEM no registro, e o `senduser` cobre so o cadastro novo feito
 * direto no leitor.
 */

const RESPOSTA = {
  refusedOrRevoked: [],
  linked: 1,
  alreadyLinked: 0,
  withoutStudent: [],
  ambiguous: [],
  studentAlreadyLinked: [],
  withoutConsentDocument: [],
};

function montar(
  base: readonly string[] = [],
  janelaMs = 20,
  extra: {
    intervaloEntreTentativasMs?: number;
    agoraMs?: () => number;
    aposVincular?: (serial: string) => void;
    /** Presente = o adapter sabe ler o nome que o leitor guarda do numero. */
    lerNome?: (numero: string) => Promise<string | null>;
  } = {},
) {
  const { lerNome, ...opcoes } = extra;
  let aoRegistrar: ((serial: string) => void) | undefined;
  let aoInformar: ((c: { serial: string; externalUserId: string }) => void) | undefined;

  const listar = jest.fn(
    (): Promise<IdentidadeNoDispositivo[]> =>
      Promise.resolve(base.map((externalEnrollId) => ({ externalEnrollId, rotulo: '' }))),
  );

  const facial = {
    nome: 'facial-falso',
    listar,
    ...(lerNome ? { lerNome } : {}),
    aoRegistrar: (o: (serial: string) => void) => {
      aoRegistrar = o;
    },
    aoInformarCadastro: (o: (c: { serial: string; externalUserId: string }) => void) => {
      aoInformar = o;
    },
  } as unknown as FacialDeviceAdapter;

  const post = jest.fn(() => Promise.resolve({ ok: true, status: 201, body: RESPOSTA, errorCode: null }));
  const cliente = { post, get: jest.fn() } as unknown as SignedCloudClient;

  const linhas: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'info' },
    { write: (l: string) => linhas.push(JSON.parse(l) as Record<string, unknown>) },
  );

  // Intervalo zero por padrao: os testes de nova tentativa registram o leitor
  // em seguida, e o intervalo minimo de producao (60 s) os bloquearia.
  const ligado = ligarVinculoLegado({
    facial,
    cliente,
    logger,
    janelaMs,
    intervaloEntreTentativasMs: 0,
    ...opcoes,
  });

  return {
    listar,
    post,
    linhas,
    ligado,
    registrar: (serial: string) => aoRegistrar?.(serial),
    informar: (serial: string, externalUserId: string) => aoInformar?.({ serial, externalUserId }),
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera ATE a condicao valer, com teto. Janela fixa de 20 ms passava no
 * Windows e estourava no CI, com todos os pacotes testando em paralelo e a
 * CPU disputada.
 */
async function ate(condicao: () => boolean, tetoMs = 2_000): Promise<void> {
  const limite = Date.now() + tetoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('condicao nao ocorreu a tempo');
    await esperar(5);
  }
}

describe('ligarVinculoLegado', () => {
  it('no registro, lista a base do leitor e manda os numeros com o serial', async () => {
    const { post, registrar, ligado } = montar(['1491', '2002']);

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length > 0);

    expect(post).toHaveBeenCalledWith('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: 'AYTI11108174',
      externalUserIds: ['1491', '2002'],
    });

    ligado.encerrar();
  });

  it('fatia base maior que o teto da API', async () => {
    const base = Array.from({ length: TAMANHO_DO_LOTE + 5 }, (_, i) => String(i + 1));
    const { post, registrar, ligado } = montar(base);

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 2);

    expect(post).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  it('junta a rajada de senduser numa chamada so', async () => {
    const { post, informar, ligado } = montar();

    informar('AYTI11108174', '10');
    informar('AYTI11108174', '11');
    informar('AYTI11108174', '10');
    await ate(() => post.mock.calls.length > 0);
    // Folga para um eventual segundo envio indevido aparecer.
    await esperar(60);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: 'AYTI11108174',
      externalUserIds: ['10', '11'],
    });

    ligado.encerrar();
  });

  it('registra em log o resultado do vinculo, com os pendentes', async () => {
    const { linhas, registrar, ligado } = montar(['1491']);

    registrar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'base do leitor vinculada'));

    expect(linhas).toContainEqual(
      expect.objectContaining({
        msg: 'base do leitor vinculada',
        leitor: 'AYTI11108174',
        prontosNaCatraca: 1,
        novos: 1,
      }),
    );

    ligado.encerrar();
  });

  /*
   * Arena Positiva, 01/10/2026: com lote de 50, a base virava nove linhas
   * longas no log. Uma linha so, com os totais de todos os lotes.
   */
  it('soma os lotes numa linha so de resultado', async () => {
    const base = Array.from({ length: TAMANHO_DO_LOTE + 5 }, (_, i) => String(i + 1));
    const { linhas, registrar, ligado } = montar(base);

    registrar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'base do leitor vinculada'));

    const resultados = linhas.filter((l) => l['msg'] === 'base do leitor vinculada');
    expect(resultados).toHaveLength(1);
    // A resposta falsa diz `linked: 1` por chamada: duas chamadas, dois.
    expect(resultados[0]).toMatchObject({ numeros: TAMANHO_DO_LOTE + 5, prontosNaCatraca: 2 });

    ligado.encerrar();
  });

  it('lista a base UMA vez por leitor -- listar pausa o leitor', async () => {
    // `listar` manda `disabledevice`: a cada reconexao, o leitor ficaria
    // segundos sem reconhecer ninguem. A base nao muda por reconectar.
    const { listar, post, registrar, ligado } = montar(['1491']);

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length > 0);
    registrar('AYTI11108174');
    await esperar(60);

    expect(listar).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  /*
   * #488 -- Arena Positiva, 01/10/2026. A nuvem respondeu 404 (leitor sem
   * Edge) e a base ficou marcada como feita: o vinculo so seria tentado de
   * novo no proximo reinicio do agente. Falha nao pode contar como feito.
   */
  it('se a nuvem recusar o vinculo, tenta de novo no proximo registro do leitor (#488)', async () => {
    const { listar, post, registrar, ligado } = montar(['1491']);
    // O mock nasce tipado pela resposta de sucesso; a falha tem corpo nulo.
    (post as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 404, body: null, errorCode: 'DEVICE_NOT_IN_SCOPE' }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    // Deixa a falha ser processada antes do leitor se registrar de novo.
    await esperar(30);
    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 2);

    expect(listar).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  /** #503 -- as fotos so sao pedidas DEPOIS que o vinculo chegou na nuvem. */
  it('avisa quem importa as fotos depois que a base chegou na nuvem (#503)', async () => {
    const aposVincular = jest.fn();
    const { post, registrar, ligado } = montar(['1491'], 20, { aposVincular });

    registrar('AYTI11108174');
    await ate(() => aposVincular.mock.calls.length === 1);

    expect(aposVincular).toHaveBeenCalledWith('AYTI11108174');
    expect(post).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  it('nao pede fotos quando o vinculo nao chegou na nuvem (#503)', async () => {
    const aposVincular = jest.fn();
    const { post, registrar, ligado } = montar(['1491'], 20, { aposVincular });
    (post as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 0, body: null, errorCode: null }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    await esperar(30);

    expect(aposVincular).not.toHaveBeenCalled();

    ligado.encerrar();
  });

  it('se listar a base falhar, tenta de novo no proximo registro do leitor (#488)', async () => {
    const { listar, post, registrar, ligado } = montar(['1491']);
    listar.mockImplementationOnce(() => Promise.reject(new Error('sem resposta')));

    registrar('AYTI11108174');
    await ate(() => listar.mock.calls.length >= 1);
    await esperar(30);
    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);

    expect(listar).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  /*
   * Revisao do #488: falha PERSISTENTE (leitor nao cadastrado no painel, por
   * exemplo) nao pode virar laco -- cada tentativa faz `listar`, que pausa o
   * leitor (`disabledevice`), e o leitor reconecta sozinho.
   */
  it('falha persistente nao refaz a listagem antes do intervalo minimo, e volta a tentar depois (#488)', async () => {
    let agora = 1_000_000;
    const { listar, post, registrar, ligado } = montar(['1491'], 20, {
      intervaloEntreTentativasMs: 60_000,
      agoraMs: () => agora,
    });
    (post as jest.Mock).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 404, body: null, errorCode: 'DEVICE_NOT_IN_SCOPE' }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    await esperar(30);

    // O leitor reconecta 10 s depois: dentro do intervalo, nao lista de novo.
    agora += 10_000;
    registrar('AYTI11108174');
    await esperar(60);
    expect(listar).toHaveBeenCalledTimes(1);

    // Passado o intervalo, tenta de novo.
    agora += 61_000;
    registrar('AYTI11108174');
    await ate(() => listar.mock.calls.length >= 2);

    ligado.encerrar();
  });

  it('manda um lote por vez -- chamadas simultaneas disputariam o mesmo vinculo', async () => {
    const { post, registrar, informar, ligado } = montar(['1491']);
    let emVoo = 0;
    let maximo = 0;
    post.mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await esperar(30);
      emVoo -= 1;
      return { ok: true, status: 201, body: RESPOSTA, errorCode: null };
    });

    registrar('AYTI11108174');
    informar('AYTI11108174', '1491');
    await ate(() => post.mock.calls.length >= 2 && emVoo === 0);

    expect(post).toHaveBeenCalledTimes(2);
    expect(maximo).toBe(1);

    ligado.encerrar();
  });

  it('manda o lote de senduser assim que enche, sem esperar a janela', async () => {
    // Janela de 10 s: se o envio esperasse a janela, o teste estouraria o teto.
    const { post, informar, ligado } = montar([], 10_000);

    for (let i = 0; i < TAMANHO_DO_LOTE; i += 1) informar('AYTI11108174', String(i));
    await ate(() => post.mock.calls.length > 0);

    expect(post).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  /*
   * Spec 2026-10-03: o numero sem aluno chega ao painel com o nome que o
   * leitor guarda dele, para a recepcao reconhecer o cadastro.
   */
  describe('nome do leitor para numeros sem aluno', () => {
    const CAMINHO_NOMES = '/api/v1/edge/device-users/reader-names';

    /** legacy-links responde `withoutStudent`; reader-names responde `updated`. */
    function responderComSemAluno(post: jest.Mock, semAluno: string[]) {
      post.mockImplementation((caminho: unknown, corpo: unknown) => {
        if (caminho === CAMINHO_NOMES) {
          return Promise.resolve({ ok: true, status: 200, body: { updated: 1 }, errorCode: null });
        }
        // Como a API: so devolve, do lote enviado, os numeros sem aluno.
        const lote = (corpo as { externalUserIds: string[] }).externalUserIds;
        const withoutStudent = lote.filter((n) => semAluno.includes(n));
        return Promise.resolve({ ok: true, status: 201, body: { ...RESPOSTA, withoutStudent }, errorCode: null });
      });
    }

    const lotesDe99 = (post: jest.Mock) =>
      post.mock.calls.filter(
        (c) => (c[1] as { externalUserIds?: string[] } | undefined)?.externalUserIds?.[0] === '99',
      );

    const chamadasDeNomes = (post: jest.Mock) =>
      post.mock.calls.filter((c) => c[0] === CAMINHO_NOMES);

    it('depois da listagem, manda o nome dos numeros sem aluno', async () => {
      const lerNome = jest.fn((n: string) => Promise.resolve(n === '1' ? 'ANA' : null));
      const { post, registrar, ligado } = montar(['1', '2'], 20, { lerNome });
      responderComSemAluno(post, ['1', '2']);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0);

      expect(chamadasDeNomes(post)).toEqual([
        [CAMINHO_NOMES, { deviceSerial: 'SER', names: [{ externalUserId: '1', name: 'ANA' }] }],
      ]);
      // So os numeros sem aluno sao lidos no leitor.
      expect(lerNome).toHaveBeenCalledTimes(2);

      ligado.encerrar();
    });

    it('nao le nome de numero que tem aluno', async () => {
      const lerNome = jest.fn(() => Promise.resolve('ANA'));
      const { post, registrar, ligado } = montar(['1', '2'], 20, { lerNome });
      responderComSemAluno(post, ['2']);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0);

      expect(lerNome).toHaveBeenCalledTimes(1);
      expect(lerNome).toHaveBeenCalledWith('2');

      ligado.encerrar();
    });

    it('sem nome nenhum lido, nao chama reader-names', async () => {
      const lerNome = jest.fn(() => Promise.resolve(null));
      const aposVincular = jest.fn();
      const { post, registrar, ligado } = montar(['1'], 20, { lerNome, aposVincular });
      responderComSemAluno(post, ['1']);

      registrar('SER');
      await ate(() => lerNome.mock.calls.length === 1);
      await esperar(40);

      expect(chamadasDeNomes(post)).toHaveLength(0);

      ligado.encerrar();
    });

    it('adapter sem lerNome: nao chama reader-names', async () => {
      const aposVincular = jest.fn();
      const { post, registrar, ligado } = montar(['1', '2'], 20, { aposVincular });
      responderComSemAluno(post, ['1', '2']);

      registrar('SER');
      await ate(() => aposVincular.mock.calls.length === 1);
      await esperar(40);

      expect(chamadasDeNomes(post)).toHaveLength(0);

      ligado.encerrar();
    });

    it('lerNome que falha e pulado, sem derrubar o envio dos outros', async () => {
      const lerNome = jest.fn((n: string) =>
        n === '1' ? Promise.reject(new Error('leitor sem resposta')) : Promise.resolve('BIA'),
      );
      const { post, registrar, ligado } = montar(['1', '2'], 20, { lerNome });
      responderComSemAluno(post, ['1', '2']);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0);

      expect(chamadasDeNomes(post)[0]![1]).toEqual({
        deviceSerial: 'SER',
        names: [{ externalUserId: '2', name: 'BIA' }],
      });

      ligado.encerrar();
    });

    it('aborta apos 3 leituras seguidas sem nome e nao chama reader-names', async () => {
      const base = Array.from({ length: 10 }, (_, i) => String(i + 1));
      const lerNome = jest.fn(() => Promise.resolve(null));
      const { post, linhas, registrar, ligado } = montar(base, 20, { lerNome });
      responderComSemAluno(post, base);

      registrar('SER');
      await ate(() => linhas.some((l) => l['abortou'] === true));
      await esperar(40);

      expect(lerNome).toHaveBeenCalledTimes(MAXIMO_DE_FALHAS_SEGUIDAS);
      expect(chamadasDeNomes(post)).toHaveLength(0);
      expect(linhas).toContainEqual(
        expect.objectContaining({ lidos: 3, coletados: 0, abortou: true }),
      );

      ligado.encerrar();
    });

    it('duas falhas seguidas e depois um nome: continua lendo e envia o nome', async () => {
      const respostas: (string | null)[] = [null, null, 'ANA'];
      const lerNome = jest.fn(() => Promise.resolve(respostas.shift() ?? null));
      const { post, registrar, ligado } = montar(['1', '2', '3'], 20, { lerNome });
      responderComSemAluno(post, ['1', '2', '3']);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0);

      expect(lerNome).toHaveBeenCalledTimes(3);
      expect(chamadasDeNomes(post)[0]![1]).toEqual({
        deviceSerial: 'SER',
        names: [{ externalUserId: '3', name: 'ANA' }],
      });

      ligado.encerrar();
    });

    it('3 falhas seguidas depois de 2 nomes: aborta e envia os 2 coletados, sem nomes no log', async () => {
      const respostas: (string | null)[] = ['ANA', 'BIA', null, null, null];
      const base = ['1', '2', '3', '4', '5', '6', '7'];
      const lerNome = jest.fn(() => Promise.resolve(respostas.length > 0 ? respostas.shift()! : 'NUNCA-LIDO'));
      const { post, linhas, registrar, ligado } = montar(base, 20, { lerNome });
      responderComSemAluno(post, base);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0);

      expect(lerNome).toHaveBeenCalledTimes(5);
      expect(chamadasDeNomes(post)[0]![1]).toEqual({
        deviceSerial: 'SER',
        names: [
          { externalUserId: '1', name: 'ANA' },
          { externalUserId: '2', name: 'BIA' },
        ],
      });
      expect(linhas).toContainEqual(
        expect.objectContaining({ lidos: 5, coletados: 2, abortou: true }),
      );
      expect(JSON.stringify(linhas)).not.toMatch(/ANA|BIA/);

      ligado.encerrar();
    });

    it('leitor pendurado na leitura de nome nao trava o vinculo do senduser', async () => {
      let soltar: (nome: string | null) => void = () => undefined;
      const lerNome = jest.fn(() => new Promise<string | null>((r) => (soltar = r)));
      const { post, registrar, informar, ligado } = montar(['1'], 20, { lerNome });
      responderComSemAluno(post, ['1']);

      registrar('SER');
      await ate(() => lerNome.mock.calls.length === 1);
      // A leitura de nome segue pendente; um cadastro novo no leitor chega.
      informar('SER', '99');
      await ate(() => lotesDe99(post).length > 0);

      expect(chamadasDeNomes(post)).toHaveLength(0);

      soltar(null);
      ligado.encerrar();
    });

    it('encerrar interrompe a leitura de nomes entre uma leitura e outra', async () => {
      const base = ['1', '2', '3'];
      let soltar: (nome: string | null) => void = () => undefined;
      const lerNome = jest.fn(() => new Promise<string | null>((r) => (soltar = r)));
      const { post, registrar, ligado } = montar(base, 20, { lerNome });
      responderComSemAluno(post, base);

      registrar('SER');
      await ate(() => lerNome.mock.calls.length === 1);
      ligado.encerrar();
      soltar('ANA');
      await esperar(40);

      expect(lerNome).toHaveBeenCalledTimes(1);
      expect(chamadasDeNomes(post)).toHaveLength(0);
    });

    it('limita as leituras ao teto por base', async () => {
      const base = Array.from({ length: MAXIMO_DE_NOMES + 3 }, (_, i) => String(i + 1));
      const lerNome = jest.fn(() => Promise.resolve('X'));
      const { post, registrar, ligado } = montar(base, 20, { lerNome });
      responderComSemAluno(post, base);

      registrar('SER');
      await ate(() => chamadasDeNomes(post).length > 0, 10_000);

      expect(lerNome).toHaveBeenCalledTimes(MAXIMO_DE_NOMES);

      ligado.encerrar();
    });

    it('falha do envio de nomes nao reabre a listagem nem impede o vinculo', async () => {
      const lerNome = jest.fn(() => Promise.resolve('ANA'));
      const aposVincular = jest.fn();
      const { listar, post, linhas, registrar, ligado } = montar(['1'], 20, { lerNome, aposVincular });
      (post as jest.Mock).mockImplementation((caminho: unknown) =>
        Promise.resolve(
          caminho === CAMINHO_NOMES
            ? { ok: false, status: 500, body: null, errorCode: null }
            : { ok: true, status: 201, body: { ...RESPOSTA, withoutStudent: ['1'] }, errorCode: null },
        ),
      );

      registrar('SER');
      await ate(() => linhas.some((l) => l['msg'] === 'nomes do leitor nao chegaram na nuvem'));
      // Registrar de novo NAO lista de novo: `listados` continua marcado.
      registrar('SER');
      await esperar(40);

      expect(listar).toHaveBeenCalledTimes(1);
      expect(aposVincular).toHaveBeenCalledTimes(1);

      ligado.encerrar();
    });

    it('rede caindo no envio de nomes tambem nao reabre a listagem', async () => {
      const lerNome = jest.fn(() => Promise.resolve('ANA'));
      const aposVincular = jest.fn();
      const { listar, post, linhas, registrar, ligado } = montar(['1'], 20, { lerNome, aposVincular });
      (post as jest.Mock).mockImplementation((caminho: unknown) =>
        caminho === CAMINHO_NOMES
          ? Promise.reject(new Error('socket hang up'))
          : Promise.resolve({ ok: true, status: 201, body: { ...RESPOSTA, withoutStudent: ['1'] }, errorCode: null }),
      );

      registrar('SER');
      await ate(() => linhas.some((l) => l['msg'] === 'nomes do leitor nao foram enviados'));
      registrar('SER');
      await esperar(40);

      expect(listar).toHaveBeenCalledTimes(1);
      expect(aposVincular).toHaveBeenCalledTimes(1);

      ligado.encerrar();
    });

    it('o nome da pessoa nunca aparece no log', async () => {
      const lerNome = jest.fn(() => Promise.resolve('MARIA SEGREDO DA SILVA'));
      const { post, linhas, registrar, ligado } = montar(['1'], 20, { lerNome });
      responderComSemAluno(post, ['1']);

      registrar('SER');
      await ate(() => linhas.some((l) => l['msg'] === 'nomes do leitor enviados'));

      expect(linhas).toContainEqual(
        expect.objectContaining({ msg: 'nomes do leitor enviados', nomes: 1, gravados: 1 }),
      );
      expect(JSON.stringify(linhas)).not.toContain('SEGREDO');

      ligado.encerrar();
    });

    it('o senduser nao dispara leitura de nome', async () => {
      const lerNome = jest.fn(() => Promise.resolve('ANA'));
      const { post, informar, ligado } = montar([], 20, { lerNome });
      responderComSemAluno(post, ['10']);

      informar('SER', '10');
      await ate(() => post.mock.calls.length > 0);
      await esperar(40);

      expect(lerNome).not.toHaveBeenCalled();
      expect(chamadasDeNomes(post)).toHaveLength(0);

      ligado.encerrar();
    });
  });

  it('falha ao listar vira aviso, nao derruba o agente', async () => {
    const { listar, linhas, registrar, ligado } = montar();
    listar.mockImplementation(() => Promise.reject(new Error('sem resposta')));

    registrar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'nao foi possivel listar a base do leitor'));

    expect(linhas).toContainEqual(
      expect.objectContaining({ msg: 'nao foi possivel listar a base do leitor' }),
    );

    ligado.encerrar();
  });
});
