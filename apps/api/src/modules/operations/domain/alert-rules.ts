/**
 * Regras de alerta operacional -- F11, `M1-FR-030`, INV-146.
 *
 * FUNCOES PURAS. Sem banco, sem relogio, sem rede: o "agora" entra por
 * parametro. Mesma disciplina do motor de acesso, pelo mesmo motivo -- estas
 * regras decidem se alguem e acordado as 6h da manha, e um teste que precisa
 * esperar 90 s reais para provar um limite de 90 s nao seria escrito.
 *
 * INV-146 (ADR-011): **a ausencia do Edge e alerta obrigatorio**, nao linha
 * de log. Sem operacao offline, Edge fora significa catraca parada -- a
 * operacao precisa saber no minuto em que acontece, nao quando o primeiro
 * aluno reclama na recepcao.
 */

/**
 * Codigos de alerta. Estaveis: vao para o painel, para o runbook e para o
 * historico persistido.
 *
 * O QUE NAO ESTA AQUI, E POR QUE:
 *
 * `SNAPSHOT_STALE` e `BACKLOG_HIGH` estao no plano de apoio da fatia, mas
 * dependem de snapshot assinado e fila offline -- que sao a Slice 1.5 (F10),
 * fora do MVP 1 por ADR-012. Alertar sobre estado que nao existe produziria
 * alarme que nunca dispara, e alarme que nunca dispara e pior que alarme
 * nenhum: ele ensina a operacao a confiar num sensor cego. Entram com F10.
 */
export const CODIGO_DE_ALERTA = {
  /**
   * Edge parou de dar sinal de vida.
   *
   * Causa fisica: PC desligado, rede caida, servico parado.
   */
  EDGE_OFFLINE: 'EDGE_OFFLINE',
  /**
   * Edge vivo, mas a credencial nao renovou.
   *
   * ⚠️ SEPARADO DE `EDGE_OFFLINE` POR EXIGENCIA DO ADR-011 (segunda rodada),
   * e a separacao e o ponto inteiro: as duas falhas tem a MESMA consequencia
   * -- catraca parada -- e ACOES OPOSTAS. `EDGE_OFFLINE` manda alguem olhar o
   * PC da academia; este aqui manda olhar a rotacao de credencial, que e
   * problema de quem opera a nuvem.
   *
   * Juntar os dois num alarme so faria a recepcao ligar para a pessoa errada,
   * e transformaria a rotacao automatica num jeito novo de a catraca parar em
   * silencio.
   */
  EDGE_CREDENTIAL_EXPIRING: 'EDGE_CREDENTIAL_EXPIRING',
  /** Dispositivo (leitor ou catraca) sem heartbeat. */
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  /** Sincronizacao de identidade falhou em definitivo. */
  SYNC_FAILED: 'SYNC_FAILED',
  /** Taxa diaria de sync abaixo do minimo de `M1` §3. */
  SYNC_SUCCESS_RATE_LOW: 'SYNC_SUCCESS_RATE_LOW',
  /** Ha dead letter sem resolucao. */
  DLQ_NON_EMPTY: 'DLQ_NON_EMPTY',
  /** Relogio do Edge fora do limite aprovado. */
  CLOCK_DRIFT: 'CLOCK_DRIFT',
  /**
   * Evento do provedor recebido e NAO aplicado ha tempo demais -- F16.
   *
   * Recebido != aplicado: um evento fora de ordem, de tipo desconhecido ou
   * cujo pagamento nao foi localizado fica guardado sem mudar estado. Isso e
   * correto pontualmente e sintoma quando persiste -- o dinheiro entrou no
   * provedor e o aluno continua bloqueado na catraca.
   */
  WEBHOOK_BACKLOG: 'WEBHOOK_BACKLOG',
  /**
   * Conta do provedor sem NENHUM evento na janela esperada -- F16.
   *
   * SEPARADO DE `WEBHOOK_BACKLOG` porque as duas falhas tem acoes OPOSTAS,
   * pelo mesmo criterio que separou `EDGE_OFFLINE` de
   * `EDGE_CREDENTIAL_EXPIRING` (ADR-011). Backlog manda olhar o
   * processamento; silencio manda olhar a configuracao do webhook no
   * provedor -- e silencio e a falha PIOR, porque nao produz erro nenhum:
   * tudo parece calmo enquanto nenhum pagamento e reconhecido.
   */
  WEBHOOK_SILENCIOSO: 'WEBHOOK_SILENCIOSO',
  /**
   * Divergencia de conciliacao em aberto -- F16, `M2-FR-020`.
   *
   * O `MVP-02` §3 pede divergencia "visivel no mesmo dia operacional". Sem
   * alerta, ela so aparece para quem abrir a tela de conciliacao por conta
   * propria -- e a fila que ninguem abre e a fila que nao existe.
   */
  RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
} as const;

