import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';

/**
 * Erros proprios da identidade do ALUNO.
 *
 * `CredencialInvalidaError` e `RefreshReutilizadoError` NAO sao redefinidos
 * aqui: vem de `common/http/erro-de-dominio.ts` e valem para os dois canais.
 * Duplicar daria dois codigos para a mesma situacao, e suporte que aprendeu um
 * nao reconheceria o outro.
 */

/** Token de ativacao ou de recuperacao ja usado. */
export class TokenJaUsadoError extends ErroDeDominio {
  constructor() {
    super('TOKEN_JA_USADO', 409, 'Este link ja foi usado');
  }
}

/** Token vencido. */
export class TokenExpiradoError extends ErroDeDominio {
  constructor() {
    super('TOKEN_EXPIRADO', 410, 'Este link expirou');
  }
}

/** Token revogado -- normalmente porque um novo foi emitido. */
export class TokenRevogadoError extends ErroDeDominio {
  constructor() {
    super('TOKEN_REVOGADO', 410, 'Este link nao vale mais');
  }
}

/** Token que nao existe. Mesmo status dos anteriores, codigo proprio. */
export class TokenInvalidoError extends ErroDeDominio {
  constructor() {
    super('TOKEN_INVALIDO', 400, 'Link invalido');
  }
}

/**
 * A sessao acabou -- por logout, revogacao remota, troca de senha ou replay
 * de outro elo da familia.
 *
 * O app trata este codigo como "limpe o armazenamento e volte para o login":
 * nao adianta tentar de novo.
 */
export class SessaoRevogadaError extends ErroDeDominio {
  constructor() {
    super('SESSAO_REVOGADA', 401, 'Sessao encerrada');
  }
}

/** Refresh vencido. Separado de revogada: aqui ninguem fez nada errado. */
export class SessaoExpiradaError extends ErroDeDominio {
  constructor() {
    super('SESSAO_EXPIRADA', 401, 'Sessao expirada');
  }
}

/**
 * A sessao pedida nao e do aluno autenticado -- ou nao existe.
 *
 * UM erro para os dois casos, de proposito: distinguir "nao existe" de "nao e
 * sua" transformaria a rota num oraculo de ids de sessao alheios.
 */
export class SessaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('SESSAO_NAO_ENCONTRADA', 404, 'Sessao nao encontrada');
  }
}

/** Acao sensivel sem autenticacao recente -- `M4-FR-005`. */
export class ReautenticacaoNecessariaError extends ErroDeDominio {
  constructor() {
    super('REAUTENTICACAO_NECESSARIA', 403, 'Confirme sua senha para continuar');
  }
}

/** Senha fora da politica. */
export class SenhaFracaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('SENHA_FRACA', 422, motivo);
  }
}
