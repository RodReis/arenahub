import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';

interface Perfil {
  id: string;
  email: string;
}

/**
 * Portao da area autenticada.
 *
 * A verificacao acontece NO SERVIDOR, contra a API. Esconder link no
 * cliente nao protege nada -- quem digita a URL chega igual. Aqui, sem
 * sessao valida, a pagina nem chega a renderizar.
 */
export default async function LayoutProtegido({ children }: { children: ReactNode }) {
  const resposta = await chamarApi<Perfil>('/api/v1/auth/me');

  if (!resposta.ok || !resposta.dados) redirect('/login');

  return (
    <div>
      <header>
        {/*
          A ordem é a do turno: primeiro o que diz se a catraca está de pé,
          depois a investigação, depois o cadastro. Quem abre o painel com uma
          pessoa esperando na porta não deveria procurar o link.
        */}
        <nav aria-label="Navegacao principal">
          <a href="/operations">Operação</a>
          <a href="/access-events">Eventos de acesso</a>
          <a href="/access/override">Liberação manual</a>
          <a href="/operations/devices">Dispositivos</a>
          <a href="/units">Unidades</a>
        </nav>
        <div>
          <span data-testid="usuario-logado">{resposta.dados.email}</span>
          <form action={sair}>
            <button type="submit">Sair</button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
