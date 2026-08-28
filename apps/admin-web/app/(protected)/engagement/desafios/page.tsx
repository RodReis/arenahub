import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import type { TemplateDeDesafioDto } from '../../../actions/engagement';
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
 * NAO HA LISTAGEM DE DESAFIOS CRIADOS nesta fatia, e a ausencia e
 * deliberada: a Slice 5.5 pede criacao a partir de template, inscricao,
 * progresso e encerramento -- o painel de OPERACAO (listar, cancelar,
 * contestar) e a Slice 5.6, que segue atras do gate do MVP 5. A tela mostra
 * o desafio recem-criado da propria sessao, com o botao de abrir ao lado.
 */
export default async function PaginaDeDesafios() {
  const [modelos, unidades] = await Promise.all([
    chamarApi<{ itens: TemplateDeDesafioDto[] }>('/api/v1/engagement/challenges/templates'),
    chamarApi<Unidade[]>('/api/v1/units'),
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
      />
    </section>
  );
}
