import { Ausente, DataTable, EmptyState, StateBadge } from '@arenahub/ui';

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
 * `undefined` quando a divergência não se resolveu — a linha sai da tabela,
 * porque exibir um dos lados sugeriria que ele foi o publicado quando nada
 * foi.
 */
export function campoPublicado(linha: LinhaDeRevisao): CampoDaLinha | undefined {
  return linha.campos.find((campo) => campo.id === linha.campoPublicadoId);
}

/** Um campo tem leitura quando o laudo trouxe faixa para compará-lo. */
function temFaixa(campo: CampoDaLinha): boolean {
  return campo.referenceMin !== null || campo.referenceMax !== null;
}

export function ValoresDaAvaliacao({ linhas }: { readonly linhas: readonly LinhaDeRevisao[] }) {
  const publicadas = linhas.filter((linha) => campoPublicado(linha) !== undefined);

  /*
   * DUAS TABELAS, NÃO UMA COM METADE DAS CÉLULAS VAZIAS.
   *
   * Medida sem faixa de referência não tem leitura possível -- "Sem faixa
   * publicada" repetido em dez linhas ocupava a coluna inteira sem informar
   * nada, e ainda competia visualmente com os badges que importam (Acima,
   * Abaixo). Quem varre a tabela procura o que saiu da faixa; o que nem tem
   * faixa é ruído nessa varredura.
   *
   * Separadas: em cima o que se compara, embaixo o que só se registra.
   */
  const comFaixa = publicadas.filter((linha) => {
    const campo = campoPublicado(linha);

    return campo !== undefined && temFaixa(campo);
  });
  const semFaixa = publicadas.filter((linha) => {
    const campo = campoPublicado(linha);

    return campo !== undefined && !temFaixa(campo);
  });

  return (
    <section aria-labelledby="titulo-valores" className={estilos['painel']}>
      <h2 id="titulo-valores">Valores da avaliação</h2>

      <DataTable
        testId="tabela-de-valores"
        rows={comFaixa}
        rowKey={(linha) => linha.type}
        rowTestId={(linha) => `linha-${linha.type}`}
        caption="Medidas com faixa de referência do aparelho."
        empty={
          <EmptyState
            testId="sem-medidas-com-faixa"
            title="Nenhuma medida com faixa de referência neste laudo."
            hint="O aparelho não publicou faixa para comparar — os valores lidos estão na tabela abaixo."
          />
        }
        columns={[
          {
            key: 'campo',
            header: 'Campo',
            role: 'identity',
            rowHeader: true,
            render: (linha) => rotuloDeTipo(linha.type),
          },
          {
            key: 'valor',
            header: 'Valor',
            role: 'value',
            render: (linha) => <CelulaPublicada linha={linha} />,
          },
          {
            key: 'faixa',
            header: 'Faixa de referência',
            role: 'value',
            render: (linha) => {
              const campo = campoPublicado(linha);

              return campo === undefined
                ? null
                : faixaLegivel(campo.referenceMin, campo.referenceMax, campo.extractedUnit);
            },
          },
          {
            key: 'leitura',
            header: 'Leitura',
            role: 'state',
            render: (linha) => {
              const campo = campoPublicado(linha);

              return campo === undefined ? null : (
                <StateBadge machine="leitura" state={campo.leitura} />
              );
            },
          },
        ]}
      />

      {/*
        A segunda tabela só existe quando há o que pôr nela -- `DataTable`
        renderiza o `empty` quando a lista é vazia, e um "nenhuma outra
        medida" aqui seria ruído: a ausência dela já não diz nada a ninguém.
      */}
      {semFaixa.length > 0 ? (
        <div className={estilos['blocoSecundario']}>
          <DataTable
            testId="tabela-sem-faixa"
            rows={semFaixa}
            rowKey={(linha) => linha.type}
            rowTestId={(linha) => `linha-${linha.type}`}
            caption="Outras medidas registradas — o laudo não trouxe faixa para compará-las."
            empty={null}
            columns={[
              {
                key: 'campo',
                header: 'Campo',
                role: 'identity',
                rowHeader: true,
                render: (linha) => rotuloDeTipo(linha.type),
              },
              {
                key: 'valor',
                header: 'Valor',
                role: 'value',
                render: (linha) => <CelulaPublicada linha={linha} />,
              },
            ]}
          />
        </div>
      ) : null}
    </section>
  );
}

/** O valor publicado da linha — `null` quando o conflito não se resolveu. */
function CelulaPublicada({ linha }: { readonly linha: LinhaDeRevisao }) {
  const campo = campoPublicado(linha);

  return campo === undefined ? <Ausente /> : <CelulaDeValor campo={campo} />;
}
