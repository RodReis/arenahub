/**
 * Aceite da analise por IA: DUAS assinaturas (F21, Slice 3.5).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" entra por
 * parametro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DUAS, E POR QUE ELAS NAO SAO A MESMA COISA.
 * ---------------------------------------------------------------------------
 *
 * Decisao do PI em 21/08/2026: o aceite e "do aluno e do professor". Sao atos
 * DIFERENTES, de pessoas diferentes, com efeitos juridicos diferentes:
 *
 *   - **ALUNO (titular).** Consentimento no sentido da LGPD. Dado de saude e
 *     sensivel (art. 5, II) e o art. 11 e lista fechada: so o TITULAR consente
 *     -- a academia nao pode consentir por ele. E o que autoriza os numeros a
 *     sairem do pais (ADR-036 decisao 2).
 *   - **PROFESSOR (profissional).** NAO e consentimento; e endosso
 *     profissional. Ele responde por pedir a analise daquele aluno naquele
 *     momento -- e o "humano no circuito" que a regra de arquitetura no 8
 *     exige quando diz que a IA nunca publica sozinha.
 *
 * Tratar os dois como um so registro apagaria a distincao no exato lugar onde
 * ela e cobrada: numa fiscalizacao, "quem consentiu" e "quem operou" sao
 * perguntas separadas, e um `actorId` dentro da linha do aluno responde
 * apenas a segunda.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM IMPORTA, E E SEMPRE ALUNO PRIMEIRO.
 * ---------------------------------------------------------------------------
 *
 * O endosso do professor sobre um aluno que ainda nao consentiu seria
 * autorizacao construida de tras para frente -- a academia decidindo e depois
 * colhendo assinatura. `avaliarAceite` recusa esse caso por construcao.
 *
 * ---------------------------------------------------------------------------
 * REVOGAR: UMA SO BASTA, E A ASSIMETRIA E DELIBERADA.
 * ---------------------------------------------------------------------------
 *
 * Autorizar exige as DUAS. Revogar exige UMA: o aluno pode retirar o
 * consentimento a qualquer tempo (art. 18, IX) sem depender de ninguem, e o
 * professor pode suspender o uso sem precisar da concordancia do aluno. Exigir
 * as duas para revogar transformaria a revogacao em negociacao.
 */

export type PapelDoAceite = 'STUDENT' | 'PROFESSIONAL';

export type DecisaoDeAceite = 'ACCEPTED' | 'REFUSED';

/** Uma assinatura registrada, como a regra precisa dela. */
export interface AssinaturaRegistrada {
  readonly papel: PapelDoAceite;
  readonly decisao: DecisaoDeAceite;
  /** Quando foi prestada. Define a ordem entre as duas. */
  readonly em: Date;
  /** Preenchido quando uma decisao posterior do MESMO papel a substituiu. */
  readonly substituidaEm: Date | null;
  /** Documento aposentado nao autoriza analise nova. */
  readonly documentoAposentadoEm: Date | null;
  /**
   * Para o aluno: quem prestou -- ele mesmo ou o responsavel legal.
   * `null` para o professor, que assina sempre por si.
   */
  readonly sujeito: 'STUDENT' | 'LEGAL_GUARDIAN' | null;
}

export type MotivoDeBloqueio =
  | 'AI_CONSENT_MISSING_STUDENT'
  | 'AI_CONSENT_MISSING_PROFESSIONAL'
  | 'AI_CONSENT_REFUSED_STUDENT'
  | 'AI_CONSENT_REFUSED_PROFESSIONAL'
  | 'AI_CONSENT_DOCUMENT_RETIRED'
  | 'AI_CONSENT_REVALIDATION_REQUIRED'
  /** O professor endossou antes de o aluno consentir. */
  | 'AI_CONSENT_OUT_OF_ORDER';

export type AvaliacaoDeAceite =
  | { readonly autorizado: true }
  | { readonly autorizado: false; readonly motivo: MotivoDeBloqueio };

