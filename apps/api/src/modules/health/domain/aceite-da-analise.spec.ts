import { describe, expect, it } from '@jest/globals';

import {
  avaliarAceite,
  substituiveis,
  type AssinaturaRegistrada,
  type PapelDoAceite,
} from './aceite-da-analise.js';

const ONTEM = new Date('2026-08-20T10:00:00.000Z');
const HOJE = new Date('2026-08-21T10:00:00.000Z');

function assinatura(
  papel: PapelDoAceite,
  sobrescreve: Partial<AssinaturaRegistrada> = {},
): AssinaturaRegistrada {
  return {
    papel,
    decisao: 'ACCEPTED',
    em: papel === 'STUDENT' ? ONTEM : HOJE,
    substituidaEm: null,
    documentoAposentadoEm: null,
    sujeito: papel === 'STUDENT' ? 'STUDENT' : null,
    ...sobrescreve,
  };
}

const ADULTO = 36;

describe('avaliarAceite -- so o consentimento do TITULAR (ADR-040)', () => {
  it('autoriza com aluno e professor aceitos', () => {
    const r = avaliarAceite([assinatura('STUDENT'), assinatura('PROFESSIONAL')], ADULTO);

    expect(r).toEqual({ autorizado: true });
  });

  /**
   * O ENDOSSO DO PROFESSOR SAIU (ADR-040, decisao do PI em 21/08/2026).
   *
   * O aceite era duplo; agora a analise entra direto e fica disponivel para
   * o aluno. O consentimento do TITULAR permanece porque nao e escolha de
   * produto: dado de saude e sensivel (LGPD art. 5, II) e o art. 11 e lista
   * fechada -- so o titular consente.
   */
  it('so o aluno BASTA -- ninguem mais precisa endossar', () => {
    expect(avaliarAceite([assinatura('STUDENT')], ADULTO)).toEqual({ autorizado: true });
  });

  /**
   * O caso que a LGPD torna inegociavel: dado de saude e sensivel (art. 5, II)
   * e o art. 11 e lista fechada -- so o titular consente. A academia
   * endossando sozinha nao autoriza nada.
   */
  it('so o professor NAO autoriza -- a academia nao consente pelo aluno', () => {
    expect(avaliarAceite([assinatura('PROFESSIONAL')], ADULTO)).toEqual({
      autorizado: false,
      motivo: 'AI_CONSENT_MISSING_STUDENT',
    });
  });

  it('sem assinatura nenhuma, falta a do aluno primeiro', () => {
    expect(avaliarAceite([], ADULTO)).toEqual({
      autorizado: false,
      motivo: 'AI_CONSENT_MISSING_STUDENT',
    });
  });
});

describe('avaliarAceite -- recusa', () => {
  it('recusa do aluno bloqueia, mesmo com o professor aceitando', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT', { decisao: 'REFUSED' }), assinatura('PROFESSIONAL')],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_STUDENT' });
  });

  /**
   * Espelho do de cima depois do ADR-040: o professor deixou de ter voto.
   * Se ele recusa e o titular consentiu, a analise sai -- a decisao sobre o
   * proprio dado de saude e do aluno.
   */
  it('recusa do professor NAO bloqueia -- ele nao decide pelo titular', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT'), assinatura('PROFESSIONAL', { decisao: 'REFUSED' })],
      ADULTO,
    );

    expect(r).toEqual({ autorizado: true });
  });

  it('documento aposentado nao autoriza analise nova', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { documentoAposentadoEm: HOJE }),
        assinatura('PROFESSIONAL'),
      ],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_DOCUMENT_RETIRED' });
  });
});

describe('avaliarAceite -- a ordem das assinaturas', () => {
  /**
   * `AI_CONSENT_OUT_OF_ORDER` SAIU com o ADR-040: a regra comparava o
   * instante do endosso com o do consentimento, e sem endosso obrigatorio
   * nao ha o que ordenar. Endosso anterior ao consentimento passou a ser
   * irrelevante, nao invalido.
   */
  it('endosso anterior ao consentimento nao invalida mais nada', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT', { em: HOJE }), assinatura('PROFESSIONAL', { em: ONTEM })],
      ADULTO,
    );

    expect(r).toEqual({ autorizado: true });
  });

  it('aceita as duas no mesmo instante', () => {
    // Assinatura na mesma tela, no balcao: o par chega junto e a ordem nao
    // foi violada.
    const r = avaliarAceite(
      [assinatura('STUDENT', { em: HOJE }), assinatura('PROFESSIONAL', { em: HOJE })],
      ADULTO,
    );

    expect(r.autorizado).toBe(true);
  });
});

