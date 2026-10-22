import { EmptyState, TenantDateTime } from '@arenahub/ui';

import { numeroLegivel } from '../../../../../src/health/formatar';
import {
  calcularIndicadores,
  idadeEm,
  type Indicadores,
  type Leitura,
  type Sexo,
} from '../../../../../src/health/indicadores';
import estilos from './avaliacao.module.css';

export interface AvaliacaoDoHistorico {
  id: string;
  assessedAt: string;
  /** `originalValue` por tipo de medida. */
  medidas: Record<string, number>;
}

interface Props {
  /** Publicadas, da mais antiga para a mais recente. */
  avaliacoes: readonly AvaliacaoDoHistorico[];
  nascimento: string;
  sexo: Sexo | null;
  fuso: string;
}

interface Coluna {
  avaliacao: AvaliacaoDoHistorico;
  r: Indicadores;
}

interface Linha {
  rotulo: string;
  unidade?: string;
  casas: number;
  valor: (coluna: Coluna) => number | null;
  leitura?: (coluna: Coluna) => Leitura | null;
  /** Texto no lugar do número (PA é par). */
  texto?: (coluna: Coluna) => string | null;
}

/** As últimas doze: um ano de fichas mensais cabe sem rolar a página inteira. */
const MAXIMO_DE_COLUNAS = 12;

const m = (coluna: Coluna, tipo: string): number | null => coluna.avaliacao.medidas[tipo] ?? null;

/**
 * A ordem é a da ficha. MG, MLG e RCQ preferem o MEDIDO (laudo de
 * bioimpedância) ao calculado: o aparelho mede compartimento, a conta estima.
 */
const LINHAS: readonly Linha[] = [
  { rotulo: 'Peso', unidade: 'kg', casas: 1, valor: (c) => m(c, 'WEIGHT') },
  { rotulo: 'Estatura', unidade: 'cm', casas: 1, valor: (c) => m(c, 'HEIGHT') },
  { rotulo: 'IMC', unidade: 'kg/m²', casas: 1, valor: (c) => c.r.imc.valor, leitura: (c) => c.r.imc.leitura },
  {
    rotulo: '%GC',
    unidade: '%',
    casas: 1,
    valor: (c) => c.r.gordura.valor,
    leitura: (c) => c.r.gordura.leitura,
  },
  {
    rotulo: 'Massa de gordura',
    unidade: 'kg',
    casas: 1,
    valor: (c) => m(c, 'BODY_FAT_MASS') ?? c.r.massaGorda.valor,
  },
  {
    rotulo: 'Massa livre de gordura',
    unidade: 'kg',
    casas: 1,
    valor: (c) => m(c, 'LEAN_BODY_MASS') ?? c.r.massaMagra.valor,
  },
  {
    rotulo: 'Cintura',
    unidade: 'cm',
    casas: 1,
    valor: (c) => c.r.cintura.valor,
    leitura: (c) => c.r.cintura.leitura,
  },
  { rotulo: 'Quadril', unidade: 'cm', casas: 1, valor: (c) => m(c, 'HIP_CIRCUMFERENCE') },
  { rotulo: 'RCE', casas: 2, valor: (c) => c.r.rce.valor, leitura: (c) => c.r.rce.leitura },
  {
    rotulo: 'RCQ',
    casas: 2,
    valor: (c) => m(c, 'WAIST_HIP_RATIO') ?? c.r.rcq.valor,
    leitura: (c) => c.r.rcq.leitura,
  },
  {
    rotulo: 'Pressão arterial',
    unidade: 'mmHg',
    casas: 0,
    valor: () => null,
    texto: (c) => {
      const pas = m(c, 'BLOOD_PRESSURE_SYSTOLIC');
      const pad = m(c, 'BLOOD_PRESSURE_DIASTOLIC');

      return pas !== null && pad !== null ? `${pas}/${pad}` : null;
    },
    leitura: (c) => c.r.pa.leitura,
  },
  { rotulo: 'PAM', unidade: 'mmHg', casas: 0, valor: (c) => c.r.pam.valor, leitura: (c) => c.r.pam.leitura },
  {
    rotulo: 'FC de repouso',
    unidade: 'bpm',
    casas: 0,
    valor: (c) => c.r.fcRepouso.valor,
    leitura: (c) => c.r.fcRepouso.leitura,
  },
  { rotulo: 'VO₂máx', unidade: 'ml/kg/min', casas: 1, valor: (c) => m(c, 'VO2_MAX') },
];

function variacao(atual: number | null, anterior: number | null, casas: number): string | null {
  if (atual === null || anterior === null) return null;

  const diferenca = Math.round((atual - anterior) * 10 ** casas) / 10 ** casas;

  if (diferenca === 0) return '=';

  const absoluto = numeroLegivel(Math.abs(diferenca), casas);

  return diferenca > 0 ? `+${absoluto}` : `−${absoluto}`;
}

