import {
  TIPOS_DE_BLOCO,
  type BlocoDaTelaPublica,
  type TipoDeBloco,
} from '@arenahub/api-contracts';

/**
 * Manipulacao da lista de blocos da tela publica -- F51.
 *
 * PURAS: entra lista, sai lista. Sem React, sem DOM, sem estado. E o que
 * torna "mover para cima na primeira posicao" testavel sem montar a tela --
 * e e exatamente onde erro de indice se esconde.
 */

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeBloco, string>> = {
  VIDEO: 'Vídeo informativo',
  EVENTOS: 'Eventos',
  MATERIAL: 'Material informativo',
  INSTAGRAM: 'Instagram',
  INFORMACOES: 'Informações da unidade',
  DESAFIO: 'Desafio em cartaz',
};

/**
 * Um bloco novo do tipo pedido, desligado.
 *
 * NASCE DESLIGADO de proposito: acrescentar um bloco vazio e publicar o
 * rodizio com um cartao sem conteudo sao duas decisoes distintas, e a
 * segunda tem de ser deliberada.
 *
 * O `id` vem de fora: `crypto.randomUUID()` aqui tornaria a funcao impura e
 * o teste dependeria de sorte.
 */
export function blocoNovo(tipo: TipoDeBloco, id: string): BlocoDaTelaPublica {
  const base = { id, habilitado: false } as const;

  switch (tipo) {
    case 'VIDEO':
      return { ...base, tipo, titulo: 'Vídeo', legenda: 'Legenda do vídeo', midiaKey: null, linkExterno: null };
    case 'EVENTOS':
      return { ...base, tipo, titulo: 'Próximos eventos', itens: [] };
    case 'MATERIAL':
      return { ...base, tipo, titulo: 'Material informativo', resumo: '', urlDoQr: 'https://' };
    case 'INSTAGRAM':
      return { ...base, tipo, perfil: '@', chamada: 'Siga a gente' };
    case 'DESAFIO':
      /*
       * So o TITULO -- o conteudo (campanha, meta, prazo) vem do heartbeat
       * e muda sozinho. Congelar o nome do desafio aqui obrigaria a
       * republicar a config a cada campanha nova (ADR-048, emenda 2).
       */
      return { ...base, tipo, titulo: 'Desafio do mês' };
    case 'INFORMACOES':
      return {
        ...base,
        tipo,
        titulo: 'A unidade agora',
        mostrarCheckinsDeHoje: true,
        mostrarTreinandoAgora: true,
      };
  }
}

/**
 * Move o bloco do indice `de` uma posicao na direcao pedida.
 *
 * Fora dos limites devolve a MESMA lista, sem lancar: o botao "subir" da
 * primeira linha e o "descer" da ultima ficam desabilitados na tela, mas
 * teclado e leitor de tela alcancam o que o CSS esconde, e uma lista
 * embaralhada por indice negativo seria descoberta so na publicacao.
 */
export function mover(
  itens: readonly BlocoDaTelaPublica[],
  de: number,
  direcao: 'cima' | 'baixo',
): readonly BlocoDaTelaPublica[] {
  const para = direcao === 'cima' ? de - 1 : de + 1;

  if (de < 0 || de >= itens.length || para < 0 || para >= itens.length) return itens;

  const copia = [...itens];
  const [movido] = copia.splice(de, 1);

  if (movido === undefined) return itens;

  copia.splice(para, 0, movido);

  return copia;
}

/** Substitui o bloco de mesmo `id`, preservando a posicao. */
export function substituir(
  itens: readonly BlocoDaTelaPublica[],
  bloco: BlocoDaTelaPublica,
): readonly BlocoDaTelaPublica[] {
  return itens.map((atual) => (atual.id === bloco.id ? bloco : atual));
}

/** Remove o bloco de `id`. */
export function remover(
  itens: readonly BlocoDaTelaPublica[],
  id: string,
): readonly BlocoDaTelaPublica[] {
  return itens.filter((bloco) => bloco.id !== id);
}

/**
 * Os tipos que ainda cabem na lista.
 *
 * UM DE CADA TIPO: a tela publica tem cinco papeis distintos, e dois blocos
 * de eventos no mesmo rodizio seriam o mesmo cartao duas vezes. O teto do
 * contrato (`max(TIPOS_DE_BLOCO.length)`) so faz sentido com esta regra.
 */
export function tiposDisponiveis(
  itens: readonly BlocoDaTelaPublica[],
): readonly TipoDeBloco[] {
  const usados = new Set(itens.map((bloco) => bloco.tipo));

  return TIPOS_DE_BLOCO.filter((tipo) => !usados.has(tipo));
}
