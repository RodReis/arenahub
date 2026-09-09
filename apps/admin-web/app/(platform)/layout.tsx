import { AppShell, Button, NavLink } from '@arenahub/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';

interface Perfil {
  id: string;
  email: string;
}

/**
 * Portão da superfície do dono do SaaS.
 *
 * GRUPO PRÓPRIO, fora de `(protected)`, e não é preferência de organização: o
 * layout protegido chama `/api/v1/units`, que exige tenant, e o Super Admin
 * não está em tenant nenhum -- a chamada recusaria e o painel inteiro
 * redirecionaria para o login. Aqui só `/auth/me` é consultado, que vale para
 * sessão de plataforma tanto quanto para sessão de tenant.
 *
 * A VERIFICAÇÃO DE VERDADE é do servidor: `@PlatformRoute()` recusa quem não é
 * dono do SaaS em toda rota `/api/v1/platform/*`. Isto aqui só evita renderizar
 * uma tela que a API vai negar de qualquer jeito.
 *
 * TRÊS ITENS na navegação: academias, planos e o histórico do índice (F63).
 * Sem seletor de unidade pelo mesmo motivo do parágrafo acima -- não há tenant,
 * logo não há unidade a escolher.
 *
 * Os contratos NÃO têm item próprio: eles são de UMA academia, e se alcançam
 * pelo detalhe dela. Um item de menu levaria a uma lista de contratos sem dono,
 * que ninguém pediu.
 */
export default async function LayoutDePlataforma({ children }: { children: ReactNode }) {
  const resposta = await chamarApi<Perfil>('/api/v1/auth/me');

  if (!resposta.ok || !resposta.dados) redirect('/login');

  return (
    <AppShell
      navLabel="Navegacao da plataforma"
      unitSelector={null}
      nav={
        <>
          <NavLink href="/platform" label="Academias" current />
          <NavLink href="/platform/planos" label="Planos SaaS" />
          <NavLink href="/platform/indices" label="Histórico do índice" />
        </>
      }
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
    >
      {children}
    </AppShell>
  );
}
