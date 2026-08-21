import { Ausente } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * Painel de análise à direita da revisão -- Task 9.
 *
 * Regra 3 do brief (ADR-035 e decisão 2 do PI): o achado do ECG é TEXTO
 * atribuído ao aparelho, nunca cartão de encaminhamento, alerta ou ação
 * pendente. O ArenaHub armazena e cita, nunca interpreta -- por isso não há
 * botão nenhum aqui, só a frase e a atribuição.
 *
 * O rótulo é "Sugerido pelo aparelho", nunca "Metas": misturar os dois
 * confundiria a sugestão do fabricante com a meta que o profissional definiu.
 */

export interface AtributosDoAparelho {
  readonly ecgFinding?: string | null;
  readonly suggestedTargets?: readonly { readonly label: string; readonly value: string }[];
}

interface Props {
  readonly atributos: AtributosDoAparelho;
}

export function PainelDeAnalise({ atributos }: Props) {
  const { ecgFinding, suggestedTargets = [] } = atributos;

  return (
    <aside className={estilos['painel']} aria-labelledby="titulo-painel-analise">
      <h2 id="titulo-painel-analise">Análise</h2>

      <div className={estilos['blocoAparelho']}>
        <p className={estilos['rotuloDoAparelho']}>Achado do ECG</p>
        {ecgFinding ? (
          <p data-testid="achado-ecg">
            {ecgFinding} <em>— relatado pelo aparelho</em>
          </p>
        ) : (
          <p data-testid="achado-ecg-ausente">
            <Ausente /> nenhum achado relatado pelo aparelho
          </p>
        )}
      </div>

      {suggestedTargets.length > 0 ? (
        <div className={estilos['blocoAparelho']}>
          <p className={estilos['rotuloDoAparelho']}>Sugerido pelo aparelho</p>
          <ul>
            {suggestedTargets.map((alvo) => (
              <li key={alvo.label}>
                {alvo.label}: {alvo.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
