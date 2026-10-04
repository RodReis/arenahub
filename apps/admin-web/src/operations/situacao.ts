import { estaSilencioso } from './formatar';

/**
 * Situação derivada do painel operacional.
 *
 * Funções puras, sem relógio: o "agora" entra por parâmetro, como no resto de
 * `src/operations`. O que elas decidem é o que a tela PINTA — quem decide se
 * alerta continua sendo o servidor (ver `estaSilencioso`).
 */

export type TomDaSituacao = 'neutro' | 'positivo' | 'atencao' | 'negativo';

export interface SituacaoDeRecurso {
  readonly label: string;
  readonly tom: TomDaSituacao;
  /** Conta em "N sem resposta". Suspenso, em manutenção e aposentado NÃO contam. */
  readonly foraDoAr: boolean;
}

const RESPONDENDO: SituacaoDeRecurso = { label: 'Respondendo', tom: 'positivo', foraDoAr: false };
const SEM_RESPOSTA: SituacaoDeRecurso = { label: 'Sem resposta', tom: 'negativo', foraDoAr: true };

/**
 * Edge suspenso é decisão de alguém, não falha: `coletarEstadoParaAlertas`
 * só avalia Edge `ACTIVE`, e a tela que o chamasse de "Sem resposta" estaria
 * contradizendo o servidor — o painel mostraria vermelho sem alerta nenhum.
 */
export function situacaoDoEdge(
  edge: { status: string; ultimoHeartbeat: string | null },
  agora: Date,
): SituacaoDeRecurso {
  if (edge.status !== 'ACTIVE') {
    return { label: 'Suspenso', tom: 'neutro', foraDoAr: false };
  }

  return estaSilencioso(edge.ultimoHeartbeat, agora) ? SEM_RESPOSTA : RESPONDENDO;
}

/**
 * Manutenção e aposentadoria são situações distintas e a tela dizia
 * "Em manutenção" para as duas: quem aposentou um leitor e voltava ao painel
 * lia que ele ainda ia voltar. Mesmo erro já corrigido em `/operations/devices`.
 */
export function situacaoDoDispositivo(
  dispositivo: { status: string; ultimoHeartbeat: string | null },
  agora: Date,
): SituacaoDeRecurso {
  if (dispositivo.status === 'MAINTENANCE') {
    // Equipamento em manutenção não é falha: alguém já sabe.
    return { label: 'Em manutenção', tom: 'atencao', foraDoAr: false };
  }

  if (dispositivo.status === 'RETIRED') {
    return { label: 'Aposentado', tom: 'neutro', foraDoAr: false };
  }

  return estaSilencioso(dispositivo.ultimoHeartbeat, agora) ? SEM_RESPOSTA : RESPONDENDO;
}

export type NivelDaOperacao = 'critico' | 'atencao' | 'ok' | 'indisponivel';

export interface EntradaDoResumo {
  readonly criticos: number;
  /** Dos críticos, quantos alguém já reconheceu ("estou vendo, estou indo"). */
  readonly criticosReconhecidos: number;
  readonly demais: number;
  /** Idade legível do crítico mais antigo, ou `null` quando não há crítico. */
  readonly criticoMaisAntigoHa: string | null;
  readonly edgesForaDoAr: number;
  readonly dispositivosForaDoAr: number;
  readonly totalDeEdges: number;
  /** A leitura dos alertas falhou: o painel não sabe se há problema. */
  readonly alertasIndisponiveis: boolean;
}

export interface ResumoDaOperacao {
  readonly nivel: NivelDaOperacao;
  readonly titulo: string;
  readonly apoio: string;
}

function plural(n: number, singular: string, pluralDe: string): string {
  return n === 1 ? singular : pluralDe;
}

/**
 * A frase que quem passa pela tela entre dois atendimentos lê, e mais nada.
 *
 * REGRA DE OURO: ela não afirma "tudo bem" sem ter lido tudo. Alerta
 * ilegível, equipamento mudo sem alerta aberto ainda (o ciclo do servidor leva
 * até 30 s depois dos 90 s de silêncio) e ausência de Edge são três casos em
 * que "Nenhum problema crítico agora" seria verdade só no papel.
 */
export function resumirOperacao(e: EntradaDoResumo): ResumoDaOperacao {
  if (e.alertasIndisponiveis) {
    return {
      nivel: 'indisponivel',
      titulo: 'Não foi possível ler os alertas.',
      apoio:
        'Sem essa leitura não dá para afirmar que a catraca está funcionando. Recarregue a página.',
    };
  }

  if (e.criticos > 0) {
    const reconhecidos =
      e.criticosReconhecidos > 0
        ? ` · ${e.criticosReconhecidos} ${plural(e.criticosReconhecidos, 'já reconhecido', 'já reconhecidos')}`
        : '';
    const desde = e.criticoMaisAntigoHa !== null ? `O mais antigo, ${e.criticoMaisAntigoHa}` : '';

    return {
      nivel: 'critico',
      titulo: `${e.criticos} ${plural(e.criticos, 'problema crítico', 'problemas críticos')} impedindo acesso agora.`,
      apoio: `${desde}${reconhecidos}`.trim(),
    };
  }

  const foraDoAr = e.edgesForaDoAr + e.dispositivosForaDoAr;

  if (foraDoAr > 0) {
    return {
      nivel: 'atencao',
      titulo: 'Nenhum alerta crítico aberto, mas há equipamento sem resposta.',
      apoio: 'O alerta abre sozinho em até 2 minutos de silêncio. Confira a energia e a rede.',
    };
  }

  if (e.totalDeEdges === 0) {
    return {
      nivel: 'atencao',
      titulo: 'Nenhum problema crítico agora.',
      apoio: 'Nenhum Edge cadastrado: sem ele a catraca não decide nada.',
    };
  }

  if (e.demais > 0) {
    return {
      nivel: 'atencao',
      titulo: 'Nenhum problema crítico agora.',
      apoio: `${e.demais} ${plural(e.demais, 'alerta de atenção aberto', 'alertas de atenção abertos')}.`,
    };
  }

  return {
    nivel: 'ok',
    titulo: 'Nenhum problema crítico agora.',
    apoio: 'Edge e dispositivos respondendo, sincronização em dia.',
  };
}

/** `98.5` → "98,5%". Sem `Intl`: a vírgula é a única coisa que muda. */
export function formatarPercentual(valor: number): string {
  return `${String(valor).replace('.', ',')}%`;
}
