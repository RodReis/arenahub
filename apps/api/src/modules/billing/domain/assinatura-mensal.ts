import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Regras da modalidade ASSINATURA -- ADR-043, Decisao 2; `SPEC-056`.
 *
 * FUNCOES PURAS (`CLAUDE.md`): sem banco, sem rede, sem relogio. O "agora"
 * entra por parametro.
 *
 * O QUE NAO ESTA AQUI, DE PROPOSITO: calendario, vencimento, carencia e
 * retry. Nada disso e novo -- `ciclo-de-cobranca.ts` e `retry-de-cobranca.ts`
 * ja decidem, e a assinatura REUSA. Duplicar o calculo aqui criaria uma
 * segunda fonte de verdade do ciclo, que e exatamente o que a Decisao 2
 * recusou ao dispensar o Subscriptions Engine da Getnet.
 */

export class AdesaoInvalidaError extends ErroDeDominio {
  constructor(codigo: string, motivo: string) {
    super(codigo, 409, motivo);
  }
}

/** O que precisa ser verdade para o aluno aderir. `SPEC-056` 2.2. */
export interface CandidatoAAdesao {
  /** Modalidade do plano da assinatura. */
  readonly modalidadeDoPlano: 'AVULSO' | 'ASSINATURA';
  /** O plano tem preco vigente na data da adesao? */
  readonly planoTemPrecoVigente: boolean;
  /** CPF do aluno, como esta cadastrado. Nulo = ausente. */
  readonly cpfDoAluno: string | null;
  /** Ha metodo de pagamento ATIVO e padrao? */
  readonly temCartaoAtivo: boolean;
  /** Ja existe recorrencia instalada nesta assinatura? */
  readonly jaAderiu: boolean;
  /** O aluno aceitou a recorrencia explicitamente NESTA operacao? */
  readonly aceitouRecorrencia: boolean;
  /** Status atual da assinatura. */
  readonly statusDaAssinatura: string;
}

/**
 * Status de assinatura que aceitam adesao.
 *
 * `CANCELLED` e `EXPIRED` ficam de fora pelo motivo obvio. `PAST_DUE`
 * TAMBEM ACEITA, e isso e deliberado: o aluno em atraso que cadastra cartao e
 * adere e exatamente quem se quer de volta ao dia -- recusar a adesao ali
 * manteria inadimplente alguem tentando pagar.
 */
const STATUS_QUE_ACEITAM_ADESAO = new Set(['PENDING', 'ACTIVE', 'PAST_DUE']);

/**
 * Valida a adesao a recorrencia, na ordem em que o operador consegue agir.
 *
 * A ORDEM IMPORTA e nao e estetica: quem esta no balcao com o aluno na frente
 * precisa saber O QUE FAZER, e a primeira recusa e a que ele le. "Plano nao e
 * de assinatura" manda trocar o plano; "sem CPF" manda completar o cadastro;
 * "sem cartao" manda cadastrar o cartao. Se o aceite fosse checado primeiro, o
 * operador marcaria o aceite para so entao descobrir que falta o CPF -- e o
 * aluno teria autorizado uma cobranca que nao aconteceu.
 */
