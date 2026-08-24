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

interface Unidade {
  id: string;
  name: string;
  status: string;
}

/**
 * Portao da area autenticada.
 *
 * A verificacao acontece NO SERVIDOR, contra a API. Esconder link no
 * cliente nao protege nada -- quem digita a URL chega igual. Aqui, sem
 * sessao valida, a pagina nem chega a renderizar.
 */
export default async function LayoutProtegido({ children }: { children: ReactNode }) {
  /*
   * As duas consultas vao juntas: o perfil decide se a pessoa entra, e as
   * unidades alimentam o indicador do topbar. Em serie, toda navegacao
   * pagaria os dois tempos de rede.
   *
   * Falha ao buscar unidade NAO derruba o painel -- o indicador cai para o
   * texto de ausencia e o resto da tela funciona.
   */
  const [resposta, respostaDeUnidades] = await Promise.all([
    chamarApi<Perfil>('/api/v1/auth/me'),
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  if (!resposta.ok || !resposta.dados) redirect('/login');

  const unidades = (respostaDeUnidades.dados ?? []).filter(
    (unidade) => unidade.status === 'ACTIVE',
  );

  /*
   * O QUE O TOPBAR MOSTRA, e por que não é "Unidade não selecionada".
   *
   * Aquele texto vinha de quando o painel não consultava unidade nenhuma --
   * e continuava aparecendo com a Matriz cadastrada, dizendo à recepção que
   * faltava escolher algo que não havia onde escolher.
   *
   * Com UMA unidade ativa não há o que selecionar: ela É o contexto, e o
   * honesto é nomeá-la. Com várias, o painel ainda não sabe qual está em uso
   * -- a TROCA exige decisão de produto sobre persistência e escopo de
   * sessão (DS-PAINEL §5), e até lá dizer "várias unidades" é mais verdadeiro
   * que fingir uma escolha. Sem nenhuma, o texto vira convite a cadastrar.
   */
  const unidadeNoTopbar =
    unidades.length === 1
      ? (unidades[0]?.name ?? 'Unidade sem nome')
      : unidades.length === 0
        ? 'Nenhuma unidade cadastrada'
        : `${unidades.length} unidades`;

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
        sobre persistencia e escopo de sessao (DS-PAINEL.md §5) -- o que
        mudou e que o indicador agora DIZ QUAL unidade, em vez de repetir
        "nao selecionada" com a Matriz cadastrada. Ver `unidadeNoTopbar`.
      */
      unitSelector={<span data-testid="unidade-ativa">{unidadeNoTopbar}</span>}
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
