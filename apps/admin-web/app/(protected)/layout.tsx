import { AppShell, Button, NavLink, ToastProvider } from '@arenahub/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';

interface Perfil {
  id: string;
  email: string;
}

/**
 * A ordem e a do turno: primeiro o que diz se a catraca esta de pe, depois a
 * investigacao, depois o cadastro.
 */
const NAVEGACAO = [
  { href: '/operations', label: 'Operação' },
  { href: '/access-events', label: 'Eventos de acesso' },
  { href: '/access/override', label: 'Liberação manual' },
  { href: '/operations/devices', label: 'Dispositivos' },
  { href: '/students', label: 'Alunos' },
  { href: '/plans', label: 'Planos' },
  { href: '/units', label: 'Unidades' },
] as const;

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
    <ToastProvider>
      <AppShell
        /*
          `navLabel` sem acento: o E2E que ja roda na `main` procura
          `getByRole('navigation', { name: 'Navegacao principal' })`. Esta
          fatia muda aparencia, nao comportamento -- corrigir a grafia dos dois
          lados junto e card separado.
        */
        navLabel="Navegacao principal"
        /*
          Indicador de unidade, nao seletor. A TROCA exige decisao de produto
          sobre persistencia e escopo de sessao (DS-PAINEL.md §5); enquanto ela
          nao existe, a ausencia fica visivel em vez de silenciosa.
        */
        unitSelector={<span data-testid="unidade-ativa">Unidade não selecionada</span>}
        user={
          <>
            <span data-testid="usuario-logado">{resposta.dados.email}</span>
            <form action={sair}>
              <Button type="submit" variant="ghost">
                Sair
              </Button>
            </form>
          </>
        }
        nav={
          /*
            A ordem é a do turno: primeiro o que diz se a catraca está de pé,
            depois a investigação, depois o cadastro. Quem abre o painel com uma
            pessoa esperando na porta não deveria procurar o link.
          */
          NAVEGACAO.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))
        }
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
