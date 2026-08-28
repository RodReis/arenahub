import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import type {
  DesafioDaListagemDto,
  TemplateDeDesafioDto,
} from '../../../actions/engagement';
import { PainelDeDesafios } from './painel-de-desafios';

export const metadata: Metadata = {
  title: 'Desafios — ArenaHub',
};

/** Sem cache: a secretaria cria e abre na mesma sessao. */
export const dynamic = 'force-dynamic';

interface Unidade {
  id: string;
  name: string;
}

/**
 * Desafios -- F34, Slice 5.5, ADR-048.
 *
 * Server Component: busca os modelos vigentes e as unidades. Criar e abrir
 * sao Server Actions disparadas do lado cliente.
 *
 * A LISTAGEM EXISTE, e a primeira versao desta tela nao a tinha -- defeito
 * relatado pelo PI em 28/08/2026. Sem ela, o desafio criado sumia no refresh
 * (o estado vivia so na sessao do React) e ficava INALCANCAVEL para abrir: o
 * dado estava no banco, mas nao havia caminho ate ele. Uma tela que perde o
 * que acabou de criar parece que nao salvou.
 *
 * Segue fora de escopo o painel de OPERACAO da Slice 5.6 -- cancelar,
 * contestar, recalcular -- que continua atras do gate do MVP 5.
 */
export default async function PaginaDeDesafios() {
  const [modelos, unidades, existentes] = await Promise.all([
    chamarApi<{ itens: TemplateDeDesafioDto[] }>('/api/v1/engagement/challenges/templates'),
    chamarApi<Unidade[]>('/api/v1/units'),
    chamarApi<{ itens: DesafioDaListagemDto[] }>('/api/v1/engagement/challenges'),
  ]);

  if (!modelos.ok || !modelos.dados) {
    return (
      <section aria-labelledby="titulo-desafios">
        <h1 id="titulo-desafios">Desafios</h1>
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
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-desafios">
      <h1 id="titulo-desafios">Desafios</h1>

      <p>
        Crie um desafio a partir de um modelo, escolhendo o período e a meta. O modelo define o
        limite de treinos por semana — uma meta acima dele é recusada. O desafio nasce fechado:
        abra a inscrição quando estiver conferido, e só então ele aparece no totem para os
        alunos.
      </p>

      <PainelDeDesafios
        modelos={modelos.dados.itens}
        unidades={unidades.ok && unidades.dados ? unidades.dados : []}
        existentes={existentes.ok && existentes.dados ? existentes.dados.itens : []}
      />
    </section>
  );
}
