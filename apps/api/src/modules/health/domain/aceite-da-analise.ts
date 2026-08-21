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

/**
 * Os quatro motivos do PROFESSOR sairam com o ADR-040 (`MISSING_PROFESSIONAL`,
 * `REFUSED_PROFESSIONAL`, `OUT_OF_ORDER`): nenhum caminho os emitia depois que
 * o endosso deixou de ser exigido, e motivo que ninguem emite e codigo morto
 * que o proximo leitor tenta implementar de novo.
 */
export type MotivoDeBloqueio =
  | 'AI_CONSENT_MISSING_STUDENT'
  | 'AI_CONSENT_REFUSED_STUDENT'
  | 'AI_CONSENT_DOCUMENT_RETIRED'
  | 'AI_CONSENT_REVALIDATION_REQUIRED';

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
    // Mais recente primeiro; NO EMPATE, a recusa vence.
    //
    // `Array.prototype.sort` e estavel, entao empate no `em` preservaria a
    // ordem de chegada -- que e a ordem em que o Postgres devolveu as linhas,
    // sem nenhuma garantia. Duas assinaturas vivas do MESMO papel com o mesmo
    // instante sao alcancaveis: `occurred_at` nao tem unicidade, o `agora` e o
    // mesmo `Date` para os dois papeis dentro de uma transacao, e nada no
    // banco impede duas linhas vivas do mesmo papel.
    //
    // Sem este desempate, um ACCEPTED e um REFUSED gravados no mesmo instante
    // autorizavam ou bloqueavam conforme a ordem fisica das linhas -- a
    // analise rodava sobre dado de saude de quem recusou por sorte de
    // ordenacao. Na duvida entre autorizar e bloquear, bloqueia.
    .sort((a, b) => {
      const porInstante = b.em.getTime() - a.em.getTime();

      if (porInstante !== 0) return porInstante;

      if (a.decisao === b.decisao) return 0;

      return a.decisao === 'REFUSED' ? -1 : 1;
    });

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

  if (aluno === null) {
    return { autorizado: false, motivo: 'AI_CONSENT_MISSING_STUDENT' };
  }

  // Recusa vem logo depois da existencia, como em `avaliarConsentimento`
  // (F8): quem disse NAO ja decidiu, e nenhuma checagem posterior --
  // documento aposentado, virada dos 18, ordem das assinaturas -- pode
  // transformar isso em autorizacao. Sem este ramo a decisao era LIDA e
  // ignorada, e a analise rodava sobre dado de saude de quem recusou.
  if (aluno.decisao === 'REFUSED') {
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

  // ---------------------------------------------------------------------
  // O ENDOSSO DO PROFESSOR SAIU (ADR-040). O CONSENTIMENTO DO TITULAR NAO.
  // ---------------------------------------------------------------------
  //
  // O aceite era DUPLO: o aluno consentia e o professor endossava. O PI
  // removeu o endosso em 21/08/2026 -- a analise entra direto e fica
  // disponivel, sem esperar ninguem endossar.
  //
  // O que fica e o consentimento do ALUNO, e ele nao e escolha de produto:
  // dado de saude e sensivel (LGPD art. 5, II) e o art. 11 e LISTA FECHADA
  // -- legitimo interesse nao existe para ele. Enviar saude de quem nao
  // consentiu a um provedor externo nao vira legal porque o processo ficou
  // mais rapido, e o `CLAUDE.md` lista LGPD entre as duas unicas coisas que
  // param a entrega.
  //
  // Por isso os ramos acima permanecem: falta de consentimento, recusa,
  // documento aposentado e a virada dos 18 continuam bloqueando. Sumiram
  // apenas os quatro ramos do professor -- inclusive `OUT_OF_ORDER`, que so
  // fazia sentido comparando endosso com consentimento.
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
