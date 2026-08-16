/**
 * Regras puras de consentimento biometrico.
 *
 * Sem banco, sem rede, sem relogio: o "agora" entra por parametro
 * (`CLAUDE.md`, Convencoes de codigo). E o que permite testar a virada dos
 * 18 anos sem esperar um aniversario.
 */

/** Maioridade civil brasileira. */
export const MAIORIDADE = 18;

/** Quem pode prestar o consentimento por este aluno. */
export type SujeitoDoConsentimento = 'STUDENT' | 'LEGAL_GUARDIAN';

/**
 * Idade em anos completos na data de referencia.
 *
 * Compara mes e dia porque `ano - ano` erraria em todo aniversario ainda nao
 * ocorrido no ano corrente -- e um aluno de 17 anos e 11 meses apareceria
 * como 18, que e exatamente o caso que o INV-143 protege.
 *
 * Ambas as datas sao tratadas em UTC: `birthDate` e `@db.Date` gravado a
 * meia-noite UTC, e misturar fuso aqui faria a idade oscilar conforme o
 * servidor.
 */
export function calcularIdadeEmAnos(nascimento: Date, referencia: Date): number {
  const anos = referencia.getUTCFullYear() - nascimento.getUTCFullYear();

  const mesDeReferencia = referencia.getUTCMonth();
  const mesDeNascimento = nascimento.getUTCMonth();

  const aindaNaoFezAniversario =
    mesDeReferencia < mesDeNascimento ||
    (mesDeReferencia === mesDeNascimento &&
      referencia.getUTCDate() < nascimento.getUTCDate());

  return aindaNaoFezAniversario ? anos - 1 : anos;
}

/**
 * Quem precisa consentir por um aluno com esta idade (INV-143).
 *
 * Menor de 18 exige responsavel legal, com vinculo comprovavel. Nao ha
 * excecao para "quase 18": a lei nao tem faixa cinzenta, e o Arena Positiva
 * tem aluno menor matriculado.
 */
export function sujeitoExigido(idadeEmAnos: number): SujeitoDoConsentimento {
  return idadeEmAnos < MAIORIDADE ? 'LEGAL_GUARDIAN' : 'STUDENT';
}

/** Por que um consentimento nao serve para autorizar biometria agora. */
export type MotivoDeInvalidez =
  | 'CONSENT_MISSING'
  | 'CONSENT_REFUSED'
  | 'CONSENT_REVOKED'
  | 'CONSENT_SUPERSEDED'
  | 'CONSENT_REVALIDATION_REQUIRED'
  | 'CONSENT_DOCUMENT_RETIRED';

/** O que a regra precisa saber sobre uma decisao ja registrada. */
export interface DecisaoRegistrada {
  decision: 'ACCEPTED' | 'REFUSED';
  subjectKind: SujeitoDoConsentimento;
  /** Idade do aluno na data da decisao -- congelada, nao recalculada. */
  subjectAgeYears: number;
  supersededAt: Date | null;
  /** Documento aposentado nao autoriza cadastro novo. */
  documentRetiredAt: Date | null;
}

export type AvaliacaoDeConsentimento =
  | { valido: true }
  | { valido: false; motivo: MotivoDeInvalidez };

/**
 * O consentimento autoriza criar identidade biometrica AGORA?
 *
 * A regra da virada dos 18 (INV-143) e a parte sutil: um consentimento dado
 * pelo responsavel quando o aluno tinha 16 continua sendo prova valida do
 * que aconteceu, mas DEIXA DE AUTORIZAR cadastro novo quando o titular vira
 * maior de idade -- quem decide sobre o proprio corpo passa a ser ele.
 * Por isso a comparacao usa a idade de HOJE contra o sujeito da decisao,
 * e nao a idade congelada sozinha.
 */
export function avaliarConsentimento(
  decisao: DecisaoRegistrada | null,
  idadeAtualEmAnos: number,
): AvaliacaoDeConsentimento {
  if (!decisao) return { valido: false, motivo: 'CONSENT_MISSING' };

  if (decisao.decision === 'REFUSED') {
    return { valido: false, motivo: 'CONSENT_REFUSED' };
  }

  if (decisao.supersededAt !== null) {
    return { valido: false, motivo: 'CONSENT_SUPERSEDED' };
  }

  if (decisao.documentRetiredAt !== null) {
    return { valido: false, motivo: 'CONSENT_DOCUMENT_RETIRED' };
  }

  // Virou maior de idade sob consentimento de responsavel: revalidar com o
  // proprio aluno (INV-143).
  if (decisao.subjectKind === 'LEGAL_GUARDIAN' && idadeAtualEmAnos >= MAIORIDADE) {
    return { valido: false, motivo: 'CONSENT_REVALIDATION_REQUIRED' };
  }

  // Menor consentindo por si mesmo nao vale, mesmo que a linha exista.
  if (decisao.subjectKind === 'STUDENT' && idadeAtualEmAnos < MAIORIDADE) {
    return { valido: false, motivo: 'CONSENT_REVALIDATION_REQUIRED' };
  }

  return { valido: true };
}

/**
 * Data em que o expurgo vence (INV-142).
 *
 * `dias` vem de `TenantPrivacySettings`, nao de constante: quem decide o
 * prazo e a academia controladora (art. 39). 30 e o padrao, nao a regra.
 */
export function calcularVencimentoDoExpurgo(fimDoVinculo: Date, dias: number): Date {
  const vencimento = new Date(fimDoVinculo.getTime());
  vencimento.setUTCDate(vencimento.getUTCDate() + dias);

  return vencimento;
}
