import { beforeEach, describe, expect, it } from '@jest/globals';

import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';
import { RAZAO_DENY, type PermissaoLocal } from '../domain/access-decision.js';
import { type EventoReconhecimento } from '../domain/facial-device.js';
import {
  processarReconhecimento,
  resumirLatencia,
  type DepsPassagem,
} from './orquestrar-passagem.js';

const ENROLL = 'a'.repeat(32);
const AGORA = new Date('2026-08-14T12:00:00.000Z');

function evento(externalEnrollId = ENROLL): EventoReconhecimento {
  return { externalEnrollId, ocorridoEm: AGORA, metodo: 'facial' };
}

describe('passagem: do reconhecimento ao giro', () => {
  let catraca: TurnstileSimulator;
  let permissoes: Map<string, PermissaoLocal>;
  let relogio: number;
  let deps: DepsPassagem;

  beforeEach(() => {
    catraca = new TurnstileSimulator();
    permissoes = new Map([[ENROLL, { externalEnrollId: ENROLL }]]);
    relogio = 1000;
    deps = {
      catraca,
      buscarPermissao: (id) => permissoes.get(id) ?? null,
      registrarAllow: (id, em) => {
        const atual = permissoes.get(id);
        if (atual) permissoes.set(id, { ...atual, ultimoAllowEm: em });
      },
      // Relogio monotonico controlado: cada leitura avanca 10 ms.
      agoraMonotonicoMs: () => (relogio += 10),
    };
  });

  /**
   * `M0-AC-004`: acessos negados NAO acionam fisicamente a catraca.
   *
   * O criterio mais importante desta fatia. Nao basta a decisao dizer DENY
   * -- a catraca nao pode ter girado.
   */
  it('DENY nao aciona a catraca — nenhuma vez, por nenhuma razao', async () => {
    const casos: { nome: string; preparar: () => EventoReconhecimento }[] = [
      {
        nome: 'desconhecido',
        preparar: () => evento('b'.repeat(32)),
      },
      {
        nome: 'expirado',
        preparar: () => {
          permissoes.set(ENROLL, {
            externalEnrollId: ENROLL,
            validaAte: new Date(AGORA.getTime() - 1),
          });
          return evento();
        },
      },
      {
        nome: 'repeticao',
        preparar: () => {
          permissoes.set(ENROLL, {
            externalEnrollId: ENROLL,
            ultimoAllowEm: new Date(AGORA.getTime() - 1000),
          });
          return evento();
        },
      },
    ];

    for (const [i, caso] of casos.entries()) {
      const tentativa = await processarReconhecimento(
        deps,
        caso.preparar(),
        `corr-${i}`,
        AGORA,
      );

      expect(tentativa.decisao.resultado).toBe('DENY');
      // A ausencia de desfecho E a prova: nao houve passagem para relatar.
      expect(tentativa.desfecho).toBeUndefined();
    }

    expect(catraca.acionamentosFisicos).toBe(0);
  });

  /**
   * `M0-AC-003`: dez acessos autorizados nao produzem dupla liberacao.
   */
  it('dez acessos autorizados produzem exatamente dez acionamentos', async () => {
    for (let i = 0; i < 10; i += 1) {
      // Pessoas diferentes, para a janela anti-repique nao interferir.
      const id = String(i).padStart(32, '0');
      permissoes.set(id, { externalEnrollId: id });

      const t = await processarReconhecimento(deps, evento(id), `corr-${i}`, AGORA);
      expect(t.decisao.resultado).toBe('ALLOW');
    }

    expect(catraca.acionamentosFisicos).toBe(10);
  });

  it('reprocessar o mesmo reconhecimento nao aciona de novo', async () => {
    // Reinicio, fila, retry: o mesmo correlationId vira o mesmo comandoId, e
    // o adapter reconhece que ja executou.
    const e = evento();

    await processarReconhecimento(deps, e, 'corr-unico', AGORA);
    await processarReconhecimento(deps, e, 'corr-unico', AGORA);

    expect(catraca.acionamentosFisicos).toBe(1);
  });

  it('o leitor repicando nao vira duas passagens', async () => {
    // O leitor facial dispara varios reconhecimentos enquanto a pessoa esta
    // na frente dele. Sem a janela anti-repique, uma passagem viraria N.
    await processarReconhecimento(deps, evento(), 'corr-1', AGORA);

    const segunda = await processarReconhecimento(
      deps,
      evento(),
      'corr-2',
      new Date(AGORA.getTime() + 500),
    );

    expect(segunda.decisao).toEqual({ resultado: 'DENY', razao: RAZAO_DENY.REPETICAO });
    expect(catraca.acionamentosFisicos).toBe(1);
  });

  it('depois da janela, a mesma pessoa passa de novo', async () => {
    await processarReconhecimento(deps, evento(), 'corr-1', AGORA);

    const depois = new Date(AGORA.getTime() + 6000);
    const segunda = await processarReconhecimento(deps, evento(), 'corr-2', depois);

    expect(segunda.decisao.resultado).toBe('ALLOW');
    expect(catraca.acionamentosFisicos).toBe(2);
  });

  it('registra ALLOW so depois de liberar de fato', async () => {
    // Registrar antes faria uma falha de comando consumir a janela e negar a
    // proxima tentativa legitima de quem nem chegou a passar.
    catraca.programarDesfecho('timeout', 9999);

    const t = await processarReconhecimento(deps, evento(), 'corr-1', AGORA, 100);

    expect(t.decisao.resultado).toBe('ALLOW');
    expect(t.desfecho).toBe('timeout');
    // Acionou (a catraca liberou), mas ninguem passou -- `M0-FR-007`.
    expect(catraca.acionamentosFisicos).toBe(1);
  });

  it('mede latencia da decisao, nao do giro', async () => {
    // M0-NFR-001 quer saber quanto demora para DECIDIR. O tempo que a pessoa
    // leva para atravessar nao entra.
    catraca.programarDesfecho('girou', 3000);

    const t = await processarReconhecimento(deps, evento(), 'corr-1', AGORA);

    expect(t.latenciaDecisaoMs).toBeLessThan(100);
    expect(t.duracaoPassagemMs).toBe(3000);
  });
});

describe('resumirLatencia — M0-NFR-001', () => {
  it('devolve null sem amostra, em vez de fingir zero', () => {
    // Zero seria um p95 excelente e mentiroso.
    expect(resumirLatencia([])).toBeNull();
  });

  it('calcula p50, p95 e maximo', () => {
    const amostras = Array.from({ length: 100 }, (_, i) => i + 1);

    expect(resumirLatencia(amostras)).toEqual({ p50: 50, p95: 95, max: 100, n: 100 });
  });

  it('nao inventa valor que nao foi medido', () => {
    // Nearest-rank: com poucas amostras, interpolar produziria numero que
    // nenhuma medicao gerou -- e a bancada tem poucas amostras.
    const r = resumirLatencia([10, 20, 30]);

    expect([10, 20, 30]).toContain(r?.p50);
    expect([10, 20, 30]).toContain(r?.p95);
  });
});