export type CodigoDeAlerta = (typeof CODIGO_DE_ALERTA)[keyof typeof CODIGO_DE_ALERTA];

/**
 * Severidade.
 *
 * `CRITICAL` significa **a catraca nao esta funcionando agora**. Nada mais
 * ganha esse rotulo: uma severidade que se aplica a tudo nao prioriza nada, e
 * o painel vira um mar vermelho que a operacao aprende a ignorar.
 */
export type Severidade = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Alerta {
  readonly codigo: CodigoDeAlerta;
  readonly severidade: Severidade;
  /**
   * Tipo do recurso afetado, para agrupar no painel.
   *
   * `BILLING` entrou na F16: a saude do webhook de pagamento e da conciliacao
   * e operacional, nao financeira -- quem age sobre ela e a mesma pessoa que
   * olha catraca parada, e um painel separado so para dinheiro seria uma
   * segunda tela que ninguem abre.
   */
  readonly recurso: 'EDGE' | 'DEVICE' | 'SYNC' | 'QUEUE' | 'BILLING';
  readonly recursoId: string;
  readonly gymUnitId: string | null;
  /**
   * O que o operador PERDE enquanto isto durar. Em pt-BR, porque vai direto
   * para a tela -- e "sem impacto declarado" e como um alerta vira ruido.
   */
  readonly impacto: string;
  /** O que fazer AGORA. Uma acao, nao um diagnostico. */
  readonly acaoRecomendada: string;
  /** Numeros que sustentam o alerta. Nunca PII. */
  readonly evidencia: Readonly<Record<string, string | number | boolean | null>>;
}

/** Limites, todos configuraveis por unidade em fatia futura. */
export interface LimitesDeAlerta {
  /** Sem heartbeat por mais que isto = offline. */
  readonly heartbeatMaximoMs: number;
  /** Credencial vencendo dentro desta janela ja alerta. */
  readonly antecedenciaDeCredencialMs: number;
  /** Deriva absoluta de relogio tolerada. */
  readonly derivaMaximaMs: number;
  /** Taxa diaria minima de sync, 0..1. */
  readonly taxaMinimaDeSync: number;
  /** Evento recebido e nao aplicado por mais que isto = backlog. */
  readonly backlogDeWebhookMaximoMs: number;
  /** Conta ativa sem evento nenhum por mais que isto = silencio suspeito. */
  readonly silencioDeWebhookMaximoMs: number;
}

/**
 * Padroes.
 *
 * 90 s de heartbeat vem do plano da fatia. Nao e arbitrario: o Edge bate a
 * cada 30 s, entao 90 s tolera DUAS batidas perdidas antes de acusar. Um
 * limite de 30 s dispararia a cada engasgo de rede e ensinaria a operacao a
 * ignorar o alarme.
 */
