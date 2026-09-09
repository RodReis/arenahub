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
  /** F15 -- situacao de ACESSO de quem esta devendo. Nao e o estado da invoice. */
  | 'delinquencyAccess'
  | 'payment'
  | 'reconciliation'
  /** F34 -- estado do DESAFIO na tela da secretaria (ADR-048). */
  | 'challenge'
  | 'riskBand'
  /**
   * F-multiarquivo -- leitura de um valor extraido contra a faixa do
   * fabricante (`apps/api/.../domain/leitura-de-faixa.ts`). Resolvida no
   * SERVIDOR (ver o cabecalho daquele arquivo): o painel so rotula o que
   * chegou pronto, nunca recalcula.
   */
  | 'leitura'
  /**
   * F-multiarquivo -- estado do CARTAO de arquivo na tela de revisao
   * (mock do PI: "Extraído" / "Revisar"). Derivado no cliente a partir de
   * `campo.state` de cada campo do arquivo (`cartoesDeArquivo`, `sessao.ts`)
   * -- nao e maquina de estado persistida, so um resumo por arquivo.
   */
  | 'fileReviewState'
  /**
   * F31, Task 11 -- `RankingSnapshotStatus` do placar mensal (painel). Tom
   * NEUTRO em `WITHHELD` de proposito -- `M5-BR-007` diz que a coorte abaixo
   * do minimo NAO E ERRO, e sim a politica funcionando; `danger`/`warning`
   * pintaria como falha o que e comportamento esperado.
   */
  | 'rankingSnapshot';

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
    /**
     * F15 -- rotulo PROPRIO, e nao reuso do de cima.
     *
     * As duas sao liberacoes humanas, mas quem le o historico precisa
     * distinguir "a recepcao abriu a catraca" de "o aluno entrou devendo, com
     * prazo". A segunda tem consequencia financeira e vence sozinha.
     *
     * `warning` e nao `success`: entrou, mas ha pendencia. Pintar de verde
     * faria a linha parecer normal num relatorio de inadimplencia.
     */
    [ALLOW_REASON.FINANCIAL_OVERRIDE]: {
      label: 'Liberado com pagamento pendente',
      tone: 'warning',
      icon: 'alert-circle',
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
    /**
     * F15 -- separada de `NO_ENTITLEMENT` de proposito.
     *
     * O rotulo diz o que a recepcao PRECISA FAZER, e as duas acoes sao
     * opostas: "sem plano vigente" manda vender um; "pagamento em atraso"
     * manda cobrar. Ate a F15 as duas situacoes liam a mesma frase.
     *
     * `warning` e nao `danger`: o aluno TEM plano, e a situacao se resolve
     * com um pagamento. `danger` e para quem nao tem direito nenhum.
     */
    [DENY_REASON.PAYMENT_OVERDUE]: {
      label: 'Pagamento em atraso',
      tone: 'warning',
      icon: 'alert-circle',
    },
    /**
     * F65 (ADR-053) -- a ACADEMIA esta suspensa por inadimplencia com o
     * ArenaHub, nao o aluno. `danger`, e nao `warning`: aqui ninguem entra,
     * de nenhum jeito, ate o dono da academia regularizar -- diferente de
     * `PAYMENT_OVERDUE`, que se resolve com uma liberacao pontual.
     */
    [DENY_REASON.TENANT_SUSPENDED]: {
      label: 'Academia suspensa por inadimplência',
      tone: 'danger',
      icon: 'ban',
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

  /**
   * Situacao de ACESSO de quem esta devendo -- F15, Slice 2.4.
   *
   * NAO E O ESTADO DA INVOICE. A mesma invoice `OVERDUE` aparece aqui como
   * `EM_CARENCIA` ou `BLOQUEADO`, conforme o instante de bloqueio ja tenha
   * passado -- e e essa a pergunta que a recepcao faz olhando a tela: "este
   * aluno entra agora?". Reusar a maquina `invoice` responderia outra coisa.
   *
   * `EM_CARENCIA` e `warning` e nao `danger`: o aluno ENTRA. Pintar de
   * vermelho quem ainda tem acesso faria a recepcao barrar por engano.
   */
  delinquencyAccess: {
    EM_CARENCIA: { label: 'Em carência', tone: 'warning', icon: 'clock' },
    BLOQUEADO: { label: 'Bloqueado', tone: 'danger', icon: 'x-circle' },
    LIBERADO: { label: 'Liberado com pendência', tone: 'info', icon: 'user-check' },
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

  /*
   * F34 -- desafios (ADR-048).
   *
   * `DRAFT` e rotulado "Fechado", nao "Rascunho": para a secretaria o que
   * importa e que o aluno ainda NAO ve o desafio, nao o nome interno do
   * estado. Mesma razao pela qual `ACTIVE` vira "Aberto" -- ela pensa em
   * inscricao aberta, nao em registro ativo.
   */
  challenge: {
    DRAFT: { label: 'Fechado', tone: 'neutral', icon: 'lock' },
    ACTIVE: { label: 'Aberto', tone: 'success', icon: 'check-circle' },
    CLOSED: { label: 'Encerrado', tone: 'neutral', icon: 'check-circle' },
    CANCELLED: { label: 'Cancelado', tone: 'neutral', icon: 'minus' },
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

  /**
   * `BELOW`/`ABOVE` NAO tem tom fixo de bem/mal aqui -- depende da metrica
   * (gordura ALTA e atencao, massa muscular ALTA e o oposto). Este dicionario
   * so nomeia a POSICAO contra a faixa; quem le decide o que ela significa
   * para aquele tipo de medida, exatamente como o servidor ja decide (nunca
   * o cliente).`warning` em `BELOW`/`ABOVE` e neutro-de-atencao: chama o
   * olho sem afirmar "ruim".
   */
  leitura: {
    WITHIN: { label: 'Dentro da faixa', tone: 'success', icon: 'check-circle' },
    AT_LIMIT: { label: 'No limite', tone: 'warning', icon: 'alert-circle' },
    BELOW: { label: 'Abaixo da faixa', tone: 'warning', icon: 'alert-circle' },
    ABOVE: { label: 'Acima da faixa', tone: 'warning', icon: 'alert-circle' },
    UNKNOWN: { label: 'Sem faixa publicada', tone: 'neutral', icon: 'minus' },
  },

  fileReviewState: {
    EXTRACTED: { label: 'Extraído', tone: 'success', icon: 'check-circle' },
    PENDING_REVIEW: { label: 'Revisar', tone: 'warning', icon: 'alert-circle' },
    // "Não foi possível ler" e não "Falhou": diz o que aconteceu com o
    // ARQUIVO, não que o sistema quebrou -- um PDF de traçado de ECG é
    // ilegível para o extrator e isso é normal, não defeito.
    FAILED: { label: 'Não foi possível ler', tone: 'danger', icon: 'x-circle' },
  },

  rankingSnapshot: {
    DRAFT: { label: 'Rascunho', tone: 'info', icon: 'clock' },
    PUBLISHED: { label: 'Publicado', tone: 'success', icon: 'check-circle' },
    // NEUTRO, nao danger/warning -- ver o comentario do StateMachine acima.
    WITHHELD: { label: 'Retido — coorte abaixo do mínimo', tone: 'neutral', icon: 'minus' },
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
