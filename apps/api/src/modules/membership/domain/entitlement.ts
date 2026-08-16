import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import { alunoRecebeAcessoNormal, type StatusDeAluno } from '../../students/domain/student.js';
import { instanteDentroDaJanela, type JanelaDeAcesso } from './plan.js';

/**
 * Entitlement: o direito de acesso, e o unico insumo que o motor de decisao
 * consulta.
 *
 * REGRA DE ARQUITETURA No 1 (`CLAUDE.md`), INV-029 e INV-030: a cadeia e
 * `Pagamento -> Invoice -> Subscription -> Entitlement -> Access Decision
 * Engine`, e a catraca NUNCA consulta assinatura nem invoice. Nada neste
 * arquivo importa `Subscription` -- e proposital, e a revisao deve rejeitar
 * qualquer import desse tipo aqui.
 */

export type StatusDeEntitlement =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPIRED';

export type OrigemDeEntitlement =
  | 'SUBSCRIPTION'
  | 'COURTESY'
  | 'EMPLOYEE'
  | 'PERSONAL_TRAINER'
  | 'VISITOR'
  | 'TRIAL_CLASS'
  | 'DEPENDENT'
  | 'PARTNER'
  | 'CORPORATE';

export class TransicaoDeEntitlementInvalidaError extends ErroDeDominio {
  constructor(
    readonly atual: StatusDeEntitlement,
    readonly alvo: StatusDeEntitlement,
  ) {
    super(
      'ENTITLEMENT_INVALID_TRANSITION',
      409,
      `Transicao invalida de entitlement: ${atual} para ${alvo}`,
    );
  }
}

/**
 * Transicoes do entitlement (`CONVENTION.md` secao 3.3).
 *
 * `SUSPENDED` e reversivel; `REVOKED` e terminal. A distincao vem do proprio
 * CONVENTION: inadimplencia suspende (reversivel por compensacao), revogacao
 * encerra. `EXPIRED` tambem e terminal -- direito vencido nao volta; o que
 * se faz e conceder um novo.
 */
export const TRANSICOES_DE_ENTITLEMENT: Record<
  StatusDeEntitlement,
  ReadonlySet<StatusDeEntitlement>
> = {
  SCHEDULED: new Set(['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED']),
  ACTIVE: new Set(['SUSPENDED', 'REVOKED', 'EXPIRED']),
  SUSPENDED: new Set(['ACTIVE', 'REVOKED', 'EXPIRED']),
  REVOKED: new Set([]),
  EXPIRED: new Set([]),
};

export function transicionarEntitlement(
  atual: StatusDeEntitlement,
  alvo: StatusDeEntitlement,
): StatusDeEntitlement {
  if (!TRANSICOES_DE_ENTITLEMENT[atual].has(alvo)) {
    throw new TransicaoDeEntitlementInvalidaError(atual, alvo);
  }

  return alvo;
}

/**
 * O que o motor precisa saber sobre um direito concedido.
 *
 * `janelas` vem do SNAPSHOT gravado no entitlement, nunca do plano vivo. O
 * plano pode mudar amanha; o direito ja concedido nao muda junto sem alguem
 * decidir isso.
 */
export interface DireitoDeAcesso {
  status: StatusDeEntitlement;
  startsAt: Date;
  endsAt: Date;
  janelas: readonly JanelaDeAcesso[];
}

/** Por que o direito nao vale agora. Lista fechada e estavel (INV-038). */
export type MotivoDeInefetividade =
  | 'STUDENT_NOT_ELIGIBLE'
  | 'ENTITLEMENT_NOT_ACTIVE'
  | 'ENTITLEMENT_NOT_STARTED'
  | 'ENTITLEMENT_EXPIRED'
  | 'OUTSIDE_ACCESS_WINDOW'
  | 'UNIT_NOT_ALLOWED';

export type ResultadoDeEfetividade =
  | { efetivo: true }
  | { efetivo: false; motivo: MotivoDeInefetividade };

/**
 * O direito e efetivo neste instante, nesta unidade?
 *
 * FUNCAO PURA: o "agora" entra por parametro (`CLAUDE.md`). Ler o relogio
 * aqui dentro tornaria o teste de fronteira -- justamente o que mais
 * importa -- impossivel de escrever sem congelar o tempo global.
 *
 * A ORDEM DAS GUARDAS IMPORTA e e a mais restritiva primeiro (INV-034):
 *
 *   1. status do aluno (INV-033) -- vence tudo, inclusive cortesia;
 *   2. status do entitlement;
 *   3. validade temporal (INV-035: expirado NUNCA e efetivo);
 *   4. unidade e janela de horario.
 *
 * `endsAt` e EXCLUSIVO, igual ao fim de janela: o direito vale ate o
 * instante anterior. Inclusivo criaria um minuto de sobreposicao entre um
 * direito que acaba e o proximo que comeca.
 */
export function direitoEhEfetivo(
  direito: DireitoDeAcesso,
  statusDoAluno: StatusDeAluno,
  gymUnitId: string,
  timezone: string,
  agora: Date,
): ResultadoDeEfetividade {
  // INV-033: BLOCKED, CANCELLED e ARCHIVED nao recebem acesso normal --
  // qualquer que seja a origem do direito. Cortesia nao contorna isso.
  if (!alunoRecebeAcessoNormal(statusDoAluno)) {
    return { efetivo: false, motivo: 'STUDENT_NOT_ELIGIBLE' };
  }

  if (direito.status !== 'ACTIVE') {
    return { efetivo: false, motivo: 'ENTITLEMENT_NOT_ACTIVE' };
  }

  if (agora < direito.startsAt) {
    return { efetivo: false, motivo: 'ENTITLEMENT_NOT_STARTED' };
  }

  // INV-035: entitlement expirado nunca retorna ALLOW. A guarda e por DATA,
  // nao por status -- um job de expiracao atrasado deixaria o status em
  // ACTIVE, e sem esta linha o direito vencido passaria.
  if (agora >= direito.endsAt) {
    return { efetivo: false, motivo: 'ENTITLEMENT_EXPIRED' };
  }

  if (!direito.janelas.some((j) => j.gymUnitId === gymUnitId)) {
    return { efetivo: false, motivo: 'UNIT_NOT_ALLOWED' };
  }

  if (!instanteDentroDaJanela(agora, timezone, gymUnitId, direito.janelas)) {
    return { efetivo: false, motivo: 'OUTSIDE_ACCESS_WINDOW' };
  }

  return { efetivo: true };
}

/**
 * Snapshot imutavel das regras do plano, congelado na derivacao.
 *
 * Existe porque editar um plano NAO pode reescrever retroativamente quem
 * podia entrar ontem. O snapshot e o que o entitlement carrega para sempre;
 * o plano segue a vida dele.
 */
export interface SnapshotDePolitica {
  planId: string;
  planName: string;
  /** Versao do formato do snapshot, para leitura futura saber o que espera. */
  snapshotVersion: 1;
  gymUnitIds: readonly string[];
  janelas: readonly JanelaDeAcesso[];
}

export function montarSnapshotDePolitica(
  planId: string,
  planName: string,
  gymUnitIds: readonly string[],
  janelas: readonly JanelaDeAcesso[],
): SnapshotDePolitica {
  return {
    planId,
    planName,
    snapshotVersion: 1,
    gymUnitIds: [...gymUnitIds].sort(),
    janelas,
  };
}
