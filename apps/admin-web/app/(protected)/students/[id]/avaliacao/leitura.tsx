import type { ReactNode } from 'react';

import { PainelDeEstado } from '@arenahub/ui';

import type { Indicador } from '../../../../../src/health/indicadores';
import estilos from './avaliacao.module.css';
import { Regua } from './regua';

interface Props {
  /** Número do item na folha de indicadores do PI (1 a 14) — o professor confere pelo papel. */
  readonly numero: number;
  /** Sigla da tabela (IMC, RCE...). */
  readonly rotulo: string;
  readonly nome: string;
  /** Já formatado: "24,7", "120/80" ou "—". */
  readonly valor: string;
  readonly unidade?: string;
  readonly indicador: Indicador;
  /** Formato dos marcos da régua. Sem ele, não há régua. */
  readonly formatar?: (valor: number) => string;
  /** Observação da folha ao lado da leitura ("uma única medida não diagnostica…"). */
  readonly ressalva?: string;
  /** Números de apoio dentro do cartão (MG e MLG no %GC). */
  readonly complemento?: ReactNode;
  /** O que falta digitar para o indicador existir. */
  readonly vazio: string;
  readonly testId: string;
}

/**
 * Um indicador da ficha: número grande, a leitura da tabela e a régua.
 *
 * Sem selo de ícone: numa grade da mesma família ele repetia o mesmo glifo
 * em todo cartão (revisão de acabamento da F91).
 *
 * Sem valor, o painel fica neutro e diz o que falta — nunca um zero, nunca
 * uma faixa "padrão" (DS: dado ausente não é zero).
 */
export function Leitura({
  numero,
  rotulo,
  nome,
  valor,
  unidade,
  indicador,
  formatar,
  ressalva,
  complemento,
  vazio,
  testId,
}: Props) {
  const { leitura, regua } = indicador;
  const preenchido = indicador.valor !== null;

  return (
    <PainelDeEstado
      rotulo={`${numero}. ${rotulo} · ${nome}`}
      tom={leitura?.tom ?? 'neutral'}
      emAlerta={leitura?.alerta === true}
      testId={testId}
      apoio={
        <div className={estilos['apoio']}>
          <p className={estilos['classe']} data-vazio={preenchido ? undefined : 'true'}>
            {preenchido ? leitura?.classe : vazio}
          </p>
          {regua && formatar ? (
            <Regua
              regua={regua}
              valor={indicador.naRegua === undefined ? indicador.valor : indicador.naRegua}
              formatar={formatar}
            />
          ) : null}
          {leitura && ressalva ? <p className={estilos['ressalva']}>{ressalva}</p> : null}
          {complemento}
        </div>
      }
    >
      {/* `strong` é o que o painel desenha em tamanho de display; o resto vira legenda. */}
      <strong className={estilos['valor']} data-vazio={preenchido ? undefined : 'true'}>
        {valor}
      </strong>
      {unidade && preenchido ? <span>{unidade}</span> : null}
    </PainelDeEstado>
  );
}