describe('avaliarAceite -- virada dos 18 (INV-143)', () => {
  it('consentimento de responsavel deixa de valer quando o aluno faz 18', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { sujeito: 'LEGAL_GUARDIAN' }),
        assinatura('PROFESSIONAL'),
      ],
      18,
    );

    // Continua sendo prova do que aconteceu; deixa de autorizar envio novo.
    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REVALIDATION_REQUIRED' });
  });

  it('menor consentindo por si mesmo nao vale, mesmo com a linha gravada', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT', { sujeito: 'STUDENT' }), assinatura('PROFESSIONAL')],
      16,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REVALIDATION_REQUIRED' });
  });

  it('responsavel consentindo por menor autoriza', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { sujeito: 'LEGAL_GUARDIAN' }),
        assinatura('PROFESSIONAL'),
      ],
      16,
    );

    expect(r.autorizado).toBe(true);
  });
});

describe('avaliarAceite -- assinatura substituida', () => {
  it('ignora decisao ja substituida e usa a vigente', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { decisao: 'REFUSED', em: ONTEM, substituidaEm: HOJE }),
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: HOJE }),
        assinatura('PROFESSIONAL', { em: HOJE }),
      ],
      ADULTO,
    );

    // Quem recusou ontem e aceitou hoje esta autorizado hoje. A linha antiga
    // nao some -- ela e a prova de que houve recusa naquele periodo.
    expect(r.autorizado).toBe(true);
  });

  it('usa a mais recente quando ha duas vivas do mesmo papel', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: ONTEM }),
        assinatura('STUDENT', { decisao: 'REFUSED', em: HOJE }),
        assinatura('PROFESSIONAL', { em: HOJE }),
      ],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_STUDENT' });
  });

  /**
   * Empate no instante: a recusa vence, venha na ordem que vier.
   *
   * `occurred_at` nao tem unicidade e o `agora` e o mesmo `Date` para os dois
   * papeis dentro de uma transacao, entao duas assinaturas vivas do mesmo
   * papel no mesmo instante sao alcancaveis. Como `sort` e estavel, sem
   * desempate o vencedor era a ordem em que o Postgres devolveu as linhas --
   * e a analise rodava sobre dado de quem recusou por sorte de ordenacao.
   *
   * Os dois casos existem de proposito: um sozinho passaria mesmo sem o
   * desempate, bastando a ordem de chegada ser favoravel.
   */
  it('no empate de instante a recusa vence -- recusa chegando primeiro', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { decisao: 'REFUSED', em: ONTEM }),
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: ONTEM }),
        assinatura('PROFESSIONAL', { em: HOJE }),
      ],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_STUDENT' });
  });

  it('no empate de instante a recusa vence -- recusa chegando depois', () => {
    // O par invertido existe de proposito: um caso sozinho passaria mesmo sem
    // desempate, bastando a ordem de chegada ser favoravel.
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: ONTEM }),
        assinatura('STUDENT', { decisao: 'REFUSED', em: ONTEM }),
        assinatura('PROFESSIONAL', { em: HOJE }),
      ],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_STUDENT' });
  });

  /**
   * O empate do PROFESSOR deixou de importar com o ADR-040, mas o desempate
   * em si continua sendo a garantia que impede analise sobre dado de quem
   * recusou -- so que agora ele so tem um papel a proteger. Este caso cobre
   * o empate TRIPLO do aluno: se o desempate falhasse, a ordem fisica das
   * linhas decidiria, e uma recusa perderia por sorte de ordenacao.
   */
  it('empate de tres assinaturas vivas do aluno: a recusa ainda vence', () => {
    const r = avaliarAceite(
      [
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: ONTEM }),
        assinatura('STUDENT', { decisao: 'ACCEPTED', em: ONTEM }),
        assinatura('STUDENT', { decisao: 'REFUSED', em: ONTEM }),
        assinatura('PROFESSIONAL', { em: HOJE }),
      ],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_STUDENT' });
  });
});

describe('substituiveis -- o defeito que este desenho existe para impedir', () => {
  /**
   * O `registrarDecisao` da F8 marca como substituida TODA decisao viva do
   * consentimento do aluno -- e a autorizacao ficaria de pe com uma
   * assinatura so.
   */
  it('assinar como professor nao substitui a decisao do aluno', () => {
    const vivas = [assinatura('STUDENT'), assinatura('PROFESSIONAL')];

    const alvos = substituiveis(vivas, 'PROFESSIONAL');

    expect(alvos).toHaveLength(1);
    expect(alvos[0]!.papel).toBe('PROFESSIONAL');
  });

  it('assinar como aluno nao substitui o endosso do professor', () => {
    const vivas = [assinatura('STUDENT'), assinatura('PROFESSIONAL')];

    const alvos = substituiveis(vivas, 'STUDENT');

    expect(alvos).toHaveLength(1);
    expect(alvos[0]!.papel).toBe('STUDENT');
  });

  it('nao substitui o que ja estava substituido', () => {
    const alvos = substituiveis(
      [assinatura('STUDENT', { substituidaEm: HOJE }), assinatura('STUDENT')],
      'STUDENT',
    );

    expect(alvos).toHaveLength(1);
  });
});
