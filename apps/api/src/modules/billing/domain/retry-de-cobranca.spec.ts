import { describe, expect, it } from '@jest/globals';

import {
  OFFSETS_DE_RETRY_PADRAO,
  proximaTentativa,
  type PoliticaDeRetry,
} from './retry-de-cobranca.js';

/**
 * A politica de retry decidida pelo PI em 19/08/2026: 3 tentativas, em D+0,
 * D+3 e D+7 a partir do VENCIMENTO, e recusa permanente para na hora.
 *
 * Os casos abaixo provam a decisao, nao a implementacao: se alguem trocar a
 * contagem para "a partir da tentativa anterior", o caso do D+7 quebra.
 */
const PADRAO: PoliticaDeRetry = { offsetsEmDias: OFFSETS_DE_RETRY_PADRAO };
const VENCIMENTO = new Date('2026-09-10T03:00:00.000Z');

function emDias(dias: number): string {
  const d = new Date(VENCIMENTO.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString();
}

describe('proximaTentativa', () => {
  it('primeira cobranca acontece no proprio vencimento (D+0)', () => {
    const r = proximaTentativa({ tentativasFeitas: 0 }, PADRAO, VENCIMENTO);

    expect(r).toEqual({ deveTentar: true, em: new Date(emDias(0)) });
  });

  it('segunda tentativa e em D+3', () => {
    const r = proximaTentativa({ tentativasFeitas: 1 }, PADRAO, VENCIMENTO);

    expect(r).toEqual({ deveTentar: true, em: new Date(emDias(3)) });
  });

  it('terceira e ultima tentativa e em D+7', () => {
    const r = proximaTentativa({ tentativasFeitas: 2 }, PADRAO, VENCIMENTO);

    expect(r).toEqual({ deveTentar: true, em: new Date(emDias(7)) });
  });

  it('conta a partir do VENCIMENTO, nunca da tentativa anterior', () => {
    /**
     * O caso que separa as duas leituras: encadeando a partir da anterior,
     * a terceira cairia em D+10 (0 -> +3 -> +7). A decisao e D+7 absoluto --
     * senao uma falha de rede as 23h59 empurraria o calendario inteiro do
     * aluno em um dia.
     */
    const terceira = proximaTentativa({ tentativasFeitas: 2 }, PADRAO, VENCIMENTO);

    expect(terceira).not.toEqual({ deveTentar: true, em: new Date(emDias(10)) });
    expect(terceira).toEqual({ deveTentar: true, em: new Date(emDias(7)) });
  });

  it('esgotadas as tres, para de tentar', () => {
    const r = proximaTentativa({ tentativasFeitas: 3 }, PADRAO, VENCIMENTO);

    expect(r).toEqual({ deveTentar: false, motivo: 'TENTATIVAS_ESGOTADAS' });
  });

  it('recusa PERMANENTE para na hora, mesmo com tentativas sobrando', () => {
    /**
     * Cartao cancelado devolve o mesmo resultado na segunda tentativa e na
     * terceira: repetir so gera taxa e conta como recusa contra a loja na
     * adquirente. Decisao do PI em 19/08/2026.
     */
    const r = proximaTentativa(
      { tentativasFeitas: 1, ultimaFalhaEPermanente: true },
      PADRAO,
      VENCIMENTO,
    );

    expect(r).toEqual({ deveTentar: false, motivo: 'RECUSA_PERMANENTE' });
  });

  it('recusa TEMPORARIA nao interrompe: saldo insuficiente tenta de novo', () => {
    const r = proximaTentativa(
      { tentativasFeitas: 1, ultimaFalhaEPermanente: false },
      PADRAO,
      VENCIMENTO,
    );

    expect(r).toEqual({ deveTentar: true, em: new Date(emDias(3)) });
  });

  it('respeita offsets customizados do tenant', () => {
    /**
     * `BillingSettings` guarda os offsets por tenant: academia que queira
     * duas tentativas em D+1 e D+5 nao precisa de deploy.
     */
    const r = proximaTentativa({ tentativasFeitas: 1 }, { offsetsEmDias: [1, 5] }, VENCIMENTO);

    expect(r).toEqual({ deveTentar: true, em: new Date(emDias(5)) });
  });

  it('o tamanho da lista E o maximo de tentativas', () => {
    /**
     * Nao existe um segundo campo `maxTentativas` que possa discordar da
     * lista -- dois numeros para a mesma regra divergem no dia em que
     * alguem edita so um.
     */
    const r = proximaTentativa({ tentativasFeitas: 2 }, { offsetsEmDias: [1, 5] }, VENCIMENTO);

    expect(r).toEqual({ deveTentar: false, motivo: 'TENTATIVAS_ESGOTADAS' });
  });

  it('lista vazia desliga a cobranca automatica, sem cobrar em data inventada', () => {
    const r = proximaTentativa({ tentativasFeitas: 0 }, { offsetsEmDias: [] }, VENCIMENTO);

    expect(r).toEqual({ deveTentar: false, motivo: 'TENTATIVAS_ESGOTADAS' });
  });

  it('preserva a hora do vencimento em todas as tentativas', () => {
    /**
     * A cobranca de D+3 sai na MESMA hora do vencimento, nao a meia-noite:
     * o instante e o que o provedor recebe, e arredondar para o inicio do
     * dia anteciparia a cobranca em ate 24h sem ninguem ter pedido.
     *
     * Este caso NAO prova nada sobre horario de verao -- em UTC nao ha DST,
     * e `setUTCDate` e a soma em milissegundos sao equivalentes. O fuso
     * contratual do tenant (`M2-BR-007`) e aplicado por quem apresenta ou
     * agenda, nao por esta funcao.
     */
    for (const feitas of [0, 1, 2]) {
      const r = proximaTentativa({ tentativasFeitas: feitas }, PADRAO, VENCIMENTO);

      expect(r.deveTentar).toBe(true);
      if (r.deveTentar) {
        expect(r.em.getUTCHours()).toBe(VENCIMENTO.getUTCHours());
        expect(r.em.getUTCMinutes()).toBe(VENCIMENTO.getUTCMinutes());
      }
    }
  });

  it('nao muta o vencimento recebido', () => {
    const original = new Date(VENCIMENTO.getTime());

    proximaTentativa({ tentativasFeitas: 2 }, PADRAO, VENCIMENTO);

    expect(VENCIMENTO).toEqual(original);
  });
});