export const LIMITES_PADRAO: LimitesDeAlerta = {
  heartbeatMaximoMs: 90_000,
  // 24 h: tempo de alguem em horario comercial reagir antes de a catraca
  // parar. Alertar na hora da expiracao seria alertar tarde demais.
  antecedenciaDeCredencialMs: 24 * 3_600_000,
  derivaMaximaMs: 5 * 60_000,
  taxaMinimaDeSync: 0.99,
  /**
   * 15 min. O `M2-NFR-001` exige p95 de webhook a entitlement abaixo de 30 s;
   * alertar em 30 s acusaria toda reentrega normal do provedor. Quinze minutos
   * e trinta vezes o SLO -- o que sobra ali nao e lentidao, e travamento.
   */
  backlogDeWebhookMaximoMs: 15 * 60_000,
  /**
   * 48 h. Uma academia pequena passa um dia sem PIX sem que nada esteja
   * errado; dois dias uteis seguidos sem UM evento e configuracao quebrada, e
   * nao movimento fraco.
   */
  silencioDeWebhookMaximoMs: 48 * 3_600_000,
};

/** O que o avaliador precisa saber sobre um Edge. */
export interface EstadoDoEdge {
  readonly edgeNodeId: string;
  readonly codigo: string;
  readonly gymUnitId: string;
  readonly ultimoHeartbeat: Date | null;
  readonly derivaMs: number | null;
  /** Fim da credencial ativa mais longeva. Nulo = sem credencial ativa. */
  readonly credencialExpiraEm: Date | null;
}

export interface EstadoDoDispositivo {
  readonly deviceId: string;
  readonly serial: string;
  readonly gymUnitId: string;
  readonly kind: string;
  readonly status: string;
  readonly ultimoHeartbeat: Date | null;
}

export interface EstadoDeSync {
  readonly gymUnitId: string;
  readonly falhasPermanentes: number;
  readonly deadLetters: number;
  readonly totalDoDia: number;
  readonly sucessosDoDia: number;
}

/**
 * Avalia um Edge.
 *
 * A ordem importa: `EDGE_OFFLINE` primeiro. Se o Edge sumiu, alertar que a
 * credencial dele vence amanha e ruido -- ninguem vai renovar credencial de
 * uma maquina que nao responde.
 */
