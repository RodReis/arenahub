import { Ausente, StateBadge } from '@arenahub/ui';

import {
  faixaLegivel,
  rotuloDeTipo,
  valorLegivel,
} from '../../../../../../../src/health/formatar';
import estilos from './sessao.module.css';

/**
 * Os valores da avaliação, em LEITURA (ADR-039 e ADR-041).
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO É MAIS UM FORMULÁRIO.
 * ---------------------------------------------------------------------------
 *
 * Até o ADR-039 esta tela pedia conferência campo a campo: 31 rádios, uma
 * coluna "Origem" e um botão que só habilitava depois da última escolha. O
 * PI decidiu que a extração publica sozinha — o avaliador anexa, a avaliação
 * nasce publicada, e esta tela passa a mostrar O QUE FOI GRAVADO em vez de
 * pedir permissão para gravar.
 *
 * O que sobreviveu, e por quê:
 *
 *   - **A leitura contra a faixa** (`StateBadge`) — é o que faz alguém olhar
 *     duas vezes para um valor estranho. Sem ela a tabela vira uma lista de
 *     números sem julgamento.
 *   - **`Ausente` no lugar de zero** (INV-104) — nenhum dos dois tocou nisso:
 *     zero continua sendo uma medição real de zero.
 *   - **A faixa de referência** — 51,1% de água só é "alto" contra a faixa
 *     que o laudo imprimiu.
 *
 * O que saiu, e por quê:
 *
 *   - **A coluna "Origem"** — pedido explícito do PI. Existia para o
 *     avaliador escolher entre dois valores; sem escolha, só ocupava
 *     largura. A proveniência não se perdeu: continua gravada no campo, e os
 *     cartões de laudo acima mostram de quais arquivos a avaliação nasceu.
 *   - **A coluna "Ação", os rádios e o contador de pendentes** — não há mais
 *     o que acionar nem o que contar.
 *
 * Componente de SERVIDOR: sem estado, sem evento, nada para hidratar.
 */

export interface CampoDaLinha {
  readonly id: string;
  readonly type: string;
  readonly extractedValue: number | null;
  readonly extractedUnit: string | null;
  readonly confidence: number | null;
  readonly referenceMin: number | null;
  readonly referenceMax: number | null;
  readonly sourceLabel: string | null;
  readonly state: string;
  readonly leitura: 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';
  /** Arquivo dono do campo — vínculo real, nunca casamento por rótulo. */
  readonly importId: string | undefined;
}

export interface LinhaDeRevisao {
  readonly type: string;
  readonly concordante: boolean;
  readonly origens: readonly string[];
  readonly campos: readonly CampoDaLinha[];
  /**
   * Qual campo virou a medida publicada — decidido no SERVIDOR pela
   * precedência de origem (ADR-041, decisão 1: a balança mediu, o app
   * derivou).
   *
   * A tela LÊ essa decisão em vez de repeti-la. Reimplementar a regra aqui
   * criaria duas fontes que divergem na primeira mudança, com a tela
   * mostrando um valor e o histórico do aluno guardando outro.
   *
   * `null` quando a divergência não se resolve: dois laudos do mesmo tipo
   * discordando é defeito de aparelho, e aí não houve vencedor nenhum.
   */
  readonly campoPublicadoId: string | null;
}

/** Célula de valor: `Ausente` quando não há número (INV-104), nunca `0`. */
function CelulaDeValor({ campo }: { readonly campo: CampoDaLinha }) {
  return campo.extractedValue === null ? (
    <Ausente />
  ) : (
    <>{valorLegivel(campo.extractedValue, campo.extractedUnit)}</>
  );
}

/**
 * O campo que virou a medida, segundo o servidor.
 *
 * `undefined` quando a divergência não se resolveu — a linha sai da tabela e
 * entra no aviso de conflito, porque exibir um dos lados sugeriria que ele
 * foi o publicado quando nada foi.
 */
export function campoPublicado(linha: LinhaDeRevisao): CampoDaLinha | undefined {
  return linha.campos.find((campo) => campo.id === linha.campoPublicadoId);
}

/** Linhas cuja divergência o servidor não conseguiu resolver. */
export function linhasEmConflito(
  linhas: readonly LinhaDeRevisao[],
): readonly LinhaDeRevisao[] {
  return linhas.filter((linha) => campoPublicado(linha) === undefined);
}

export function ValoresDaAvaliacao({ linhas }: { readonly linhas: readonly LinhaDeRevisao[] }) {
  const publicadas = linhas.filter((linha) => campoPublicado(linha) !== undefined);
  const conflitos = linhasEmConflito(linhas);

  return (
    <section aria-labelledby="titulo-valores" className={estilos['painel']}>
      <h2 id="titulo-valores">Valores da avaliação</h2>

      {/*
        Conflito não some em silêncio. Quando dois laudos do mesmo tipo
        discordam, nenhum valor é publicado para aquele campo -- e o
        avaliador precisa saber QUAIS campos ficaram de fora, ou vai
        procurá-los no histórico achando que sumiram.
      */}
      {conflitos.length > 0 ? (
        <p className={estilos['avisoDeConflito']} role="note" data-testid="aviso-de-conflito">
          {conflitos.length === 1
            ? 'Um campo não foi publicado porque os laudos discordam: '
            : `${conflitos.length} campos não foram publicados porque os laudos discordam: `}
          <strong>{conflitos.map((linha) => rotuloDeTipo(linha.type)).join(', ')}</strong>. Confira
          os arquivos originais — divergência entre dois laudos do mesmo tipo costuma indicar
          problema no aparelho.
        </p>
      ) : null}

      <div className={estilos['rolagemDaTabela']}>
        <table className={estilos['tabela']} data-testid="tabela-de-valores">
          <caption className={estilos['legendaDaTabela']}>
            Medidas extraídas dos laudos e já publicadas para o aluno.
          </caption>
          <thead>
            <tr>
              <th scope="col">Campo</th>
              <th scope="col" className={estilos['colunaNumerica']}>
                Valor
              </th>
              <th scope="col" className={estilos['colunaNumerica']}>
                Faixa de referência
              </th>
              <th scope="col">Leitura</th>
            </tr>
          </thead>
          <tbody>
            {publicadas.map((linha) => {
              const campo = campoPublicado(linha);

              if (campo === undefined) return null;

              return (
                <tr key={linha.type} data-testid={`linha-${linha.type}`}>
                  <th scope="row" className={estilos['nomeDoCampo']}>
                    {rotuloDeTipo(linha.type)}
                  </th>
                  <td className={estilos['colunaNumerica']}>
                    <CelulaDeValor campo={campo} />
                  </td>
                  <td className={estilos['colunaNumerica']}>
                    {faixaLegivel(campo.referenceMin, campo.referenceMax, campo.extractedUnit)}
                  </td>
                  <td>
                    <StateBadge machine="leitura" state={campo.leitura} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
