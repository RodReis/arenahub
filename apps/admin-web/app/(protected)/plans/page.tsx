import type { Metadata } from 'next';

import { chamarApi } from '../../../lib/api/server-client';
import { janelaLegivel } from '../../../src/students/formatar';
import { FormularioDePlano } from './formulario-de-plano';

export const metadata: Metadata = {
  title: 'Planos — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Janela {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Plano {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  gymUnitIds: string[];
  janelas: Janela[];
}

interface Unidade {
  id: string;
  name: string;
}

/**
 * Planos — Slice 1.2.
 *
 * O plano define ONDE e QUANDO o acesso vale. Preço não aparece aqui: o
 * modelo não tem campo monetário no MVP 1, e cobrança entra no MVP 2 (F12).
 */
export default async function PaginaDePlanos() {
  const [respostaDosPlanos, respostaDasUnidades] = await Promise.all([
    chamarApi<Plano[]>('/api/v1/plans'),
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  if (!respostaDosPlanos.ok) {
    return (
      <section aria-labelledby="titulo-planos">
        <h1 id="titulo-planos">Planos</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para consultar planos ({respostaDosPlanos.erro?.code ?? 'erro'}).
        </p>
      </section>
    );
  }

  const planos = respostaDosPlanos.dados ?? [];
  const unidades = respostaDasUnidades.dados ?? [];

  const nomeDaUnidade = (unidadeId: string): string =>
    unidades.find((unidade) => unidade.id === unidadeId)?.name ?? unidadeId;

  return (
    <section aria-labelledby="titulo-planos">
      <h1 id="titulo-planos">Planos</h1>

      {/*
        Sem unidades, o formulário de criação não tem o que selecionar e a
        tabela mostra UUID no lugar do nome. Falha silenciosa aqui pareceria
        "academia sem unidade cadastrada", que é outro problema e outra ação.
      */}
      {!respostaDasUnidades.ok ? (
        <p role="alert" data-testid="unidades-indisponiveis">
          Não foi possível carregar as unidades ({respostaDasUnidades.erro?.code ?? 'erro'}).
          Recarregue a página antes de criar ou conferir planos.
        </p>
      ) : null}

      {planos.length === 0 ? (
        <p data-testid="sem-planos-cadastrados">
          Nenhum plano cadastrado ainda. Crie o primeiro no formulário abaixo.
        </p>
      ) : (
        <table data-testid="tabela-de-planos">
          <caption>Planos cadastrados, em ordem alfabética</caption>
          <thead>
            <tr>
              <th scope="col">Plano</th>
              <th scope="col">Situação</th>
              <th scope="col">Unidades</th>
              <th scope="col">Janelas de horário</th>
            </tr>
          </thead>
          <tbody>
            {planos.map((plano) => (
              <tr key={plano.id} data-testid={`plano-${plano.id}`}>
                <td>
                  {plano.name}
                  {plano.description ? <small> — {plano.description}</small> : null}
                </td>
                {/* Todo estado tem TEXTO: "Inativo" some se for só uma cor. */}
                <td>{plano.isActive ? 'Ativo' : 'Inativo'}</td>
                <td>
                  <ul>
                    {plano.gymUnitIds.map((unidadeId) => (
                      <li key={unidadeId}>{nomeDaUnidade(unidadeId)}</li>
                    ))}
                  </ul>
                </td>
                <td>
                  <ul>
                    {plano.janelas.map((janela, indice) => (
                      <li
                        key={`${janela.gymUnitId}-${janela.dayOfWeek}-${janela.startMinute}-${indice}`}
                      >
                        {nomeDaUnidade(janela.gymUnitId)} — {janelaLegivel(janela)}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section aria-labelledby="titulo-novo-plano">
        <h2 id="titulo-novo-plano">Criar plano</h2>
        <FormularioDePlano unidades={unidades} />
      </section>
    </section>
  );
}