export function avaliarEdge(
  estado: EstadoDoEdge,
  agora: Date,
  limites: LimitesDeAlerta = LIMITES_PADRAO,
): Alerta[] {
  const alertas: Alerta[] = [];

  const silencioMs =
    estado.ultimoHeartbeat === null
      ? Number.POSITIVE_INFINITY
      : agora.getTime() - estado.ultimoHeartbeat.getTime();

  if (silencioMs > limites.heartbeatMaximoMs) {
    alertas.push({
      codigo: CODIGO_DE_ALERTA.EDGE_OFFLINE,
      severidade: 'CRITICAL',
      recurso: 'EDGE',
      recursoId: estado.edgeNodeId,
      gymUnitId: estado.gymUnitId,
      impacto: 'A catraca desta unidade nao esta liberando acesso.',
      acaoRecomendada:
        'Verifique o PC da academia: energia, rede e o servico ArenaHub Edge. ' +
        'Enquanto isso, libere pela tela de liberacao manual.',
      evidencia: {
        edgeCode: estado.codigo,
        silencioSegundos: Number.isFinite(silencioMs) ? Math.round(silencioMs / 1000) : -1,
        nuncaBateu: estado.ultimoHeartbeat === null,
      },
    });

    // Edge mudo: as checagens seguintes usariam dado velho. Sair aqui evita
    // acusar deriva de relogio medida ha duas horas como se fosse de agora.
    return alertas;
  }

  // ADR-011: causa distinta, alerta distinto, acao distinta.
  if (estado.credencialExpiraEm !== null) {
    const restanteMs = estado.credencialExpiraEm.getTime() - agora.getTime();

    if (restanteMs <= limites.antecedenciaDeCredencialMs) {
      const jaVenceu = restanteMs <= 0;

      alertas.push({
        codigo: CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING,
        severidade: jaVenceu ? 'CRITICAL' : 'WARNING',
        recurso: 'EDGE',
        recursoId: estado.edgeNodeId,
        gymUnitId: estado.gymUnitId,
        impacto: jaVenceu
          ? 'A credencial venceu: o Edge esta vivo, mas a nuvem recusa as decisoes dele.'
          : 'A credencial vence em breve. Quando vencer, a catraca para de liberar.',
        // Note que a acao NAO manda olhar o PC da academia -- este e problema
        // de quem opera a nuvem, e mandar a recepcao conferir cabo seria
        // mandar a pessoa errada procurar no lugar errado.
        acaoRecomendada:
          'Rotacione a credencial do Edge pelo painel de dispositivos. ' +
          'Nao e necessario ir ate a academia.',
        evidencia: {
          edgeCode: estado.codigo,
          expiraEm: estado.credencialExpiraEm.toISOString(),
          horasRestantes: Math.round(restanteMs / 3_600_000),
        },
      });
    }
  } else {
    // Sem credencial ativa e o caso mais grave dos tres: nao ha o que
    // rotacionar, e o Edge vai parar assim que a sessao atual expirar.
    alertas.push({
      codigo: CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING,
      severidade: 'CRITICAL',
      recurso: 'EDGE',
      recursoId: estado.edgeNodeId,
      gymUnitId: estado.gymUnitId,
      impacto: 'O Edge nao tem credencial ativa: a nuvem vai recusar as decisoes dele.',
      acaoRecomendada: 'Emita uma credencial nova para este Edge no painel de dispositivos.',
      evidencia: { edgeCode: estado.codigo, semCredencialAtiva: true },
    });
  }

  if (estado.derivaMs !== null && Math.abs(estado.derivaMs) > limites.derivaMaximaMs) {
    alertas.push({
      codigo: CODIGO_DE_ALERTA.CLOCK_DRIFT,
      severidade: 'WARNING',
      recurso: 'EDGE',
      recursoId: estado.edgeNodeId,
      gymUnitId: estado.gymUnitId,
      impacto:
        'O horario do Edge esta fora de sincronia. Os eventos continuam sendo gravados com ' +
        'o horario do servidor, mas a investigacao de incidentes fica mais dificil.',
      acaoRecomendada: 'Sincronize o relogio do PC da academia com um servidor NTP.',
      evidencia: {
        edgeCode: estado.codigo,
        derivaSegundos: Math.round(estado.derivaMs / 1000),
      },
    });
  }

  return alertas;
}

export function avaliarDispositivo(
  estado: EstadoDoDispositivo,
  agora: Date,
  limites: LimitesDeAlerta = LIMITES_PADRAO,
): Alerta[] {
  // Equipamento em manutencao ou aposentado nao gera alarme: alguem ja sabe
  // que ele esta fora, e alarme sobre o que se sabe e ruido.
  if (estado.status !== 'ACTIVE') return [];

  const silencioMs =
    estado.ultimoHeartbeat === null
      ? Number.POSITIVE_INFINITY
      : agora.getTime() - estado.ultimoHeartbeat.getTime();

  if (silencioMs <= limites.heartbeatMaximoMs) return [];

  const ehCatraca = estado.kind === 'TURNSTILE';

  return [
    {
      codigo: CODIGO_DE_ALERTA.DEVICE_OFFLINE,
      severidade: 'CRITICAL',
      recurso: 'DEVICE',
      recursoId: estado.deviceId,
      gymUnitId: estado.gymUnitId,
      impacto: ehCatraca
        ? 'Esta catraca nao esta liberando acesso.'
        : 'Este leitor nao esta reconhecendo alunos.',
      acaoRecomendada: ehCatraca
        ? 'Verifique energia e cabo de rede da catraca. Libere pela tela de liberacao manual.'
        : 'Verifique energia e cabo de rede do leitor. Use o caminho alternativo de acesso.',
      evidencia: {
        serial: estado.serial,
        kind: estado.kind,
        silencioSegundos: Number.isFinite(silencioMs) ? Math.round(silencioMs / 1000) : -1,
        nuncaBateu: estado.ultimoHeartbeat === null,
      },
    },
  ];
}

