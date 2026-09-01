import { AppShell, Button } from '@arenahub/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { chamarApi } from '../../lib/api/server-client';
import { sair } from '../actions/auth';
import { Navegacao } from './navegacao';
import { SeletorDeUnidade } from './seletor-de-unidade';

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
  { href: '/dashboard', label: 'Dashboard' },
  /*
    `Operação` CONTINUA no menu -- decisão 3 da `SPEC-057`. O dashboard é o
    resumo; esta é a tela de investigação, com os alertas detalhados, a fila
    de sincronização e o detalhe de dispositivo. Resumo e detalhe são telas
    diferentes, e o dashboard não substitui nenhuma delas.
  */
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
  /*
    TOTENS -- F50. Mesmo grupo de Dispositivos, mesmo motivo: personalizar o
    totem (marca, aparencia, sessao) e configuracao de uso raro, nao a
    ferramenta do atendimento diario.
  */
  { href: '/units', label: 'Unidades' },
  /*
    TOTEM -- grupo criado por decisao do PI em 28/08/2026: *"vamos colocar o
    que for do totem no Menu Totem"*.

    As tres entradas configuram a MESMA superficie -- o que o aluno ve no
    totem --, e ficavam soltas em Administracao entre Dispositivos e
    Unidades, onde nada dizia que eram a mesma familia. Agrupadas, a leitura
    de relance responde "onde mexo no totem" numa parada so.

    A ORDEM E A DA DEPENDENCIA, nao a alfabetica: sem personalizar o totem
    (ligar modulo, publicar) nada do resto aparece para o aluno, entao
    Personalizacao vem primeiro. Engajamento (placar, XP, desafios) e o
    conteudo que roda dentro dela; moderar apelido e a fila que nasce dele.

    `Placar e XP` e `Desafios` VIRARAM ABAS de `/engagement` -- eram dois
    itens para um trabalho so. As rotas antigas continuam existindo e
    funcionando; so sairam do menu.
  */
  {
    href: '/operations/kiosks',
    label: 'Personalização',
    grupo: 'Totem',
    exigePermissao: 'device.read',
  },
  /*
    ENGAJAMENTO -- F31 (placar e XP) + F34 (desafios), numa tela de abas.

    `engagement.moderate` e nao `engagement.read`: as duas abas so oferecem
    ACAO (gerar/publicar placar, ajustar XP, criar/abrir desafio), e sem a
    capacidade nao ha nada que a tela deixe fazer.
  */
  { href: '/engagement', label: 'Engajamento', exigePermissao: 'engagement.moderate' },
  /*
    MODERAÇÃO DE APELIDO -- F30, Task 9. Fila que nasce do engajamento: o
    aluno escolhe apelido no totem, alguem aprova aqui. `engagement.read`
    porque a tela LISTA perfis; sem a capacidade, o link nem aparece.
  */
  { href: '/engagement/aliases', label: 'Moderação de apelido', exigePermissao: 'engagement.read' },
  /*
    CONTESTAÇÕES -- F35, Slice 5.6. A outra fila que nasce do engajamento: o
    aluno discorda do que a tela mostrou e abre pelo totem, alguém resolve
    aqui. `engagement.read` pela mesma razão da fila de apelido -- a tela
    LISTA; resolver exige `engagement.correct`, que a rota cobra por conta.
  */
  { href: '/engagement/contestacoes', label: 'Contestações', exigePermissao: 'engagement.read' },
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
   * O QUE O TOPBAR MOSTRA -- e ele passou a SELECIONAR em 01/09/2026 (F57).
   *
   * Era indicador estático: com uma unidade dizia o nome, com várias dizia
   * "2 unidades", porque a TROCA dependia de decisão de produto sobre
   * persistência e escopo de sessão. O dashboard forçou a decisão -- sem
   * unidade escolhida não existe "hoje", e "hoje" é o bloco 2 da fatia.
   *
   * Com UMA unidade continua sendo rótulo: ela É o contexto, e um `<select>`
   * de uma opção só é um botão que não faz nada. Ver `SeletorDeUnidade`.
   */

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
        SELETOR de unidade desde 01/09/2026 (F57) -- era indicador estático.
        A escolha vive na URL: compartilhável por link, sobrevive a
        recarregamento e o servidor a lê antes de renderizar.
      */
      unitSelector={
        <SeletorDeUnidade unidades={unidades} vazio="Nenhuma unidade cadastrada" />
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