const MAIORIDADE = 18;

/** A assinatura viva de um papel -- a mais recente que ninguem substituiu. */
function vigente(
  assinaturas: readonly AssinaturaRegistrada[],
  papel: PapelDoAceite,
): AssinaturaRegistrada | null {
  const vivas = assinaturas
    .filter((a) => a.papel === papel && a.substituidaEm === null)
    .sort((a, b) => b.em.getTime() - a.em.getTime());

  return vivas[0] ?? null;
}

/**
 * A analise por IA esta autorizada AGORA? (`M3-AC-007`)
 *
 * `idadeAtualEmAnos` entra porque a virada dos 18 vale aqui como vale na
 * biometria (INV-143): consentimento dado pelo responsavel continua sendo
 * prova do que aconteceu, mas DEIXA de autorizar envio novo quando o titular
 * passa a decidir sobre si.
 */
export function avaliarAceite(
  assinaturas: readonly AssinaturaRegistrada[],
  idadeAtualEmAnos: number,
): AvaliacaoDeAceite {
  const aluno = vigente(assinaturas, 'STUDENT');
  const professor = vigente(assinaturas, 'PROFESSIONAL');

  if (aluno === null) {
    return { autorizado: false, motivo: 'AI_CONSENT_MISSING_STUDENT' };
  }

  if (aluno.decisao === 'REFUSED') {
    // Recusar a IA deixa o aluno com avaliacao, historico, comparativos e
    // metas -- tudo, menos o texto gerado (ADR-036, retificacao de 20/08).
    return { autorizado: false, motivo: 'AI_CONSENT_REFUSED_STUDENT' };
  }

  if (aluno.documentoAposentadoEm !== null) {
    return { autorizado: false, motivo: 'AI_CONSENT_DOCUMENT_RETIRED' };
  }

  // INV-143 aplicado a esta fatia: as duas direcoes da virada dos 18.
  if (aluno.sujeito === 'LEGAL_GUARDIAN' && idadeAtualEmAnos >= MAIORIDADE) {
    return { autorizado: false, motivo: 'AI_CONSENT_REVALIDATION_REQUIRED' };
  }

  if (aluno.sujeito === 'STUDENT' && idadeAtualEmAnos < MAIORIDADE) {
    return { autorizado: false, motivo: 'AI_CONSENT_REVALIDATION_REQUIRED' };
  }

  if (professor === null) {
    return { autorizado: false, motivo: 'AI_CONSENT_MISSING_PROFESSIONAL' };
  }

  if (professor.decisao === 'REFUSED') {
    return { autorizado: false, motivo: 'AI_CONSENT_REFUSED_PROFESSIONAL' };
  }

  if (professor.documentoAposentadoEm !== null) {
    return { autorizado: false, motivo: 'AI_CONSENT_DOCUMENT_RETIRED' };
  }

  // O endosso nao pode preceder o consentimento: seria a academia decidindo
  // primeiro e colhendo a assinatura do titular depois.
  if (professor.em.getTime() < aluno.em.getTime()) {
    return { autorizado: false, motivo: 'AI_CONSENT_OUT_OF_ORDER' };
  }

  return { autorizado: true };
}

/**
 * Registrar uma assinatura substitui a anterior DO MESMO PAPEL, nunca a do
 * outro.
 *
 * E a regra que o `ConsentRecord` da F8 nao tinha: la, `registrarDecisao`
 * marca como substituida toda decisao viva do documento. Aplicado ao aceite
 * duplo, o endosso do professor apagaria o consentimento do aluno -- e a
 * autorizacao ficaria de pe com uma assinatura so, que e exatamente o que
 * este desenho existe para impedir.
 */
export function substituiveis(
  assinaturas: readonly AssinaturaRegistrada[],
  papelQueAssina: PapelDoAceite,
): readonly AssinaturaRegistrada[] {
  return assinaturas.filter((a) => a.papel === papelQueAssina && a.substituidaEm === null);
}
