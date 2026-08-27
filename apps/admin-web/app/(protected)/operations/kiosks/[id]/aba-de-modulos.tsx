'use client';

import type { KioskConfig } from '@arenahub/api-contracts';

import estilos from './formulario-de-configuracao.module.css';

/**
 * Modulos que a aba EXIBE, com a fatia que alimenta cada um.
 *
 * TRAVA 2 do ADR-042, Decisao 5: modulo cuja fatia de origem nao foi
 * entregue NAO APARECE -- nao aparece cinza, nao aparece desabilitado: nao
 * existe.
 *
 * `ranking` ENTRA na F30 (ADR-046). Ate 26/08/2026 este comentario dizia
 * que a dona seria a F33 e que ela acrescentaria a linha; a F30 chegou
 * antes e e quem alimenta o modulo -- ela entrega a tela de PREFERENCIA de
 * exposicao (aparecer ou nao no ranking, e com que nome). O placar em si
 * continua sendo F33, e nao muda nada aqui quando chegar: o modulo ja
 * estara ligavel.
 */
const MODULOS_DISPONIVEIS = [
  {
    campo: 'pagamento',
    rotulo: 'Pagamento',
    descricao: 'Pagar fatura em aberto pelo totem, por QR.',
  },
  {
    campo: 'historicoDePagamentos',
    rotulo: 'Histórico de pagamentos',
    descricao: 'Últimas faturas, com estado e data de pagamento.',
  },
  {
    campo: 'avaliacao',
    rotulo: 'Avaliação do mês',
    descricao: 'Resumo da última avaliação já confirmada na recepção.',
  },
  {
    campo: 'evolucao',
    rotulo: 'Acompanhamento da evolução',
    descricao: 'Comparação resumida com a medição anterior.',
  },
  {
    campo: 'historicoDeAvaliacoes',
    rotulo: 'Histórico de avaliações',
    descricao: 'Uma linha por mês medido, somente leitura.',
  },
  {
    campo: 'ranking',
    rotulo: 'Minhas preferências',
    descricao: 'Aparecer ou não no ranking, e com que nome. O placar em si vem depois.',
  },
] as const satisfies readonly {
  campo: keyof KioskConfig['modulos'];
  rotulo: string;
  descricao: string;
}[];

/**
 * Aba Modulos -- F52, ADR-042 Decisao 5.
 *
 * Desligar aqui NAO esconde botao: remove a etapa do fluxo E o endpoint
 * correspondente para aquele dispositivo (trava 1, `M3.5-FR-007`). A frase
 * abaixo da lista diz isso ao gerente, porque "escondi o botao" e
 * "desliguei a funcao" tem consequencias diferentes quando alguem abre o
 * devtools do totem.
 */
export function AbaDeModulos({
  rascunho,
  aoMudarModulos,
}: {
  readonly rascunho: KioskConfig;
  readonly aoMudarModulos: (modulos: KioskConfig['modulos']) => void;
}) {
  const alternar = (campo: keyof KioskConfig['modulos'], ligado: boolean) => {
    aoMudarModulos({ ...rascunho.modulos, [campo]: ligado });
  };

  return (
    <div className={estilos['secao']}>
      <ul className={estilos['listaDeModulos']}>
        {MODULOS_DISPONIVEIS.map(({ campo, rotulo, descricao }) => (
          <li key={campo} className={estilos['modulo']}>
            <div className={estilos['campoBooleano']}>
              <input
                id={`modulo-${campo}`}
                type="checkbox"
                checked={rascunho.modulos[campo]}
                onChange={(e) => alternar(campo, e.target.checked)}
                data-testid={`campo-modulo-${campo}`}
              />
              <label htmlFor={`modulo-${campo}`}>{rotulo}</label>
            </div>
            <p className={estilos['dica']}>{descricao}</p>
          </li>
        ))}
      </ul>

      {/*
        A FRASE QUE O ADR EXIGE, palavra por palavra no sentido: desligar
        remove a ETAPA, nao o botao.
      */}
      <p className={estilos['dica']}>
        Desligar um módulo remove a ação da tela interna e a etapa correspondente do fluxo — não
        apenas esconde o botão. O totem também deixa de conseguir buscar esses dados.
      </p>
    </div>
  );
}
