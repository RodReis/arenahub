import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './CelulasDeTabela.module.css';

/**
 * As células que treze tabelas do painel escreviam à mão.
 *
 * Cada componente aqui nasceu de uma DUPLICAÇÃO encontrada no código, não de
 * uma lista de "o que uma tabela costuma ter". A diferença importa: um sistema
 * feito de padrões observados cabe nas telas que existem; um feito de padrões
 * imaginados obriga cada tela a contorná-lo.
 */

/**
 * O que o estado da linha CUSTA, dito ao lado do estado.
 *
 * Existia duas vezes: `.consequencia` em `/students` (com cor de perigo) e um
 * `<span>` nu em `/students/[id]` (sem tratamento nenhum). Mesmo padrão, um
 * visível e outro invisível.
 *
 * NÃO É UM SEGUNDO BADGE. O estado já foi dito pelo `StateBadge`; isto responde
 * a pergunta seguinte — "e daí?". "Inativo" é o estado; "sem acesso à catraca"
 * é o que a recepção precisa saber para agir, que é o Princípio 1 do produto.
 */
export function Consequencia({
  children,
  tom = 'neutro',
  testId,
}: {
  readonly children: ReactNode;
  /** `danger` quando a consequência barra o aluno. `neutro` quando só informa. */
  readonly tom?: 'neutro' | 'danger';
  readonly testId?: string;
}) {
  return (
    <span
      className={estilos['consequencia']}
      data-tom={tom}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {children}
    </span>
  );
}

/**
 * Ações da linha, encostadas à direita.
 *
 * Existia como `.acoes` em `/billing/delinquency` e como `<span>—</span>` cru em
 * `/operations` — este último um bug de acessibilidade silencioso: travessão
 * sem rótulo é lido como pontuação solta pelo leitor de tela.
 *
 * `AusenteDeAcao` resolve o segundo caso com o rótulo que faltava.
 */
export function AcoesDaLinha({ children }: { readonly children: ReactNode }) {
  return <span className={estilos['acoes']}>{children}</span>;
}

/**
 * "Nada a fazer nesta linha" — com rótulo, não como pontuação.
 *
 * `aria-label` porque `—` sozinho é anunciado como "traço" ou ignorado, e a
 * pessoa que usa leitor de tela fica sem saber se a coluna está vazia por falta
 * de dado ou por não haver ação. São coisas diferentes.
 */
export function AusenteDeAcao() {
  return (
    <span className={estilos['semAcao']} aria-label="nenhuma ação disponível">
      —
    </span>
  );
}

/**
 * Estado que NÃO tem máquina canônica.
 *
 * Oito células do painel fazem ternário em texto cru — "Ativa"/"Inativa",
 * "Respondendo"/"Sem resposta" — cada uma com um comentário longo explicando
 * por que não usa `StateBadge`. As razões são legítimas e distintas: não há
 * máquina no §7 (unidade, plano), o valor da API não existe no dicionário
 * (device `ACTIVE`), ou é resultado e não estado.
 *
 * O QUE ESTAVA ERRADO NÃO ERA A DECISÃO, ERA O RESULTADO: essas oito células
 * ficavam como texto sem peso ao lado de colunas com badge, e a tabela parecia
 * ter duas linguagens visuais. Isto dá a elas a mesma forma do badge — ponto,
 * rótulo, altura — sem fingir que são uma máquina de estado.
 *
 * TRÊS CANAIS, como todo estado do painel (Princípio 3): o ponto tem cor, o
 * ícone tem forma, e o rótulo tem texto. Nunca só a cor.
 */
export type TomDoEstado = 'neutro' | 'positivo' | 'atencao' | 'negativo';

export function EstadoSimples({
  label,
  tom = 'neutro',
  icone,
  testId,
}: {
  readonly label: string;
  readonly tom?: TomDoEstado;
  /** Sobrescreve o ícone padrão do tom. */
  readonly icone?: IconName;
  readonly testId?: string;
}) {
  const nome = icone ?? ICONE_POR_TOM[tom];

  return (
    <span
      className={estilos['estado']}
      data-tom={tom}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <Icon name={nome} />
      {label}
    </span>
  );
}

/** Chaveado pelo TOM, nao por `string`: assim o compilador garante que todo tom
 * tem icone, e um tom novo sem icone nao compila. */
const ICONE_POR_TOM: Readonly<Record<TomDoEstado, IconName>> = {
  neutro: 'minus',
  positivo: 'check-circle',
  atencao: 'alert-circle',
  negativo: 'x-circle',
};

/**
 * Idade relativa ("há 3 h"), com o instante exato no `title` e no `dateTime`.
 *
 * Três telas de `/operations` escrevem `<time dateTime={x}>{idadeLegivel(x)}</time>`
 * à mão — e uma quarta esqueceu o `<time>`, perdendo a semântica sem que nada
 * acusasse.
 *
 * IDADE E NÃO INSTANTE porque num painel operacional a pergunta é "há quanto
 * tempo?", não "às quantas horas?". Mas o instante continua no DOM: quem
 * precisa da hora exata passa o mouse, e o leitor de tela recebe a data ISO.
 */
export function Idade({
  iso,
  texto,
  testId,
}: {
  readonly iso: string;
  /** O texto já formatado ("há 3 h"). A formatação é do app, não do DS. */
  readonly texto: string;
  readonly testId?: string;
}) {
  return (
    <time
      className={estilos['idade']}
      dateTime={iso}
      title={iso}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {texto}
    </time>
  );
}
