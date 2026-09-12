/**
 * Interpreta o link que o aluno abre a partir do e-mail.
 *
 * A REGRA E RECUSAR POR PADRAO. O token do link define senha de conta: segui-lo
 * a partir de uma origem que nao e o proprio app abre caminho para um e-mail
 * forjado apontar para `https://algo.test/ativar?token=...` e o app tratar o
 * token como se fosse nosso.
 *
 * Por isso a checagem e do ESQUEMA inteiro (`arenahub://`), e nao de conter o
 * nome em algum lugar da string -- `https://evil.test/?x=arenahub://ativar`
 * contem, e nao e nosso.
 */

export type TipoDeLink = 'ATIVACAO' | 'RECUPERACAO';

export interface LinkInterpretado {
  readonly tipo: TipoDeLink;
  readonly token: string;
}

const ESQUEMA = 'arenahub://';

const CAMINHOS: Record<string, TipoDeLink> = {
  ativar: 'ATIVACAO',
  recuperar: 'RECUPERACAO',
};

export class LinkNaoPermitidoError extends Error {
  constructor() {
    super('LINK_NAO_PERMITIDO');
    this.name = 'LinkNaoPermitidoError';
  }
}

export class LinkSemTokenError extends Error {
  constructor() {
    super('LINK_SEM_TOKEN');
    this.name = 'LinkSemTokenError';
  }
}

export function interpretarLink(url: string): LinkInterpretado {
  if (!url.startsWith(ESQUEMA)) throw new LinkNaoPermitidoError();

  const resto = url.slice(ESQUEMA.length);
  const [caminho = '', consulta = ''] = resto.split('?');

  const tipo = CAMINHOS[caminho.replace(/\/+$/, '')];
  if (!tipo) throw new LinkNaoPermitidoError();

  const token = new URLSearchParams(consulta).get('token');
  if (!token) throw new LinkSemTokenError();

  return { tipo, token };
}