export function avaliarSync(
  estado: EstadoDeSync,
  limites: LimitesDeAlerta = LIMITES_PADRAO,
): Alerta[] {
  const alertas: Alerta[] = [];

  if (estado.falhasPermanentes > 0) {
    alertas.push({
      codigo: CODIGO_DE_ALERTA.SYNC_FAILED,
      severidade: 'WARNING',
      recurso: 'SYNC',
      recursoId: estado.gymUnitId,
      gymUnitId: estado.gymUnitId,
      impacto:
        'Ha alunos cuja biometria nao chegou aos leitores. Eles vao ser recusados na catraca ' +
        'mesmo tendo plano valido.',
      acaoRecomendada:
        'Abra a fila de sincronizacao, veja o codigo do erro e siga o runbook de diagnostico.',
      evidencia: { falhasPermanentes: estado.falhasPermanentes },
    });
  }

  if (estado.deadLetters > 0) {
    alertas.push({
      codigo: CODIGO_DE_ALERTA.DLQ_NON_EMPTY,
      severidade: 'WARNING',
      recurso: 'QUEUE',
      recursoId: estado.gymUnitId,
      gymUnitId: estado.gymUnitId,
      impacto:
        'Ha trabalho parado que nao vai ser retentado sozinho. Enquanto ficar assim, ' +
        'a situacao nao se resolve com o tempo.',
      acaoRecomendada: 'Revise as dead letters no painel e decida entre reprocessar ou descartar.',
      evidencia: { deadLetters: estado.deadLetters },
    });
  }

  // Taxa so faz sentido com volume: 1 falha em 1 tentativa e 0% de sucesso e
  // nao diz nada sobre a saude do dia. `M1` §3 pede taxa diaria, e taxa sobre
  // amostra minuscula e numero que assusta sem informar.
  const VOLUME_MINIMO = 10;

  if (estado.totalDoDia >= VOLUME_MINIMO) {
    const taxa = estado.sucessosDoDia / estado.totalDoDia;

    if (taxa < limites.taxaMinimaDeSync) {
      alertas.push({
        codigo: CODIGO_DE_ALERTA.SYNC_SUCCESS_RATE_LOW,
        severidade: 'WARNING',
        recurso: 'SYNC',
        recursoId: estado.gymUnitId,
        gymUnitId: estado.gymUnitId,
        impacto:
          'A sincronizacao esta falhando com frequencia acima do aceitavel. ' +
          'Cadastros novos podem demorar a valer na catraca.',
        acaoRecomendada:
          'Verifique a conectividade com os leitores e o runbook de diagnostico de sync.',
        evidencia: {
          taxaPercentual: Math.round(taxa * 10_000) / 100,
          totalDoDia: estado.totalDoDia,
          sucessosDoDia: estado.sucessosDoDia,
        },
      });
    }
  }

  return alertas;
}

/** O que o avaliador precisa saber sobre o financeiro de um tenant -- F16. */
export interface EstadoDoFinanceiro {
  /** Conta do provedor, id INTERNO. Agrupa o alerta. */
  readonly providerAccountId: string;
  /** Evento mais antigo recebido e ainda nao aplicado. Nulo = fila limpa. */
  readonly eventoPendenteMaisAntigo: Date | null;
  readonly eventosPendentes: number;
  /** Ultimo evento recebido, aplicado ou nao. Nulo = nunca chegou nenhum. */
  readonly ultimoEventoRecebido: Date | null;
  /** Divergencias de conciliacao ainda em aberto. */
  readonly divergenciasEmAberto: number;
}

/**
 * Saude do webhook de pagamento e da conciliacao -- F16, INV-138.
 *
 * Funcao pura, como as demais: o "agora" entra por parametro. Um alerta que
 * so pode ser testado esperando 15 minutos reais nao seria testado.
 */
