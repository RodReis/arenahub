import { AppShell, Button } from '@arenahub/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';
import { Navegacao } from './navegacao';

interface Perfil {
  id: string;
  email: string;
  /**
   * Capacidades do usuario nesta sessao -- F54.
   *
   * NAO E CONTROLE DE ACESSO: quem digitar a URL chega igual, e quem barra
   * continua sendo o `PermissionsGuard` no servidor. Serve para nao OFERECER
   * uma tela que vai recusar a pessoa.
   */
  permissions?: string[];
}

interface ItemDeMenu {
  readonly href: string;
  readonly label: string;
  /** Rotulo do grupo que COMECA neste item. */
  readonly grupo?: string;
  /** Capacidade exigida para o item aparecer (F54). */
  readonly exigePermissao?: string;
}

/**
 * A ordem e a do turno: primeiro o que diz se a catraca esta de pe, depois a
 * investigacao, depois o cadastro.
 *
 * TIPADO como `ItemDeMenu[]` em vez de `as const` puro: com `as const` o TS
 * infere uma UNIAO de literais onde `grupo` so existe nos itens que o
 * declaram, e qualquer leitura generica do campo vira erro de compilacao.
 */
const NAVEGACAO: readonly ItemDeMenu[] = [
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
    FINANCEIRO -- decisao do PI em 25/08/2026, mesmo criterio que criou
    "Administração" no dia anterior.

    As tres telas de dinheiro estavam soltas no meio da lista, e a leitura de
    relance nao dizia que eram a mesma familia: a recepcao lia oito itens de
    peso identico e tinha de reconhecer cada rotulo. Agrupadas, o olho pousa
    numa regiao e so entao escolhe a tela.

    A ORDEM DENTRO DO GRUPO segue a frequencia, nao o organograma: Cobranca e
    diaria, Conciliacao e mensal, Painel e gerencial. Quem abre com o aluno
    esperando encontra o item de uso diario primeiro.
  */
  /*
    Depois de Planos porque cobranca e consequencia da assinatura -- a recepcao
    chega aqui vinda de "quem esta devendo?", nao de "que planos existem?".
  */
  { href: '/billing/delinquency', label: 'Cobrança', grupo: 'Financeiro' },
  /*
    Depois de Cobranca, e nao dentro dela: sao publicos diferentes. Cobranca e
    a recepcao perguntando "quem esta devendo?"; Conciliacao e quem fecha o mes
    perguntando "o extrato bate?". Aninhar a segunda na primeira esconderia a
    conferencia mensal atras de uma tela de uso diario.
  */
  { href: '/billing/reconciliation', label: 'Conciliação' },
  /*
    PAINEL FINANCEIRO -- F54, e o unico item do menu com permissao propria.

    `billing.dashboard` e nova (decisao do PI, SPEC-054 §8): `billing.read` e
    o que a recepcao usa para achar a fatura de um aluno, e o painel consolida
    o tenant inteiro. Por isso este item some para quem so atende no balcao --
    ver `exigePermissao`.

    ⚠️ ELE E O ULTIMO DO GRUPO **e** o unico que some por permissao. Se um dia
    o grupo passar a comecar por um item com `exigePermissao`, o rotulo
    "Financeiro" sumiria junto com ele e os irmaos ficariam orfaos -- o
    `Navegacao` resolve isso reancorando o rotulo no primeiro item VISIVEL,
    nao no primeiro item declarado.
  */
  { href: '/billing', label: 'Painel financeiro', exigePermissao: 'billing.dashboard' },
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
];

interface Unidade {
  id: string;
  name: string;
  status: string;
}

/**
 * Devolve o rotulo de grupo ao primeiro item que SOBREVIVEU ao filtro.
 *
 * O rotulo mora no item que abre o grupo, e isso funciona enquanto esse item
 * aparece para todo mundo. Deixa de funcionar no instante em que ele tiver
 * `exigePermissao`: o filtro remove o item, o rotulo vai junto, e os irmaos
 * ficam orfaos no meio da lista sem cabecalho.
 *
 * Nao e hipotese distante -- "Financeiro" ja contem um item com permissao
 * (`billing.dashboard`), e basta alguem reordenar o grupo para o defeito
 * nascer, silencioso, **so para quem NAO tem a permissao**. Quem revisa o PR
 * ve a sidebar completa e nao ve nada errado.
 *
 * RECEBE AS DUAS LISTAS de proposito: a completa diz a que grupo cada href
 * pertence (a informacao que o filtro destroi), a filtrada diz quem ficou.
 * Ler `NAVEGACAO` direto do escopo funcionaria em producao e deixaria a
 * funcao intestavel -- nao daria para montar o arranjo perigoso, que e
 * justamente o que precisa de prova.
 *
 * Grupo cujos itens sumiram TODOS nao tem onde ancorar, e o rotulo
 * corretamente nao aparece.
 */
export function reancorarGrupos(
  completa: readonly ItemDeMenu[],
  visiveis: readonly ItemDeMenu[],
): readonly ItemDeMenu[] {
  const grupoDeCadaHref = new Map<string, string>();
  let atual: string | undefined;

  for (const item of completa) {
    if (item.grupo !== undefined) atual = item.grupo;
    if (atual !== undefined) grupoDeCadaHref.set(item.href, atual);
  }

  let ultimoEmitido: string | undefined;

  return visiveis.map((item) => {
    const grupo = grupoDeCadaHref.get(item.href);

    // Primeiro sobrevivente do grupo: e ele que carrega o rotulo agora.
    if (grupo !== undefined && grupo !== ultimoEmitido) {
      ultimoEmitido = grupo;

      return { ...item, grupo };
    }

    // Os demais do mesmo grupo NAO repetem o rotulo.
    const { grupo: _descartado, ...semGrupo } = item;

    return semGrupo;
  });
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

  /*
   * O QUE O MENU MOSTRA -- F54.
   *
   * Item sem `exigePermissao` aparece para todo mundo, como sempre apareceu:
   * a fatia nao esconde nada que ja estava visivel. So o painel financeiro
   * declara capacidade, e some para quem nao a tem.
   *
   * `permissions` AUSENTE esconde o item protegido em vez de mostra-lo. Uma
   * API antiga que ainda nao devolva o campo faria o link aparecer para todos
   * -- e um link que leva a uma recusa e pior que link nenhum. Errar para o
   * lado de esconder e o unico erro barato aqui.
   */
  const permissoes = new Set(resposta.dados.permissions ?? []);
  const itensVisiveis = reancorarGrupos(
    NAVEGACAO,
    NAVEGACAO.filter(
      (item) => item.exigePermissao === undefined || permissoes.has(item.exigePermissao),
    ),
  );

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
        <Navegacao itens={itensVisiveis} />
      }
    >
      {children}
    </AppShell>
  );
}
