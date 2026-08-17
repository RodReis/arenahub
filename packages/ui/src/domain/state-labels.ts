import { ALLOW_REASON, DENY_REASON } from '@arenahub/access-policy';

import type { IconName } from '../components/Icon.js';

/**
 * Dicionario canonico de estado -- DS-PAINEL.md §7.
 *
 * Dominio em ingles no codigo, PORTUGUES na interface. Nenhum componente
 * escreve rotulo inline: quem precisa de texto de estado importa daqui.
 *
 * O motivo de existir um arquivo unico e a divergencia. Rotulo repetido em
 * cinco telas diverge na primeira correcao -- uma tela passa a dizer "Sem
 * plano" e outra "Sem direito vigente" para o MESMO codigo, e a recepcao
 * conclui que sao situacoes diferentes.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'risk' | 'neutral';

export interface StateLabel {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

export type StateMachine =
  | 'student'
  | 'subscription'
  | 'entitlement'
  | 'biometric'
  | 'syncJob'
  | 'device'
  | 'accessReason'
  | 'passage'
  | 'invoice'
  | 'payment'
  | 'reconciliation'
  | 'riskBand';

type Dictionary = Readonly<Record<StateMachine, Readonly<Record<string, StateLabel>>>>;

export const STATE_LABELS: Dictionary = {
  student: {
    // "Interessado", nao "Lead" -- o codigo em producao ja usa portugues aqui,
    // e frase de tela e o eixo onde o existente vence o contrato.
    LEAD: { label: 'Interessado', tone: 'neutral', icon: 'user-plus' },
    TRIAL: { label: 'Experimental', tone: 'info', icon: 'hourglass' },
    ACTIVE: { label: 'Ativo', tone: 'success', icon: 'user-check' },
    SUSPENDED: { label: 'Suspenso', tone: 'warning', icon: 'user-minus' },
    BLOCKED: { label: 'Bloqueado', tone: 'danger', icon: 'user-x' },
    CANCELLED: { label: 'Cancelado', tone: 'neutral', icon: 'x-circle' },
    ARCHIVED: { label: 'Arquivado', tone: 'neutral', icon: 'archive' },
  },

  subscription: {
    PENDING: { label: 'Pendente', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Ativa', tone: 'success', icon: 'check-circle' },
    PAST_DUE: { label: 'Em atraso', tone: 'warning', icon: 'alert-circle' },
    PAUSED: { label: 'Pausada', tone: 'neutral', icon: 'minus' },
    CANCELLED: { label: 'Cancelada', tone: 'neutral', icon: 'x-circle' },
    EXPIRED: { label: 'Expirada', tone: 'neutral', icon: 'calendar-x' },
  },

  entitlement: {
    SCHEDULED: { label: 'Agendado', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Ativo', tone: 'success', icon: 'key-round' },
    SUSPENDED: { label: 'Suspenso', tone: 'warning', icon: 'alert-circle' },
    /**
     * Tom ERRO aqui, NEUTRO em `biometric.REVOKED` -- e deliberado.
     *
     * Revogar direito de acesso e falha de um contrato que deveria valer.
     * Revogar consentimento biometrico e DIREITO DO TITULAR (ADR-008 decisao
     * 3): o aluno exerceu a LGPD, e o sistema funcionou como devia. Pintar de
     * vermelho ensinaria a recepcao a tratar exercicio de direito como
     * problema a resolver.
     *
     * Se alguem "consertar" a inconsistencia, quebra a decisao -- por isso
     * esta escrita aqui e testada em `state-labels.spec.ts`.
     */
    REVOKED: { label: 'Revogado', tone: 'danger', icon: 'ban' },
    EXPIRED: { label: 'Expirado', tone: 'neutral', icon: 'calendar-x' },
  },

  biometric: {
    PENDING_CONSENT: { label: 'Aguardando consentimento', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Ativa', tone: 'success', icon: 'scan-face' },
    REVOKED: { label: 'Revogada', tone: 'neutral', icon: 'ban' },
    DELETION_PENDING: {
      label: 'Revogada — aguardando exclusão nos leitores',
      tone: 'warning',
      icon: 'clock',
    },
    DELETED: { label: 'Excluída de todos os leitores', tone: 'neutral', icon: 'minus' },
  },

  syncJob: {
    PENDING: { label: 'Aguardando', tone: 'info', icon: 'clock' },
    PROCESSING: { label: 'Em andamento', tone: 'info', icon: 'refresh-cw' },
    SYNCED: { label: 'Sincronizado', tone: 'success', icon: 'check-circle' },
    FAILED: { label: 'Falhou', tone: 'danger', icon: 'x-circle' },
    /**
     * MUDA nesta fatia (PI, 16/08/2026): `devices/page.tsx` dizia "Tentando de
     * novo" e o contrato §7 diz "Tentando novamente". Mesmo estado com dois
     * nomes em telas diferentes e exatamente o que este arquivo existe para
     * impedir; vence o contrato.
     */
    RETRYING: { label: 'Tentando novamente', tone: 'warning', icon: 'refresh-cw' },
    REMOVED: { label: 'Removido', tone: 'neutral', icon: 'minus' },
  },

  device: {
    PROVISIONING: { label: 'Provisionando', tone: 'info', icon: 'clock' },
    ONLINE: { label: 'Online', tone: 'success', icon: 'wifi' },
    DEGRADED: { label: 'Degradado', tone: 'warning', icon: 'alert-circle' },
    OFFLINE: { label: 'Offline', tone: 'danger', icon: 'wifi-off' },
    RETIRED: { label: 'Desativado', tone: 'neutral', icon: 'minus' },
  },

  /**
   * Razoes de acesso -- ADR-024, frases aprovadas pelo PI em 16/08/2026
   * (issue #81). Rotulo CURTO e operacional: cabe em coluna de tabela e a
   * recepcao le de relance. Explicacao longa vai para tooltip ou ficha.
   *
   * TOM: erro so para decisao deliberada. Vermelho quando alguem decidiu
   * barrar; ambar quando da para resolver no balcao. Achatar tudo em vermelho
   * faria "errou de porta" parecer "bloqueado pela gerencia", e a acao certa e
   * diferente em cada caso.
   *
   * As chaves vem de `@arenahub/access-policy` -- NUNCA redeclarar aqui
   * (SPEC-042 §6). O teste de cobertura falha se um codigo novo aparecer la
   * sem rotulo aqui.
   */
  accessReason: {
    [ALLOW_REASON.ACTIVE_ENTITLEMENT]: {
      label: 'Plano válido',
      tone: 'success',
      icon: 'check-circle',
    },
    /**
     * Rotulo PROPRIO, nunca "Plano valido". O motor nunca produz este valor:
     * quem o grava e o caso de uso de override. Confundir os dois faz
     * relatorio de "acesso por direito valido" contar excecao como regra.
     */
    [ALLOW_REASON.MANUAL_OVERRIDE]: {
      label: 'Liberado manualmente pela recepção',
      tone: 'success',
      icon: 'user-check',
    },
    [DENY_REASON.ADMIN_BLOCK]: {
      label: 'Bloqueio administrativo',
      tone: 'danger',
      icon: 'ban',
    },
    [DENY_REASON.STUDENT_BLOCKED]: {
      label: 'Aluno bloqueado',
      tone: 'danger',
      icon: 'user-x',
    },
    [DENY_REASON.STUDENT_INACTIVE]: {
      label: 'Cadastro não está ativo',
      tone: 'warning',
      icon: 'user-minus',
    },
    [DENY_REASON.NO_ENTITLEMENT]: {
      label: 'Sem plano vigente',
      tone: 'danger',
      icon: 'x-circle',
    },
    [DENY_REASON.WRONG_UNIT]: {
      label: 'O plano vale em outra unidade',
      tone: 'warning',
      icon: 'alert-circle',
    },
    [DENY_REASON.OUTSIDE_SCHEDULE]: {
      label: 'Fora do horário do plano',
      tone: 'warning',
      icon: 'clock',
    },
  },

  /**
   * `NOT_APPLICABLE` existe para impedir que a operacao leia "sem confirmacao"
   * como falha: nem todo equipamento confirma giro (DS-PAINEL.md §7).
   */
  passage: {
    /**
     * MUDA nesta fatia (PI, 16/08/2026): era `'—'` em
     * `ROTULO_DE_PASSAGEM.NOT_APPLICABLE`, o que colapsava "este equipamento
     * nao confirma giro" com "dado ausente" -- exatamente o que este estado
     * existe para impedir.
     */
    NOT_APPLICABLE: { label: 'Não confirma giro', tone: 'neutral', icon: 'minus' },
    PENDING: { label: 'Aguardando giro', tone: 'info', icon: 'clock' },
    // "Passou"/"Nao passou" vem da producao: dizem o que aconteceu no mundo,
    // nao o estado interno do registro.
    CONFIRMED: { label: 'Passou', tone: 'success', icon: 'check-circle' },
    TIMED_OUT: { label: 'Não passou', tone: 'warning', icon: 'alert-circle' },
  },

  invoice: {
    DRAFT: { label: 'Rascunho', tone: 'neutral', icon: 'minus' },
    OPEN: { label: 'Em aberto', tone: 'info', icon: 'clock' },
    PAID: { label: 'Paga', tone: 'success', icon: 'check-circle' },
    OVERDUE: { label: 'Vencida', tone: 'warning', icon: 'alert-circle' },
    CANCELLED: { label: 'Cancelada', tone: 'neutral', icon: 'x-circle' },
    REFUNDED: { label: 'Estornada', tone: 'neutral', icon: 'refresh-cw' },
  },

  payment: {
    PENDING: { label: 'Pendente', tone: 'info', icon: 'clock' },
    PROCESSING: { label: 'Processando', tone: 'info', icon: 'refresh-cw' },
    CONFIRMED: { label: 'Confirmado', tone: 'success', icon: 'check-circle' },
    FAILED: { label: 'Falhou', tone: 'danger', icon: 'x-circle' },
    CANCELLED: { label: 'Cancelado', tone: 'neutral', icon: 'minus' },
    REFUND_PENDING: { label: 'Estorno em andamento', tone: 'warning', icon: 'refresh-cw' },
    REFUNDED: { label: 'Estornado', tone: 'neutral', icon: 'refresh-cw' },
    REQUIRES_ACTION: { label: 'Ação necessária', tone: 'warning', icon: 'alert-circle' },
  },

  reconciliation: {
    MATCHED: { label: 'Conciliado', tone: 'success', icon: 'check-circle' },
    MISSING_INTERNAL: { label: 'Ausente no ArenaHub', tone: 'danger', icon: 'x-circle' },
    MISSING_EXTERNAL: { label: 'Ausente no provedor', tone: 'danger', icon: 'x-circle' },
    AMOUNT_MISMATCH: { label: 'Valor divergente', tone: 'warning', icon: 'alert-circle' },
    RESOLVED: { label: 'Resolvido', tone: 'neutral', icon: 'check-circle' },
  },

  riskBand: {
    LOW: { label: 'Baixo', tone: 'success', icon: 'check-circle' },
    MEDIUM: { label: 'Médio', tone: 'warning', icon: 'alert-circle' },
    HIGH: { label: 'Alto', tone: 'risk', icon: 'alert-triangle' },
    CRITICAL: { label: 'Crítico', tone: 'danger', icon: 'alert-triangle' },
  },
};

/**
 * Devolve `undefined` para estado desconhecido -- NUNCA um rotulo inventado
 * nem o codigo cru. Quem chama decide o que fazer com a ausencia; devolver o
 * codigo em ingles vazaria dominio para a tela do usuario.
 */
export function stateLabel(machine: StateMachine, state: string): StateLabel | undefined {
  return STATE_LABELS[machine][state];
}
