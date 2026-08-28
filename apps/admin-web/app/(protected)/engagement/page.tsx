import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { Abas } from '../../../src/components/abas';
import { chamarApi } from '../../../lib/api/server-client';
import type {
  DesafioDaListagemDto,
  TemplateDeDesafioDto,
} from '../../actions/engagement';
import { PainelDeDesafios } from './desafios/painel-de-desafios';
import { PainelDoPlacar } from './placar/painel-do-placar';

export const metadata: Metadata = {
  title: 'Engajamento — ArenaHub',
};

/** Sem cache: a secretaria cria, abre e gera na mesma sessão. */
export const dynamic = 'force-dynamic';

interface Unidade {
  id: string;
  name: string;
  /**
   * O placar exibe `publishedAt` e precisa do fuso da unidade ESCOLHIDA --
   * regra 5 de lint (`DS-PAINEL.md` §11): nunca `toLocaleString()` sem
   * timezone.
   */
  timezone: string;
}

/**
 * Engajamento no totem — placar, XP e desafios numa tela só.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ABAS, E NÃO TRÊS ITENS DE MENU.
 * ---------------------------------------------------------------------------
 *
 * Pedido do PI em 28/08/2026: *"vamos colocar o que for do totem no Menu
 * Totem, vamos criar abas para Placar e Xp e Desafios"*.
 *
 * As três telas configuram a MESMA superfície (o que o aluno vê no totem) e
 * são operadas na mesma sessão — abrir um desafio e conferir o placar do mês
 * é um trabalho só. Três itens de menu para um trabalho só é o que empurrava
 * o menu para baixo e obrigava a recepção a caçar qual dos três era o certo.
 *
 * O `PRODUCT.md` diz que a ordem do menu é *"a do turno"*: o que responde
 * primeiro fica em cima. Engajamento não é da urgência do balcão — é
 * configuração de campanha, uso esporádico —, por isso vive em Totem e não
 * na altura de Operação.
 *
 * ---------------------------------------------------------------------------
 * O CONTEÚDO VEM PRONTO DO SERVIDOR.
 * ---------------------------------------------------------------------------
 *
 * `Abas` é client e não busca nada: as três consultas acontecem aqui, em
 * paralelo, e descem por prop. Buscar dentro da aba faria o dado só carregar
 * quando ela fosse aberta — e as abas ficam todas montadas de propósito
 * (ver o comentário do componente).
 */
export default async function PaginaDeEngajamento() {
  const [modelos, unidades, existentes] = await Promise.all([
    chamarApi<{ itens: TemplateDeDesafioDto[] }>('/api/v1/engagement/challenges/templates'),
    chamarApi<Unidade[]>('/api/v1/units'),
    chamarApi<{ itens: DesafioDaListagemDto[] }>('/api/v1/engagement/challenges'),
  ]);

  const listaDeUnidades = unidades.ok && unidades.dados ? unidades.dados : [];

  return (
    <section aria-labelledby="titulo-engajamento">
      <h1 id="titulo-engajamento">Engajamento no totem</h1>

      <p>
        O que o aluno vê na área dele: o placar do mês e os desafios abertos. Nada aqui aparece no
        totem antes de ser publicado.
      </p>

      <Abas
        rotulo="Seções do engajamento"
        abas={[
          {
            id: 'desafios',
            rotulo: 'Desafios',
            conteudo: modelos.ok && modelos.dados ? (
              <PainelDeDesafios
                modelos={modelos.dados.itens}
                unidades={listaDeUnidades}
                existentes={existentes.ok && existentes.dados ? existentes.dados.itens : []}
              />
            ) : (
              <ProblemDetail
                testId="erro-dos-desafios"
                problem={{
                  ...(modelos.erro ?? {
                    type: 'about:blank',
                    status: 0,
                    code: 'erro',
                    correlationId: '',
                  }),
                  title: `Não foi possível carregar os modelos de desafio (${modelos.erro?.code ?? 'erro'}).`,
                }}
              />
            ),
          },
          {
            id: 'placar',
            rotulo: 'Placar e XP',
            conteudo: listaDeUnidades.length > 0 ? (
              <PainelDoPlacar unidades={listaDeUnidades} />
            ) : (
              <ProblemDetail
                testId="erro-do-placar"
                problem={{
                  ...(unidades.erro ?? {
                    type: 'about:blank',
                    status: 0,
                    code: 'erro',
                    correlationId: '',
                  }),
                  title: `Sem permissão para consultar as unidades (${unidades.erro?.code ?? 'erro'}).`,
                }}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
