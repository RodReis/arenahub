import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Ciclo de vida da avaliacao fisica.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O instante da
 * publicacao entra por parametro.
 *
 * A regra inteira que este arquivo existe para garantir e o **INV-102**:
 * avaliacao publicada e IMUTAVEL, e correcao cria versao nova vinculada.
 * Sobrescrever o numero errado apagaria a prova de que ele circulou -- e o
 * aluno que recebeu o laudo errado nao teria como mostrar o que viu.
 */

/** Estado que a regra precisa saber sobre uma avaliacao. */
export interface EstadoDaAvaliacao {
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly publishedAt: Date | null;
}

export class AvaliacaoImutavelError extends ErroDeDominio {
  constructor(motivo: string) {
    super('HEALTH_ASSESSMENT_IMMUTABLE', 409, motivo);
  }
}

/**
 * Avaliacao inexistente -- ou de outro tenant, que da no mesmo daqui de fora.
 *
 * 404 e nao 409 de proposito: "nao encontrada" nao e conflito de estado. E
 * responder 409 para id de OUTRO tenant vazaria que aquele id existe em
 * algum lugar (INV-006) -- oraculo de existencia entre academias.
 */
export class AvaliacaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('HEALTH_ASSESSMENT_NOT_FOUND', 404, 'avaliacao nao encontrada');
  }
}

export class AvaliacaoSemMedidaError extends ErroDeDominio {
  constructor() {
    super(
      'HEALTH_ASSESSMENT_EMPTY',
      422,
      'avaliacao sem nenhuma medida nao pode ser publicada',
    );
  }
}

/**
 * Duas confirmacoes concorrentes da MESMA origem (sessao de revisao ou
 * import avulso) -- a segunda chega aqui (fix Task 5 round 2).
 *
 * `source_reference` guarda o id que identifica a MEDICAO (o `reviewSessionId`
 * de uma sessao multiarquivo, ou o `importId` de um import avulso, F19) --
 * os dois vem do mesmo espaco de UUID e nunca colidem. O INDICE PARCIAL
 * `body_assessments_import_source_reference_uq`
 * (`ON body_assessments (source_reference) WHERE source = 'IMPORT'`) e quem
 * garante isto, nunca um `if` na aplicacao: a segunda transacao que tenta
 * criar uma `BodyAssessment` com o MESMO `source_reference` leva `P2002`,
 * e este erro traduz o `P2002` cru num 409 de dominio.
 *
 * NAO E POR LINHA DE `assessment_imports`: uma sessao de tres arquivos tem
 * tres linhas apontando para a MESMA avaliacao, e um indice em
 * `assessment_imports` nao consegue expressar "as tres linhas legitimamente
 * compartilham uma origem, mas duas TENTATIVAS de confirmacao nao podem
 * criar duas avaliacoes" -- so a tabela de avaliacoes, onde cada tentativa
 * cria EXATAMENTE UMA linha, tem o formato certo para essa garantia.
 */
export class AvaliacaoJaExisteParaOrigemError extends ErroDeDominio {
  constructor() {
    super(
      'SESSION_ALREADY_CONFIRMED',
      409,
      'ja existe avaliacao para esta origem (sessao ou import ja confirmado)',
    );
  }
}

export class CorrecaoDeRascunhoError extends ErroDeDominio {
  constructor() {
    super(
      'HEALTH_ASSESSMENT_NOT_PUBLISHED',
      409,
      'rascunho se edita; correcao existe apenas contra avaliacao publicada',
    );
  }
}

/** Rascunho aceita escrita; publicada, nunca (INV-102). */
export function podeEditar(avaliacao: EstadoDaAvaliacao): boolean {
  return avaliacao.status === 'DRAFT';
}

/**
 * Publica um rascunho.
 *
 * Recusa avaliacao vazia: linha no historico sem medida nenhuma seria um
 * ponto no grafico que nao mede nada.
 */
export function publicar(
  avaliacao: EstadoDaAvaliacao,
  quantidadeDeMedidas: number,
  agora: Date,
): EstadoDaAvaliacao {
  if (avaliacao.status === 'PUBLISHED') {
    // Publicar de novo moveria `publishedAt` -- UPDATE numa linha oficial,
    // que e exatamente o que o INV-102 proibe.
    throw new AvaliacaoImutavelError('avaliacao ja publicada');
  }

  if (quantidadeDeMedidas <= 0) {
    throw new AvaliacaoSemMedidaError();
  }

  return { status: 'PUBLISHED', publishedAt: agora };
}

/**
 * A avaliacao aceita ser corrigida agora?
 *
 * `idDaCorrecaoExistente` e o `supersededBy` ja gravado. Uma segunda
 * correcao do mesmo original produziria dois "valores certos" para a mesma
 * medicao sem criterio de desempate -- quem corrige de novo corrige a
 * correcao, formando cadeia em vez de leque.
 */
export function correcaoPermitida(
  avaliacao: EstadoDaAvaliacao,
  idDaCorrecaoExistente: string | null,
): void {
  if (avaliacao.status !== 'PUBLISHED') {
    throw new CorrecaoDeRascunhoError();
  }

  if (idDaCorrecaoExistente !== null) {
    throw new AvaliacaoImutavelError('avaliacao ja possui correcao vinculada');
  }
}
