import type { Metadata } from 'next';

import { chamarApi } from '../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Unidades — ArenaHub',
};

interface Unidade {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
}

/**
 * Server Component: a lista e buscada no servidor e chega pronta. Sem
 * estado de carregamento no cliente, sem token exposto ao navegador.
 */
export default async function PaginaDeUnidades() {
  const resposta = await chamarApi<Unidade[]>('/api/v1/units');

  if (!resposta.ok) {
    // Negacao explicita, com o codigo estavel visivel. Tela vazia deixaria
    // o operador sem saber se nao ha unidade ou se ele nao tem permissao.
    return (
      <section aria-labelledby="titulo-unidades">
        <h1 id="titulo-unidades">Unidades</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissao para ver as unidades ({resposta.erro?.code}).
        </p>
      </section>
    );
  }

  const unidades = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-unidades">
      <h1 id="titulo-unidades">Unidades</h1>

      {unidades.length === 0 ? (
        <p data-testid="lista-vazia">Nenhuma unidade cadastrada ainda.</p>
      ) : (
        <table data-testid="tabela-de-unidades">
          <caption>Unidades da sua academia</caption>
          <thead>
            <tr>
              <th scope="col">Codigo</th>
              <th scope="col">Nome</th>
              <th scope="col">Fuso horario</th>
              <th scope="col">Situacao</th>
            </tr>
          </thead>
          <tbody>
            {unidades.map((unidade) => (
              <tr key={unidade.id}>
                <td>{unidade.code}</td>
                <td>{unidade.name}</td>
                <td>{unidade.timezone}</td>
                {/* Texto, nao so cor: `M1-NFR-008` exige WCAG 2.2 AA, e cor
                    sozinha nao informa quem nao a distingue. */}
                <td>{unidade.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