export function avaliarFinanceiro(
  estado: EstadoDoFinanceiro,
  agora: Date,
  limites: LimitesDeAlerta = LIMITES_PADRAO,
): Alerta[] {
  const alertas: Alerta[] = [];

  if (estado.eventoPendenteMaisAntigo) {
    const idadeMs = agora.getTime() - estado.eventoPendenteMaisAntigo.getTime();

    if (idadeMs > limites.backlogDeWebhookMaximoMs) {
      alertas.push({
        codigo: CODIGO_DE_ALERTA.WEBHOOK_BACKLOG,
        severidade: 'WARNING',
        recurso: 'BILLING',
        recursoId: estado.providerAccountId,
        gymUnitId: null,
        impacto:
          'Ha pagamento confirmado no provedor que ainda nao virou liberacao aqui. ' +
          'O aluno pagou e continua sendo recusado na catraca.',
        acaoRecomendada:
          'Abra a conciliacao do periodo e reprocesse os eventos pendentes; se persistir, ' +
          'consulte o status do pagamento pela API do provedor.',
        evidencia: {
          eventosPendentes: estado.eventosPendentes,
          idadeEmMinutos: Math.floor(idadeMs / 60_000),
        },
      });
    }
  }

  /**
   * Conta que NUNCA recebeu evento nao alerta.
   *
   * Conta recem-cadastrada tem `ultimoEventoRecebido` nulo, e acusar silencio
   * nela geraria alarme no dia da configuracao -- antes de existir cobranca
   * para gerar evento. O silencio que importa e o de quem JA recebeu e parou.
   */
  if (estado.ultimoEventoRecebido) {
    const silencioMs = agora.getTime() - estado.ultimoEventoRecebido.getTime();

    if (silencioMs > limites.silencioDeWebhookMaximoMs) {
      alertas.push({
        codigo: CODIGO_DE_ALERTA.WEBHOOK_SILENCIOSO,
        severidade: 'WARNING',
        recurso: 'BILLING',
        recursoId: estado.providerAccountId,
        gymUnitId: null,
        impacto:
          'Nenhum evento do provedor chega ha dois dias uteis. Se houver pagamento acontecendo, ' +
          'nenhum esta sendo reconhecido -- e nada nesta tela vai ficar vermelho por isso.',
        acaoRecomendada:
          'Confira no painel do provedor se a URL do webhook segue cadastrada e ativa; ' +
          'depois rode uma conciliacao do periodo para achar o que faltou.',
        evidencia: { silencioEmHoras: Math.floor(silencioMs / 3_600_000) },
      });
    }
  }

  if (estado.divergenciasEmAberto > 0) {
    alertas.push({
      codigo: CODIGO_DE_ALERTA.RECONCILIATION_PENDING,
      severidade: 'INFO',
      recurso: 'BILLING',
      recursoId: estado.providerAccountId,
      gymUnitId: null,
      impacto:
        'Ha movimento do provedor que nao bate com o registro do ArenaHub. ' +
        'Enquanto ficar assim, o fechamento do mes nao esta conferido.',
      acaoRecomendada: 'Abra a fila de conciliacao e resolva cada divergencia com o motivo.',
      evidencia: { divergenciasEmAberto: estado.divergenciasEmAberto },
    });
  }

  return alertas;
}

/**
 * Impressao digital estavel do alerta.
 *
 * `(tenant, unidade, recurso, codigo)` -- e o que faz uma condicao que
 * persiste ATUALIZAR a linha existente em vez de criar uma nova a cada
 * avaliacao. Sem isto, um Edge fora do ar por uma noite geraria 960 alertas
 * (30 s de intervalo x 8 h) e o painel viraria inutilizavel exatamente
 * quando mais precisa ser lido.
 */
export function impressaoDigital(
  tenantId: string,
  alerta: Pick<Alerta, 'codigo' | 'recurso' | 'recursoId' | 'gymUnitId'>,
): string {
  return [tenantId, alerta.gymUnitId ?? '-', alerta.recurso, alerta.recursoId, alerta.codigo].join(
    ':',
  );
}
