import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  type BlocoDaTelaPublica,
  type IndicadoresDaUnidade,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { Atrator } from './atrator.js';

/**
 * O VAO DE DISTRIBUICAO SO EXISTE NA TELA VAZIA.
 *
 * `DS-TOTEM.md` §4: "se todos os blocos opcionais estiverem desligados, hero
 * e CTA se distribuem com o espaco restante". A leitura INVERSA e o que
 * faltava no codigo: quando HA bloco, o espaco pertence a grade.
 *
 * Ate 28/08/2026 o vao de CIMA era incondicional -- so o de baixo tinha a
 * guarda, adicionada na F31. No totem real de 1080x1920 isso empurrava o
 * hero 500px para baixo: o cabecalho terminava em y=132 e o hero comecava em
 * y=720, com a grade espremida no que sobrava. O protipo (`Totem.dc.html`)
 * poe o hero logo abaixo do cabecalho.
 *
 * ESTES DOIS TESTES SAO O CANARIO: devolver o `<span style={{ flex: 1 }} />`
 * incondicional faz o primeiro falhar.
 */

const instagram: BlocoDaTelaPublica = {
  id: 'i',
  habilitado: true,
  tipo: 'INSTAGRAM',
  perfil: '@arena',
  chamada: 'Siga a gente',
};

const SEM_INDICADORES: IndicadoresDaUnidade = {
  checkinsDeHoje: 0,
  treinandoAgora: 0,
  placar: [],
  desafio: null,
};

function montar(itens: readonly BlocoDaTelaPublica[], indicadores: IndicadoresDaUnidade) {
  const config: KioskConfig = {
    ...CONFIG_PADRAO_DO_TOTEM,
    blocos: { tempoPorBlocoSegundos: 12, itens: [...itens] },
  };

  return render(
    <Atrator
      config={config}
      indicadores={indicadores}
      aoEntrar={() => {}}
      altoContraste={false}
      aoAlternarContraste={() => {}}
    />,
  );
}

/**
 * Conta so os espacadores: `<span>` VAZIO cujo estilo inline traz
 * `flex-grow`.
 *
 * O filtro por conteudo vazio nao e detalhe: o `<span>` do logotipo declara
 * `flexShrink: 0`, e um seletor `[style*="flex"]` casa com ele -- foi o que
 * fez a primeira versao deste teste falhar pelo motivo errado, acusando o
 * cabecalho em vez do vao. `flex-grow` e o que o espacador de fato usa; o
 * logotipo nao o declara.
 */
function espacadores(container: HTMLElement): number {
  return [...container.querySelectorAll('span')].filter(
    (span) => span.textContent === '' && span.style.flexGrow !== '',
  ).length;
}

describe('os vaos de distribuicao do §4', () => {
  it('somem quando ha bloco na grade -- o espaco e do conteudo', () => {
    const { container } = montar([instagram], SEM_INDICADORES);

    expect(espacadores(container)).toBe(0);
  });

  it('somem tambem quando so o ranking ocupa a grade', () => {
    const { container } = montar([], {
      ...SEM_INDICADORES,
      placar: [{ position: 1, nomeExibido: 'Ana S.', points: 50 }],
    });

    expect(espacadores(container)).toBe(0);
  });

  it('voltam quando a grade nao tem nada a mostrar', () => {
    const { container } = montar([], SEM_INDICADORES);

    expect(espacadores(container)).toBeGreaterThan(0);
  });
});
