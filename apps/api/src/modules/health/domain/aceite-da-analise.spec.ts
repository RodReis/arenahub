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

describe('avaliarAceite -- exige as DUAS assinaturas', () => {
  it('autoriza com aluno e professor aceitos, nessa ordem', () => {
    const r = avaliarAceite([assinatura('STUDENT'), assinatura('PROFESSIONAL')], ADULTO);

    expect(r).toEqual({ autorizado: true });
  });

  it('so o aluno nao basta', () => {
    expect(avaliarAceite([assinatura('STUDENT')], ADULTO)).toEqual({
      autorizado: false,
      motivo: 'AI_CONSENT_MISSING_PROFESSIONAL',
    });
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

  it('recusa do professor bloqueia, mesmo com o aluno aceitando', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT'), assinatura('PROFESSIONAL', { decisao: 'REFUSED' })],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_REFUSED_PROFESSIONAL' });
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
   * Endosso antes do consentimento seria autorizacao construida de tras para
   * frente: a academia decide e depois colhe a assinatura do titular.
   */
  it('recusa professor que endossou ANTES de o aluno consentir', () => {
    const r = avaliarAceite(
      [assinatura('STUDENT', { em: HOJE }), assinatura('PROFESSIONAL', { em: ONTEM })],
      ADULTO,
    );

    expect(r).toMatchObject({ motivo: 'AI_CONSENT_OUT_OF_ORDER' });
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
});

describe('substituiveis -- o defeito que este desenho existe para impedir', () => {
  /**
   * O `registrarDecisao` da F8 marca como substituida TODA decisao viva do
   * documento. Aplicado ao aceite direto e automatico, autorizado pela academia
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
