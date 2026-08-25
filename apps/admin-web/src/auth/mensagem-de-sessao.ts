/**
 * Mensagens de autenticacao, compartilhadas por todas as Server Actions.
 *
 * Cada action tem seu proprio mapa `MENSAGEM` com os codigos do seu dominio
 * -- e nenhum deles traduzia `AUTH_REQUIRED`. Resultado: sessao expirada
 * saia como "Nao foi possivel atribuir o plano (AUTH_REQUIRED)", que a
 * recepcao lia como falha do plano (issue #187).
 *
 * Vive aqui, e nao repetido nos nove mapas locais, porque o proximo mapa
 * nasceria sem ele -- e o buraco voltaria pela porta nova. Cada action
 * espalha este objeto no proprio `MENSAGEM`.
 */

/**
 * O QUE FAZER, nao so o que houve.
 *
 * "Sua sessao expirou" sozinho e mais um "algo deu errado". A frase precisa
 * mandar entrar de novo, senao a operadora fica tentando a mesma acao.
 */
export const SESSAO_EXPIRADA =
  'Sua sessao expirou. Entre de novo para continuar — o que voce preencheu segue na tela.';

export const MENSAGEM_DE_SESSAO: Record<string, string> = {
  AUTH_REQUIRED: SESSAO_EXPIRADA,
  /*
   * PERMISSAO NEGADA NAO E SESSAO EXPIRADA. Mandar "entre de novo" para quem
   * esta logado e sem permissao faz a pessoa repetir o login inutilmente,
   * concluindo que o sistema esta quebrado.
   */
  FORBIDDEN: 'Seu perfil nao tem permissao para esta acao.',
};