export function validarAdesao(candidato: CandidatoAAdesao): void {
  if (candidato.modalidadeDoPlano !== 'ASSINATURA') {
    throw new AdesaoInvalidaError(
      'PLAN_NOT_SUBSCRIPTION',
      'Este plano e avulso; a cobranca recorrente exige plano na modalidade assinatura',
    );
  }

  if (!STATUS_QUE_ACEITAM_ADESAO.has(candidato.statusDaAssinatura)) {
    throw new AdesaoInvalidaError(
      'SUBSCRIPTION_NOT_ADHERABLE',
      `Assinatura em ${candidato.statusDaAssinatura} nao aceita adesao a recorrencia`,
    );
  }

  if (candidato.jaAderiu) {
    throw new AdesaoInvalidaError(
      'RECURRENCE_ALREADY_ACTIVE',
      'Esta assinatura ja tem cobranca recorrente ativa',
    );
  }

  if (!candidato.planoTemPrecoVigente) {
    throw new AdesaoInvalidaError(
      // O MESMO codigo que `BillingRepository` ja usava para o mesmo fato.
      // Dois codigos para "plano sem preco vigente" fariam a tela precisar
      // conhecer os dois, e um deles seria esquecido.
      'PLAN_WITHOUT_ACTIVE_PRICE',
      'Plano sem preco vigente; nao se assina o que nao tem preco',
    );
  }

  /*
   * ADR-043, Decisao 3: o antifraude do provedor RECUSA cartao sem CPF.
   *
   * Barrar aqui, e nao no provedor, e o que transforma uma recusa opaca
   * ("transacao negada") em instrucao ("complete o cadastro"). E o CPF
   * continua sem ser matricula nem identificador -- INV-009, INV-011 e
   * INV-012 seguem inteiras, como o proprio ADR exige.
   */
  if (candidato.cpfDoAluno === null || candidato.cpfDoAluno.trim() === '') {
    throw new AdesaoInvalidaError(
      'STUDENT_CPF_REQUIRED',
      'Aluno sem CPF; complete o cadastro antes de aderir a cobranca recorrente',
    );
  }

  if (!candidato.temCartaoAtivo) {
    throw new AdesaoInvalidaError(
      'PAYMENT_METHOD_MISSING',
      'Aluno sem cartao ativo; cadastre um metodo de pagamento antes de aderir',
    );
  }

  /*
   * O ACEITE E O ULTIMO, e nao por acaso -- ver a ordem no cabecalho.
   *
   * Sem ele e debito surpresa, que e o que gera contestacao (`SPEC-056` 2.2).
   */
  if (!candidato.aceitouRecorrencia) {
    throw new AdesaoInvalidaError(
      'RECURRENCE_CONSENT_REQUIRED',
      'A adesao exige aceite explicito da cobranca recorrente',
    );
  }
}

/**
 * O cartao esta perto de vencer?
 *
 * NAO EXISTE CANAL DE AVISO no sistema (nem in-app, nem WhatsApp), entao esta
 * funcao NAO notifica ninguem: ela responde a pergunta que a ficha do aluno
 * faz para a recepcao ver na tela, e e a pessoa do balcao que avisa. Decisao
 * do PI em 25/08/2026. Quando existir infra de notificacao, o canal consome
 * ESTA funcao -- nao reimplementa a conta.
 *
 * `expMonth` e 1..12, como o provedor devolve. O cartao vale ate o ULTIMO
 * INSTANTE do mes de vencimento: cartao 08/2026 funciona o agosto inteiro, e
 * tratar como 01/08 mataria o cartao um mes cedo.
 */
export function cartaoVenceEm(
  cartao: { expMonth: number | null; expYear: number | null },
  agora: Date,
  janelaEmDias = 45,
): { vencido: boolean; venceEmBreve: boolean } | null {
  if (cartao.expMonth === null || cartao.expYear === null) {
    return null;
  }

  if (
    !Number.isInteger(cartao.expMonth) ||
    cartao.expMonth < 1 ||
    cartao.expMonth > 12 ||
    !Number.isInteger(cartao.expYear)
  ) {
    return null;
  }

  // Primeiro instante do mes SEGUINTE ao de vencimento -- e quando o cartao
  // deixa de valer. `Date.UTC` com mes 12 rola para janeiro do ano seguinte
  // sozinho, sem `if` de virada de ano.
  const expiraEm = new Date(Date.UTC(cartao.expYear, cartao.expMonth, 1));

  if (agora.getTime() >= expiraEm.getTime()) {
    return { vencido: true, venceEmBreve: false };
  }

  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const diasAteExpirar = (expiraEm.getTime() - agora.getTime()) / MS_POR_DIA;

  return { vencido: false, venceEmBreve: diasAteExpirar <= janelaEmDias };
}
