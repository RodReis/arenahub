import { Ausente } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * Card "Metas e controle" -- as recomendações que o APARELHO calculou.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO É META DO ALUNO, E A DIFERENÇA IMPORTA (INV-151, ADR-038).
 * ---------------------------------------------------------------------------
 *
 * Peso padrão, os três "controles" e a ingestão recomendada são fórmula
 * proprietária da balança, não medição e não meta acordada. Por isso vivem em
 * `BodyAssessment.deviceReport` (JSON opaco), fora do gráfico de evolução:
 * firmware novo muda a fórmula, e comparar mês a mês produziria uma tendência
 * que nunca aconteceu no corpo do aluno.
 *
 * A meta OFICIAL do aluno é a da F20 (`HealthGoal`) -- tem baseline, alvo e
 * responsável. Este card é sugestão de equipamento, e o rodapé diz isso na
 * cara de quem lê, porque um número sem procedência vira prescrição na boca
 * de quem atende.
 *
 * Nenhuma linha deste arquivo DECIDE nada em cima destes valores: só formata
 * e exibe. É a mesma disciplina do `ecgFinding` (ADR-035).
 */

/** As cinco chaves que o extrator grava em `deviceReport`. */
interface Recomendacao {
  readonly chave: string;
  readonly rotulo: string;
  readonly unidade: 'kg' | 'kcal';
}

/**
 * Ordem da referência visual, não alfabética: peso padrão primeiro (é o
 * ponto de chegada), depois os três controles (o caminho até ele), e a
 * ingestão por último (o meio).
 */
const RECOMENDACOES: readonly Recomendacao[] = [
  { chave: 'deviceStandardWeightKg', rotulo: 'Peso padrão', unidade: 'kg' },
  { chave: 'deviceWeightControlKg', rotulo: 'Controle de peso', unidade: 'kg' },
  { chave: 'deviceFatControlKg', rotulo: 'Controle de gordura', unidade: 'kg' },
  { chave: 'deviceMuscleControlKg', rotulo: 'Controle muscular', unidade: 'kg' },
  { chave: 'deviceRecommendedIntakeKcal', rotulo: 'Ingestão recomendada', unidade: 'kcal' },
];

/**
 * Formata o valor com a unidade.
 *
 * `kcal` ganha `/dia` porque a ingestão é diária -- "2.437 kcal" sozinho
 * poderia ser lido como total do período. Os controles preservam o SINAL
 * (`−10,1 kg`): sem ele, "10,1 kg de controle de peso" não diz se é para
 * ganhar ou perder, que é justamente a informação.
 */
function valorLegivel(valor: number, unidade: Recomendacao['unidade']): string {
  const numero = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: unidade === 'kcal' ? 0 : 1,
    maximumFractionDigits: unidade === 'kcal' ? 0 : 1,
    signDisplay: unidade === 'kcal' ? 'auto' : 'exceptZero',
  }).format(valor);

  return unidade === 'kcal' ? `${numero} kcal/dia` : `${numero} kg`;
}

interface Props {
  /**
   * `deviceReport` da avaliação -- OPACO. Só as cinco chaves conhecidas são
   * lidas; qualquer outra coisa que o aparelho tenha reportado (achado de
   * ECG, índices) é ignorada aqui, não exibida por acidente.
   */
  readonly deviceReport?: Record<string, unknown> | null | undefined;
}

export function MetasEControle({ deviceReport }: Props) {
  const presentes = RECOMENDACOES.filter(
    (item) => typeof deviceReport?.[item.chave] === 'number',
  );

  // Laudo que não trouxe NENHUMA recomendação não rende um card vazio com
  // cinco traços -- ele simplesmente não aparece. Card só com ausência ocupa
  // a coluna sem informar nada.
  if (presentes.length === 0) return null;

  return (
    <section className={estilos['painel']} aria-labelledby="titulo-metas-controle">
      <h2 id="titulo-metas-controle">Metas e controle</h2>

      <dl className={estilos['listaDeRecomendacoes']} data-testid="metas-e-controle">
        {RECOMENDACOES.map((item) => {
          const valor = deviceReport?.[item.chave];

          return (
            <div key={item.chave}>
              <dt>{item.rotulo}</dt>
              <dd data-testid={`recomendacao-${item.chave}`}>
                {typeof valor === 'number' ? (
                  valorLegivel(valor, item.unidade)
                ) : (
                  <Ausente />
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className={estilos['avisoDoAparelho']}>
        Valores calculados pelo equipamento. Ajustes de dieta e treino são do avaliador físico.
      </p>
    </section>
  );
}
