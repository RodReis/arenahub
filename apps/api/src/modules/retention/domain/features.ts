/**
 * As 13 features iniciais do MVP 6 (F36, Slice 6.1, PRD §9).
 *
 * PURO: sem banco, sem relogio, sem fuso. Os fatos ja chegam datados e o
 * "agora" e a data de observacao, por parametro -- `CLAUDE.md`.
 *
 * ---------------------------------------------------------------------------
 * A LISTA E FECHADA, E ISSO E PROPOSITAL.
 * ---------------------------------------------------------------------------
 *
 * O PRD §9 lista 13 features e proibe explicitamente sexo, raca inferida,
 * biometria, diagnostico e composicao corporal. `NOMES_DE_FEATURE` e a lista
 * inteira, em `const`: acrescentar uma feature exige editar este arquivo, o
 * que torna a adicao de um proxy sensivel uma decisao visivel em diff em vez
 * de um campo que apareceu no snapshot sem ninguem notar.
 *
 * Por isso tambem NENHUMA funcao aqui recebe o aluno inteiro -- so os fatos de
 * que precisa. Nao ha como ler `student.registeredSex` de dentro de um
 * calculo, porque ele nunca chega aqui.
 */

import {
  diasDistintos,
  diasEntre,
  fatosDaJanela,
  type FatoDatado,
  type RecorteDeSnapshot,
} from './janela-as-of.js';
import { ausente, observado, type ValorDeFeature } from './valor-de-feature.js';

/** As 13 features do PRD §9. Fechada por construcao. */
export const NOMES_DE_FEATURE = [
  'attendance_days_7d',
  'attendance_days_30d',
  'attendance_days_90d',
  'attendance_change_30d_vs_previous_30d',
  'days_since_last_confirmed_passage',
  'subscription_age_days',
  'days_to_subscription_end',
  'past_due_invoice_count',
  'days_past_due',
  'payment_failure_count_90d',
  'pause_count_180d',
  'days_since_last_published_assessment',
  'engagement_opt_in_activity_30d',
] as const;

export type NomeDeFeature = (typeof NOMES_DE_FEATURE)[number];

/** Uma sessao de treino: dia local ja resolvido pelo repositorio (F24). */
export interface SessaoDeTreino extends FatoDatado {
  /** `AAAA-MM-DD` no fuso da unidade. Texto, nunca `Date` -- ver F32. */
  readonly diaLocal: string;
}

/**
 * Uma invoice, pelas TRES datas imutaveis.
 *
 * `status` NAO entra: ele e mutavel e diria o estado de hoje, nao o da data de
 * observacao. `dueAt`/`paidAt`/`createdAt` bastam e nunca mudam -- "estava
 * vencida em D" e aritmetica sobre elas, nao consulta de estado.
 */
export interface InvoiceDatada {
  readonly criadaEm: Date;
  readonly venceEm: Date;
  readonly paganaEm: Date | null;
}

/**
 * Uma tentativa de pagamento que falhou.
 *
 * Alias e nao interface propria: nao ha campo alem das duas datas, e herdar
 * sem acrescentar nada so daria ao leitor a impressao de que existe algo mais.
 * O nome carrega o significado; o tipo carrega as datas.
 */
export type FalhaDePagamento = FatoDatado;

/** Uma pausa registrada na timeline append-only. */
export type PausaRegistrada = FatoDatado;

/** Contexto da assinatura, pelas datas imutaveis. */
export interface AssinaturaDatada {
  readonly iniciaEm: Date;
  /** `null` = plano sem termino previsto. */
  readonly terminaEm: Date | null;
}

// --------------------------------------------------------------------------
// Frequencia
// --------------------------------------------------------------------------

/**
 * Dias DISTINTOS treinados numa janela.
 *
 * `semHistorico` separa "nao treinou" de "nao havia como treinar": o aluno que
 * entrou ha 3 dias nao tem 30 dias de janela, e devolver `0` o faria parecer
 * tao ausente quanto quem sumiu por um mes (`M6-BR-002`).
 */
export function diasTreinados(
  nome: NomeDeFeature,
  sessoes: readonly SessaoDeTreino[],
  recorte: RecorteDeSnapshot,
  janelaEmDias: number,
  janelaCoberta: boolean,
): ValorDeFeature {
  if (!janelaCoberta) return ausente(nome, 'SEM_HISTORICO');

  const naJanela = fatosDaJanela(sessoes, recorte, janelaEmDias);

  return observado(nome, diasDistintos(naJanela.map((sessao) => sessao.diaLocal)));
}

/**
 * Variacao relativa de frequencia: 30 dias contra os 30 anteriores.
 *
 * Devolve a razao `(atual - anterior) / anterior`. `-1` = parou de vir; `0` =
 * manteve; positivo = aumentou.
 *
 * DENOMINADOR ZERO E AUSENTE, NAO RISCO MAXIMO. Quem nao treinou no periodo
 * anterior nao tem variacao definida -- dividir por zero daria `Infinity`, e
 * trata-lo como "piorou infinito" poria no topo da fila justamente o aluno de
 * quem nada se sabe. O plano da Slice 6.1 pede isso explicitamente ("denominador
 * zero como missing, nao risco maximo").
 */
