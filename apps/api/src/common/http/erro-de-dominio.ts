/**
 * Erro de dominio com codigo estavel.
 *
 * O `code` e contrato: cliente e suporte decidem comportamento a partir dele,
 * entao renomear quebra quem depende. A `title` e para humano e pode mudar.
 *
 * `CLAUDE.md`, Convencoes: "erro de dominio tem codigo estavel; resposta HTTP
 * segue application/problem+json".
 */
export class ErroDeDominio extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly title: string,
  ) {
    super(title);
    this.name = 'ErroDeDominio';
  }
}

/**
 * Credencial invalida.
 *
 * UM erro para senha errada E para e-mail inexistente, de proposito.
 * Distinguir os dois transforma o login num oraculo de quem tem conta na
 * academia -- material de phishing dirigido.
 */
export class CredencialInvalidaError extends ErroDeDominio {
  constructor() {
    super('AUTH_INVALID_CREDENTIALS', 401, 'Credenciais invalidas');
  }
}

/**
 * Refresh token ja rotacionado reapareceu.
 *
 * Codigo proprio porque a consequencia e diferente: nao e "tente de novo", e
 * "a familia de sessao inteira acabou de ser revogada".
 */
export class RefreshReutilizadoError extends ErroDeDominio {
  constructor() {
    super('AUTH_REFRESH_REUSED', 401, 'Sessao encerrada por reuso de token');
  }
}

export class NaoAutenticadoError extends ErroDeDominio {
  constructor() {
    super('AUTH_REQUIRED', 401, 'Autenticacao obrigatoria');
  }
}