/**
 * Histórico mês a mês — pedido do PI em 22/10/2026 ("vão ser feitas todo
 * mês").
 *
 * Matriz: indicador por linha, ficha por coluna, a mais recente à direita —
 * a leitura é da esquerda para a direita, como o tempo. Cada célula traz o
 * valor, a variação contra a ficha anterior e a leitura da tabela NAQUELA
 * data (idade de então).
 *
 * A variação não diz se foi bom: perder peso e perder massa magra têm o
 * mesmo sinal e sentidos opostos. Quem diz é a leitura, no tom da faixa.
 */
export function HistoricoDeAvaliacoes({ avaliacoes, nascimento, sexo, fuso }: Props) {
  if (avaliacoes.length === 0) {
    return (
      <EmptyState
        title="Nenhuma avaliação publicada ainda"
        testId="historico-vazio"
        hint="Publique a primeira ficha na aba Nova avaliação. Cada mês vira uma coluna aqui, lado a lado."
      />
    );
  }

  const colunas: Coluna[] = avaliacoes.slice(-MAXIMO_DE_COLUNAS).map((avaliacao) => {
    const medidas = avaliacao.medidas;
    const entradas = {
      pesoKg: medidas['WEIGHT'] ?? null,
      estaturaCm: medidas['HEIGHT'] ?? null,
      cinturaCm: medidas['WAIST_CIRCUMFERENCE'] ?? null,
      quadrilCm: medidas['HIP_CIRCUMFERENCE'] ?? null,
      gorduraPct: medidas['BODY_FAT_PERCENT'] ?? null,
      pas: medidas['BLOOD_PRESSURE_SYSTOLIC'] ?? null,
      pad: medidas['BLOOD_PRESSURE_DIASTOLIC'] ?? null,
      fcRepouso: medidas['HEART_RATE'] ?? null,
      vo2max: medidas['VO2_MAX'] ?? null,
    };
    const perfil = { sexo, idade: idadeEm(nascimento, avaliacao.assessedAt) };

    return { avaliacao, r: calcularIndicadores(entradas, perfil) };
  });

  // Linha sem nenhum valor em nenhuma coluna não informa nada: some.
  const linhas = LINHAS.filter((linha) =>
    colunas.some((c) => (linha.texto ? linha.texto(c) : linha.valor(c)) !== null),
  );

  return (
    <div className={estilos['historico']} data-testid="historico-de-avaliacoes">
      <div className={estilos['rolagem']} tabIndex={0} aria-label="Histórico, role para os lados">
        <table className={estilos['matriz']}>
          <caption className={estilos['legenda-tabela']}>
            {avaliacoes.length > MAXIMO_DE_COLUNAS
              ? `As ${MAXIMO_DE_COLUNAS} avaliações mais recentes de ${avaliacoes.length}`
              : `${avaliacoes.length} ${avaliacoes.length === 1 ? 'avaliação publicada' : 'avaliações publicadas'}`}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={estilos['canto']}>
                Indicador
              </th>
              {colunas.map((c, i) => (
                <th
                  key={c.avaliacao.id}
                  scope="col"
                  data-atual={i === colunas.length - 1 ? 'true' : undefined}
                >
                  <TenantDateTime iso={c.avaliacao.assessedAt} timeZone={fuso} format="date" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.rotulo}>
                <th scope="row">
                  {linha.rotulo}
                  {linha.unidade ? <span className={estilos['unidade-linha']}>{linha.unidade}</span> : null}
                </th>
                {colunas.map((c, i) => {
                  const valor = linha.valor(c);
                  const texto = linha.texto ? linha.texto(c) : valor === null ? null : numeroLegivel(valor, linha.casas);
                  const leitura = texto === null ? null : (linha.leitura?.(c) ?? null);
                  const anterior = i > 0 ? colunas[i - 1]! : null;
                  const delta =
                    linha.texto || anterior === null ? null : variacao(valor, linha.valor(anterior), linha.casas);

                  return (
                    <td
                      key={c.avaliacao.id}
                      data-tom={leitura?.tom}
                      data-atual={i === colunas.length - 1 ? 'true' : undefined}
                    >
                      {texto === null ? (
                        <span className={estilos['ausente']} aria-label="não medido">
                          —
                        </span>
                      ) : (
                        <>
                          {/*
                            Variação NA LINHA do valor, à esquerda dele: os números
                            seguem alinhados à direita e a classificação fica sempre
                            na segunda linha, com ou sem ficha anterior (pedido do PI).
                          */}
                          <span className={estilos['linha-valor']}>
                            {delta !== null ? (
                              <span
                                className={estilos['delta']}
                                aria-label={`variação contra a ficha anterior: ${delta}`}
                              >
                                {delta}
                              </span>
                            ) : null}
                            <span className={estilos['celula-valor']}>{texto}</span>
                          </span>
                          {leitura ? <span className={estilos['celula-classe']}>{leitura.classe}</span> : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={estilos['nota']}>
        Variação contra a ficha anterior. A leitura de cada coluna usa a idade do aluno naquela
        data. Referência, não diagnóstico.
      </p>
    </div>
  );
}