export function variacaoDeFrequencia(
  sessoes: readonly SessaoDeTreino[],
  recorte: RecorteDeSnapshot,
  janelaCoberta: boolean,
): ValorDeFeature {
  const nome = 'attendance_change_30d_vs_previous_30d';

  if (!janelaCoberta) return ausente(nome, 'SEM_HISTORICO');

  const ultimos30 = diasDistintos(
    fatosDaJanela(sessoes, recorte, 30).map((sessao) => sessao.diaLocal),
  );

  /*
   * Os 30 ANTERIORES: tudo dentro de 60 dias menos o que esta dentro de 30.
   * Recortar por diferenca em vez de deslocar `observadoEm` mantem o corte de
   * conhecimento intacto -- mover a observacao para tras faria a janela
   * anterior enxergar fatos por um corte que nao e o do snapshot.
   */
  const dentroDe60 = fatosDaJanela(sessoes, recorte, 60);
  const dentroDe30 = new Set(fatosDaJanela(sessoes, recorte, 30));
  const anteriores = dentroDe60.filter((sessao) => !dentroDe30.has(sessao));
  const previos = diasDistintos(anteriores.map((sessao) => sessao.diaLocal));

  if (previos === 0) return ausente(nome, 'SEM_HISTORICO');

  return observado(nome, (ultimos30 - previos) / previos);
}

/** Dias desde a ultima passagem confirmada conhecida ate o corte. */
export function diasDesdeUltimaPassagem(
  sessoes: readonly SessaoDeTreino[],
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const nome = 'days_since_last_confirmed_passage';

  /*
   * Janela de 90 dias e nao "toda a historia": o aluno que sumiu ha dois anos
   * satura a feature num numero enorme que so adiciona ruido. Fora da janela,
   * ausente -- e a ausencia ja diz o que precisa ser dito.
   */
  const naJanela = fatosDaJanela(sessoes, recorte, 90);

  if (naJanela.length === 0) return ausente(nome, 'SEM_HISTORICO');

  const ultima = naJanela.reduce((maior, atual) =>
    atual.ocorreuEm > maior.ocorreuEm ? atual : maior,
  );

  return observado(nome, diasEntre(ultima.ocorreuEm, recorte.observadoEm));
}

// --------------------------------------------------------------------------
// Assinatura
// --------------------------------------------------------------------------

/** Idade da assinatura em dias, na data de observacao. */
export function idadeDaAssinatura(
  assinatura: AssinaturaDatada,
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const nome = 'subscription_age_days';

  if (assinatura.iniciaEm > recorte.observadoEm) return ausente(nome, 'NAO_APLICAVEL');

  return observado(nome, diasEntre(assinatura.iniciaEm, recorte.observadoEm));
}

/**
 * Dias ate o termino da assinatura. Negativo se ja terminou.
 *
 * Plano sem termino e `NAO_APLICAVEL`, nao zero: zero significaria "termina
 * hoje", que e o oposto de "nao termina".
 */
export function diasParaTerminoDaAssinatura(
  assinatura: AssinaturaDatada,
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const nome = 'days_to_subscription_end';

  if (assinatura.terminaEm === null) return ausente(nome, 'NAO_APLICAVEL');

  return observado(nome, diasEntre(recorte.observadoEm, assinatura.terminaEm));
}

/**
 * Pausas nos ultimos 180 dias.
 *
 * Vem da timeline (`SUBSCRIPTION_PAUSED`), que e append-only -- por isso
 * `AS_OF` de verdade. Ler `Subscription.status` daria so o estado de hoje e
 * apagaria toda pausa ja retomada, que e justamente o sinal procurado.
 */
export function pausasNaJanela(
  pausas: readonly PausaRegistrada[],
  recorte: RecorteDeSnapshot,
  janelaCoberta: boolean,
): ValorDeFeature {
  const nome = 'pause_count_180d';

  if (!janelaCoberta) return ausente(nome, 'SEM_HISTORICO');

  return observado(nome, fatosDaJanela(pausas, recorte, 180).length);
}

// --------------------------------------------------------------------------
// Financeiro
// --------------------------------------------------------------------------

/**
 * `true` se a invoice estava vencida e nao paga NA data de observacao.
 *
 * Aritmetica sobre datas imutaveis, sem tocar em `status`:
 *
 *   - ja existia    (`criadaEm <= observacao`);
 *   - ja tinha vencido (`venceEm < observacao`);
 *   - nao estava paga AINDA -- `paganaEm` nulo, ou POSTERIOR a observacao.
 *
 * A ultima condicao e a que faz o passado ser passado: a invoice paga ontem
 * ESTAVA vencida no mes passado, e ler o estado de hoje a esconderia.
 */
