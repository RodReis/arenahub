/**
 * ---------------------------------------------------------------------------
 * VERSAO MINIMA E KILL SWITCH -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * Duas perguntas que o SERVIDOR responde e o app obedece:
 *
 *   1. "Esta versao ainda pode rodar?"  -> `resolverVersao`
 *   2. "Esta funcionalidade esta ligada?" -> `resolverFuncionalidade`
 *
 * POR QUE NO SERVIDOR. Um app que carrega a propria versao minima julga com a
 * regra que existia no dia em que foi publicado -- e a versao antiga e
 * justamente a que precisa ser bloqueada. O julgamento tem que vir de fora do
 * artefato julgado.
 *
 * POR QUE FECHA EM VEZ DE ABRIR. Toda ausencia, corrupcao ou formato
 * inesperado resulta em BLOQUEADO/DESLIGADO. O modo de falha oposto -- abrir
 * na duvida -- transforma erro de deploy em ausencia silenciosa de controle:
 * o piloto continua rodando e ninguem percebe que o freio sumiu.
 *
 * Funcoes puras, sem relogio proprio: o `agora` entra por parametro
 * (`CLAUDE.md`, Convencoes).
 */

/** O que o app pode fazer com a resposta. */
export type EstadoDaVersao = 'SUPPORTED' | 'GRACE' | 'BLOCKED';

export interface PoliticaDeVersao {
  /** Menor versao que ainda roda. `1.5.0`. */
  readonly minima: string;
  /**
   * Ate quando a versao abaixo da minima ainda funciona.
   *
   * Ausente = bloqueio imediato. Existe para atualizacao de seguranca, em que
   * avisar com antecedencia e pior do que cortar.
   */
  readonly carenciaAte?: Date;
  /** Para onde mandar o aluno atualizar. Precisa ser https. */
  readonly urlDeAtualizacao?: string;
}

export interface RespostaDaVersao {
  readonly estado: EstadoDaVersao;
  readonly minima: string | null;
  readonly carenciaAte: string | null;
  readonly urlDeAtualizacao: string | null;
}

/** `1.4.0`. Pre-release nao entra: `1.5.0-rc.1` nao se compara com `1.5.0`. */
const VERSAO = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/**
 * `1.10.0` > `1.9.0`.
 *
 * Comparar como TEXTO daria o contrario -- `'1.10.0' < '1.9.0'` em ordem
 * alfabetica, porque `'1' < '9'` no segundo segmento. Seria o defeito que
 * libera exatamente a versao que se queria bloquear.
 */
function compararVersoes(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const diferenca = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }

  return 0;
}

function segmentos(versao: unknown): readonly number[] | null {
  if (typeof versao !== 'string') return null;

  const casou = VERSAO.exec(versao);
  if (!casou) return null;

  return [Number(casou[1]), Number(casou[2]), Number(casou[3])];
}

/**
 * URL que o app vai ABRIR -- por isso o esquema e conferido aqui.
 *
 * `javascript:` num campo que vira `Linking.openURL` executa codigo; `http:`
 * entrega o aluno a um intermediario. Formato invalido vira nulo, e a tela
 * cai no texto "procure a recepcao" -- pior experiencia, nenhum risco.
 */
function urlSegura(bruta: unknown): string | null {
  if (typeof bruta !== 'string' || bruta === '') return null;

  try {
    return new URL(bruta).protocol === 'https:' ? bruta : null;
  } catch {
    return null;
  }
}

/**
 * Esta versao ainda roda?
 *
 * `BLOCKED` nao significa app morto: a tela de atualizacao e a de suporte
 * continuam de pe, e e por isso que `urlDeAtualizacao` viaja junto do
 * bloqueio. Bloquear sem dizer para onde ir deixa o aluno sem saida.
 */
export function resolverVersao(
  versaoDoApp: string,
  politica: PoliticaDeVersao,
  agora: Date,
): RespostaDaVersao {
  const url = urlSegura(politica.urlDeAtualizacao);
  const minima = segmentos(politica.minima);
  const atual = segmentos(versaoDoApp);

  // Politica ilegivel bloqueia. Nao ha "na duvida, libera": a duvida aqui
  // significa que ninguem sabe qual e a regra, e operar sem regra conhecida e
  // o que este arquivo existe para impedir.
  if (minima === null || atual === null) {
    return {
      estado: 'BLOCKED',
      minima: typeof politica.minima === 'string' && politica.minima !== '' ? politica.minima : null,
      carenciaAte: null,
      urlDeAtualizacao: url,
    };
  }

  if (compararVersoes(atual, minima) >= 0) {
    return {
      estado: 'SUPPORTED',
      minima: politica.minima,
      carenciaAte: null,
      urlDeAtualizacao: url,
    };
  }

  // `>` e nao `>=`: carencia "ate as 12h" que ainda libera as 12h em ponto e,
  // na pratica, carencia ate 12h00'01".
  const naCarencia = politica.carenciaAte !== undefined && politica.carenciaAte.getTime() > agora.getTime();

  return {
    estado: naCarencia ? 'GRACE' : 'BLOCKED',
    minima: politica.minima,
    carenciaAte: naCarencia ? (politica.carenciaAte as Date).toISOString() : null,
    urlDeAtualizacao: url,
  };
}

/** O que o piloto pode desligar sem republicar o app. */
export const FUNCIONALIDADES_DE_CANAL = [
  'STUDENT_MOBILE',
  'MOBILE_PAYMENTS',
  'KIOSK',
  'KIOSK_PAYMENTS',
  'PUSH_NOTIFICATIONS',
] as const;

export type FuncionalidadeDeCanal = (typeof FUNCIONALIDADES_DE_CANAL)[number];

export interface ConfiguracaoDeFuncionalidade {
  readonly global?: boolean;
  readonly tenant?: boolean;
}

/**
 * E `global` (freio de emergencia) com `tenant` (decisao da academia).
 *
 * A assimetria e o desenho: o global desligado NUNCA e reaberto pelo tenant,
 * porque freio que o freado solta nao e freio. Quando o pagamento no app
 * comeca a duplicar cobranca num sabado a noite, o desligamento global tem de
 * valer para todo mundo na hora -- sem depender de cada academia concordar.
 *
 * Ausencia fecha, e `boolean` estrito e proposital: `'false'` (string) e
 * verdadeiro em JavaScript, e ler flag de variavel de ambiente sem converter
 * e o jeito classico de ligar o que se queria desligar.
 */
export function resolverFuncionalidade(config: ConfiguracaoDeFuncionalidade): boolean {
  return config.global === true && config.tenant === true;
}
