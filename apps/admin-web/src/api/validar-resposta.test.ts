import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CODIGO_DE_CONTRATO, validarResposta } from './validar-resposta';

const CONTEXTO = { caminho: '/api/v1/plans', correlationId: 'corr-1' };

const PLANO = z.object({
  id: z.string(),
  name: z.string(),
  prices: z.array(z.object({ amountMinor: z.number() })),
});

describe('validarResposta', () => {
  it('devolve os dados quando o corpo casa com o schema', () => {
    const corpo = [{ id: 'p1', name: 'Mensal', prices: [{ amountMinor: 12000 }] }];

    const resultado = validarResposta(z.array(PLANO), corpo, CONTEXTO);

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.dados).toEqual(corpo);
  });

  /*
   * O caso exato da issue #167: `prices` ausente derrubava a tela com
   * `Cannot read properties of undefined (reading length)` na renderizacao.
   */
  it('transforma campo ausente em ProblemDetails, sem lancar', () => {
    const resultado = validarResposta(z.array(PLANO), [{ id: 'p1', name: 'Mensal' }], CONTEXTO);

    expect(resultado.ok).toBe(false);

    if (resultado.ok) {
      throw new Error('esperava falha de contrato');
    }

    expect(resultado.erro.code).toBe(CODIGO_DE_CONTRATO);
    expect(resultado.erro.status).toBe(502);
    expect(resultado.erro.correlationId).toBe('corr-1');
    expect(resultado.erro.title).toContain('/api/v1/plans');
    // O caminho do campo tem de aparecer -- e o que encurta o diagnostico.
    expect(resultado.erro.title).toContain('0.prices');
  });

  it('nao vaza o valor recebido na mensagem', () => {
    const esquema = z.object({ cpf: z.number() });

    const resultado = validarResposta(esquema, { cpf: '52998224725' }, CONTEXTO);

    expect(resultado.ok).toBe(false);
    expect(resultado.ok || resultado.erro.title).not.toContain('52998224725');
  });

  it('resume quando ha mais falhas que o limite', () => {
    const esquema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() });

    const resultado = validarResposta(esquema, {}, CONTEXTO);

    expect(resultado.ok).toBe(false);
    expect(resultado.ok || resultado.erro.title).toContain('(+1)');
  });
});