export function estavaVencidaEm(invoice: InvoiceDatada, observadoEm: Date): boolean {
  if (invoice.criadaEm > observadoEm) return false;
  if (invoice.venceEm >= observadoEm) return false;

  return invoice.paganaEm === null || invoice.paganaEm > observadoEm;
}

/** Quantas invoices estavam vencidas na data de observacao. */
export function invoicesVencidas(
  invoices: readonly InvoiceDatada[],
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const vencidas = invoices.filter((invoice) => estavaVencidaEm(invoice, recorte.observadoEm));

  // Zero aqui e OBSERVADO: "nao devia nada" e um fato, nao uma lacuna.
  return observado('past_due_invoice_count', vencidas.length);
}

/**
 * Dias de atraso da invoice vencida ha MAIS tempo.
 *
 * A mais antiga, e nao a soma nem a media: duas invoices de 5 dias nao sao um
 * atraso de 10 dias, e o que a operacao precisa saber e ha quanto tempo o
 * aluno esta inadimplente.
 */
export function diasEmAtraso(
  invoices: readonly InvoiceDatada[],
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const nome = 'days_past_due';
  const vencidas = invoices.filter((invoice) => estavaVencidaEm(invoice, recorte.observadoEm));

  if (vencidas.length === 0) return observado(nome, 0);

  const maisAntiga = vencidas.reduce((menor, atual) =>
    atual.venceEm < menor.venceEm ? atual : menor,
  );

  return observado(nome, diasEntre(maisAntiga.venceEm, recorte.observadoEm));
}

/**
 * Falhas de pagamento em 90 dias.
 *
 * MARCADA `ESTADO_CORRENTE` -- a unica das 13 que nao e `AS_OF`.
 *
 * `PaymentAttempt.status` e mutavel: uma tentativa transita `PROCESSING` ->
 * `FAILED` depois do fato, entao uma falha ocorrida dentro da janela pode ser
 * CONHECIDA so depois dela. O filtro de conhecimento de `fatosDaJanela` ja
 * descarta o que chegou tarde, mas nao ha trilha que prove quando a transicao
 * aconteceu -- o repositorio usa `requestedAt` como aproximacao.
 *
 * A marca e o que permite a F40 excluir esta feature do treino com um filtro,
 * em vez de refazer a fatia para descobrir em quais confiar.
 */
export function falhasDePagamento(
  falhas: readonly FalhaDePagamento[],
  recorte: RecorteDeSnapshot,
  janelaCoberta: boolean,
): ValorDeFeature {
  const nome = 'payment_failure_count_90d';

  if (!janelaCoberta) return ausente(nome, 'SEM_HISTORICO', 'ESTADO_CORRENTE');

  return observado(nome, fatosDaJanela(falhas, recorte, 90).length, 'ESTADO_CORRENTE');
}

// --------------------------------------------------------------------------
// Avaliacao e engajamento
// --------------------------------------------------------------------------

/**
 * Dias desde a ultima avaliacao PUBLICADA.
 *
 * So a data de publicacao entra -- `publishedAt`, nunca uma medida. A regra de
 * arquitetura no 8 e o PRD §9 proibem composicao corporal nas features, e
 * receber apenas `Date` aqui torna a violacao impossivel de escrever: o valor
 * corporal nunca chega a este arquivo.
 */
export function diasDesdeUltimaAvaliacao(
  publicacoes: readonly FatoDatado[],
  recorte: RecorteDeSnapshot,
): ValorDeFeature {
  const nome = 'days_since_last_published_assessment';
  const conhecidas = publicacoes.filter(
    (fato) =>
      fato.ocorreuEm <= recorte.observadoEm && fato.conhecidoEm <= recorte.corteDeConhecimento,
  );

  if (conhecidas.length === 0) return ausente(nome, 'SEM_HISTORICO');

  const ultima = conhecidas.reduce((maior, atual) =>
    atual.ocorreuEm > maior.ocorreuEm ? atual : maior,
  );

  return observado(nome, diasEntre(ultima.ocorreuEm, recorte.observadoEm));
}

/**
 * Atividade de engajamento em 30 dias.
 *
 * `suprimido` cobre `M6-FR-006`: opt-out vigente devolve `SUPRIMIDA`, nao
 * zero. Zero significaria "participa e nao fez nada" -- exatamente o oposto de
 * "pediu para nao participar", e usar o dado de quem saiu seria usar o que a
 * pessoa negou.
 */
export function atividadeDeEngajamento(
  atividades: readonly FatoDatado[],
  recorte: RecorteDeSnapshot,
  suprimido: boolean,
): ValorDeFeature {
  const nome = 'engagement_opt_in_activity_30d';

  if (suprimido) return ausente(nome, 'SUPRIMIDA');

  return observado(nome, fatosDaJanela(atividades, recorte, 30).length);
}
