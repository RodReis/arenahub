import { AppShell, Button } from '@arenahub/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';
import { Navegacao } from './navegacao';

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
  /*
    "Liberação manual" SAIU do menu na issue #118: virou o botão "Liberar" na
    grade de Alunos, direto na linha de quem está BLOCKED -- um clique em vez
    de abrir a tela, escolher unidade e catraca e preencher motivo. A rota
    `/access/override` continua existindo (a liberação de CATRACA física é
    caso diferente, ver `botao-de-liberacao.tsx`), só não tem mais item fixo
    no menu.
  */
  { href: '/students', label: 'Alunos' },
  { href: '/plans', label: 'Planos' },
  /*
    Depois de Planos porque cobranca e consequencia da assinatura -- a recepcao
    chega aqui vinda de "quem esta devendo?", nao de "que planos existem?".
  */
  { href: '/billing/delinquency', label: 'Cobrança' },
  /*
    Depois de Cobranca, e nao dentro dela: sao publicos diferentes. Cobranca e
    a recepcao perguntando "quem esta devendo?"; Conciliacao e quem fecha o mes
    perguntando "o extrato bate?". Aninhar a segunda na primeira esconderia a
    conferencia mensal atras de uma tela de uso diario.
  */
  { href: '/billing/reconciliation', label: 'Conciliação' },
  /*
    ADMINISTRAÇÃO -- decisão do PI em 24/08/2026.

    Dispositivos e Unidades são CONFIGURAÇÃO: a recepção os abre uma vez por
    mês, enquanto abre Alunos a cada atendimento. Com nove itens de peso
    idêntico, os dois disputavam o olho com o que se usa o dia inteiro.

    Dispositivos vinha logo depois de "Eventos de acesso" -- perto do que a
    operação usa, longe do que ele é. Agrupar os dois no fim separa o uso
    diário do uso raro sem esconder nenhum: continuam a um clique.
  */
  { href: '/operations/devices', label: 'Dispositivos', grupo: 'Administração' },
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

  // O `ToastProvider` subiu para o layout raiz: a tela de login tambem
  // precisa dele, e ela fica fora de `(protected)`.
  return (
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

          `Navegacao` é o único pedaço cliente do shell, e existe porque ler o
          pathname no servidor não é suportado pelo Next -- e porque layout
          não re-renderiza na navegação, então uma rota passada daqui ficaria
          congelada na tela de entrada.
        */
        <Navegacao itens={NAVEGACAO} />
      }
    >
      {children}
    </AppShell>
  );
}
