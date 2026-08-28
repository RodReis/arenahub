import type { BlocoDaTelaPublica, DesafioPublico, KioskConfig } from '@arenahub/api-contracts';

/**
 * O rodizio da tela publica -- F51, `M3.5-FR-004`.
 *
 * PURO: entra config, sai a lista que gira. Sem `setInterval` aqui dentro --
 * quem tem relogio e o componente. E o que torna "video sem origem sai do
 * rodizio" testavel sem esperar 12 segundos.
 */

/**
 * Os blocos que de fato aparecem, na ordem publicada.
 *
 * Nao basta filtrar `habilitado`: um bloco de VIDEO ligado cuja midia nao
 * resolveu (chave de outra unidade, storage fora do ar -- ver
 * `kiosk-media-link.service.ts`) nao tem o que exibir. Deixa-lo no rodizio
 * produziria um quadrado preto de 12 segundos na recepcao, que e pior do que
 * o bloco nao existir.
 *
 * A checagem e por `midiaUrl`, e nao por `midiaKey`: a CHAVE continua
 * gravada mesmo quando a URL falhou -- e ela que o painel edita.
 */
export function blocosVisiveis(
  config: KioskConfig,
  /**
   * O desafio em cartaz -- `null` quando nao ha nenhum aberto, ou quando o
   * modulo `desafios` esta desligado (o servidor ja decide isso).
   */
  desafio: DesafioPublico | null = null,
): readonly BlocoDaTelaPublica[] {
  return config.blocos.itens.filter((bloco) => {
    if (!bloco.habilitado) return false;

    if (bloco.tipo === 'VIDEO') return typeof bloco.midiaUrl === 'string' && bloco.midiaUrl !== '';

    /*
     * Sem desafio em cartaz o bloco SAI da lista -- mesma regra do video sem
     * midia, logo acima. Bloco de campanha vazio na parede e pior que bloco
     * ausente: o carrossel pararia num quadro que so tem titulo.
     */
    if (bloco.tipo === 'DESAFIO') return desafio !== null;

    return true;
  });
}

/**
 * O proximo indice do rodizio.
 *
 * Lista vazia devolve 0 em vez de `NaN`: `% 0` e `NaN`, e um indice `NaN`
 * faria o `itens[indice]` virar `undefined` silenciosamente -- a tela
 * ficaria em branco sem erro nenhum no console.
 *
 * Lista que ENCOLHEU entre duas voltas (o gerente publicou com um bloco a
 * menos) tambem cai aqui: o modulo traz o indice de volta para dentro.
 */
export function proximoIndice(indiceAtual: number, total: number): number {
  if (total <= 0) return 0;

  return (indiceAtual + 1) % total;
}

/**
 * O indice que ainda e valido depois de a lista mudar.
 *
 * Chamado quando uma configuracao nova chega SEM reinicio (o reinicio so
 * acontece fora de sessao -- ADR-042, Decisao 3): sem isto, o indice 4 de
 * uma lista que passou a ter 2 blocos apontaria para o vazio ate a proxima
 * volta.
 */
export function indiceSeguro(indiceAtual: number, total: number): number {
  if (total <= 0) return 0;
  if (indiceAtual < total) return indiceAtual;

  return 0;
}
