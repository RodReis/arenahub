import { interpretarLink } from './link-de-ativacao.js';

/**
 * O token do link define SENHA DE CONTA. Seguir um de origem desconhecida e o
 * caminho por onde um e-mail forjado vira tomada de conta.
 */
describe('interpretarLink', () => {
  it('aceita o esquema do proprio app', () => {
    expect(interpretarLink('arenahub://ativar?token=abc')).toEqual({
      tipo: 'ATIVACAO',
      token: 'abc',
    });
  });

  it('reconhece a recuperacao de senha', () => {
    expect(interpretarLink('arenahub://recuperar?token=xyz')).toEqual({
      tipo: 'RECUPERACAO',
      token: 'xyz',
    });
  });

  it('RECUSA link de outro host', () => {
    expect(() => interpretarLink('https://evil.test/ativar?token=abc')).toThrow(
      'LINK_NAO_PERMITIDO',
    );
  });

  it('RECUSA url que apenas CONTEM o esquema', () => {
    expect(() => interpretarLink('https://evil.test/?x=arenahub://ativar?token=abc')).toThrow(
      'LINK_NAO_PERMITIDO',
    );
  });

  it('RECUSA url de outro dominio forjada para enganar busca por substring', () => {
    /*
     * O caso adversarial de verdade, e ele nasceu de um canario que NAO
     * pegou. Trocando `startsWith` por `includes`, o teste acima continuava
     * verde -- ele caia na validacao de CAMINHO, nao na de esquema, e portanto
     * nao provava nada sobre a checagem que deveria proteger.
     *
     * Esta URL tem exatamente 11 caracteres antes de `ativar`, o mesmo
     * tamanho de `arenahub://`. Com `includes`, o `slice` recorta no lugar
     * errado e entrega `caminho: "ativar"` e `token: "roubado"` -- um link
     * de outro dominio tratado como nosso, definindo a senha da conta.
     */
    expect(() =>
      interpretarLink('https://eviativar?token=roubado&x=arenahub://'),
    ).toThrow('LINK_NAO_PERMITIDO');
  });

  it('recusa caminho desconhecido do proprio esquema', () => {
    // Esquema certo nao basta: so os dois caminhos previstos abrem tela de
    // credencial.
    expect(() => interpretarLink('arenahub://pagar?token=abc')).toThrow('LINK_NAO_PERMITIDO');
  });

  it('recusa link sem token', () => {
    expect(() => interpretarLink('arenahub://ativar')).toThrow('LINK_SEM_TOKEN');
  });

  it('recusa token vazio', () => {
    expect(() => interpretarLink('arenahub://ativar?token=')).toThrow('LINK_SEM_TOKEN');
  });

  it('ignora parametro a mais sem se confundir', () => {
    expect(interpretarLink('arenahub://ativar?utm=email&token=abc')).toEqual({
      tipo: 'ATIVACAO',
      token: 'abc',
    });
  });
});
