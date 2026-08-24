/**
 * Aviso de vencimento -- F53 Task 12, spec SPEC-053 §3.4.
 *
 * DERIVADO, nao armazenado: a fatia nao cria tabela, provedor nem job. Tudo
 * que este arquivo produz sai de `dueAt`, `blockAt` e `status`, que a
 * resposta da API ja traz.
 *
 * FUNCAO PURA (`CLAUDE.md`): sem banco, sem rede, sem relogio. `agora` e
 * `timezone` entram por parametro, o que torna a regra testavel sem relogio
 * falso -- e prova as tres bordas do brief sem depender de quando o teste
 * roda de verdade.
 */

export type SituacaoDeVencimento = 'EM_DIA' | 'VENCE_EM_BREVE' | 'VENCIDA' | 'BLOQUEIO_PROXIMO';

export interface InvoiceParaAviso {
  readonly status: string;
  readonly dueAt: string;
  readonly blockAt: string | null;
}

/** Minimo para escolher a fatura em destaque: vencimento e um desempate estavel. */
export interface InvoiceCandidata {
  readonly id: string;
  readonly status: string;
  readonly dueAt: string;
}

/**
 * A fatura em aberto que a recepcao precisa resolver AGORA -- a de vencimento
 * mais antigo.
 *
 * ESCOLHE PELO CAMPO, nunca pela posicao na lista. Duas telas faziam
 * `lista[lista.length - 1]`, o que amarra o resultado a ordem que o backend
 * usa: enquanto ela foi `billingPeriod desc`, o calculo devolvia a fatura
 * errada sempre que competencia e vencimento discordavam -- o caso da fatura
 * reaberta.
 *
 * `id` desempata porque duas faturas do mesmo vencimento existem (cancelar e
 * reemitir produz exatamente isso), e sem criterio estavel cada carregamento
 * destacaria uma diferente.
 *
 * UMA COPIA SO, de proposito: a ficha do aluno e a tela de cobranca precisam
 * apontar para a MESMA fatura. Duas implementacoes divergiriam, e o aviso de
 * vencimento de uma nomearia fatura diferente da outra.
 */
export function faturaEmDestaque<T extends InvoiceCandidata>(
  invoices: readonly T[],
): T | null {
  const emAberto = invoices.filter(
    (invoice) => invoice.status === 'OPEN' || invoice.status === 'OVERDUE',
  );

  if (emAberto.length === 0) return null;

  return emAberto.reduce((maisAntiga, candidata) => {
    if (candidata.dueAt !== maisAntiga.dueAt) {
      return candidata.dueAt < maisAntiga.dueAt ? candidata : maisAntiga;
    }

    return candidata.id < maisAntiga.id ? candidata : maisAntiga;
  });
}

/**
 * Dias de atraso, em dia CIVIL no fuso da unidade -- zero quando ainda nao
 * venceu.
 *
 * MESMA conta de `situacaoDeVencimento`, exposta separada porque a tela
 * precisa do NUMERO ("3 dias de atraso"), nao so da faixa. Antes da revisao
 * final da F53 havia uma segunda implementacao em `situacao-atual.tsx` que
 * subtraia INSTANTES e ignorava o fuso -- as duas conviviam na mesma tela,
 * uma certa e uma errada, e perto da meia-noite discordavam.
 */
export function diasDeAtraso(
  /* So `dueAt` -- pedir `InvoiceParaAviso` inteiro obrigaria quem tem apenas a
     data a inventar `blockAt`, e o `blockAt` nao entra nesta conta. */
  invoice: { readonly dueAt: string },
  agora: Date,
  timezone: string,
): number {
  const dias = diferencaEmDias(invoice.dueAt, agora, timezone);

  return dias < 0 ? -dias : 0;
}

/**
 * A situacao de vencimento da invoice, para exibir sem clicar em nada.
 *
 * TRES REGRAS que decidem tudo aqui:
 *
 * 1. PAGA NUNCA E VENCIDA, mesmo com `dueAt` no passado -- e o caso mais
 *    comum do historico: toda fatura paga do ano passado venceu ha meses.
 *    Por isso o status entra ANTES de qualquer conta de data.
 * 2. NO DIA DO VENCIMENTO A INVOICE AINDA NAO VENCEU. Comparar instante
 *    contra instante marcaria a fatura como vencida as 00:01 do proprio
 *    dia -- a comparacao e de DIA CIVIL no fuso da unidade, nunca de
 *    instante.
 * 3. O FUSO E O DA UNIDADE, sem fallback: quem chama precisa ter resolvido
 *    de onde veio o fuso (INV-144) antes de chegar aqui.
 *
 * `BLOQUEIO_PROXIMO` depende do PROPRIO `blockAt` da invoice, nao de uma
 * conta derivada de `dueAt`: a carencia entre vencer e bloquear e
 * configuracao por tenant (ADR-019), e so o backend sabe o prazo real.
 */
export function situacaoDeVencimento(
  invoice: InvoiceParaAviso,
  agora: Date,
  timezone: string,
): SituacaoDeVencimento {
  if (invoice.status !== 'OPEN' && invoice.status !== 'OVERDUE') {
    return 'EM_DIA';
  }

  const diasAteVencer = diferencaEmDias(invoice.dueAt, agora, timezone);

  if (diasAteVencer > 0) {
    return 'EM_DIA';
  }

  if (diasAteVencer === 0) {
    return 'VENCE_EM_BREVE';
  }

  // Vencida (diasAteVencer < 0). Bloqueio proximo cede a vez quando o
  // PROPRIO blockAt cai hoje ou ja passou -- nao existe blockAt no ainda-nao
  // aberto por atraso do dia do vencimento (diasAteVencer === 0 ja retornou
  // acima).
  if (invoice.blockAt !== null && diferencaEmDias(invoice.blockAt, agora, timezone) <= 0) {
    return 'BLOQUEIO_PROXIMO';
  }

  return 'VENCIDA';
}

/**
 * `referencia` menos `agora`, em dias CIVIS -- positivo quando `referencia`
 * ainda esta no futuro.
 *
 * ASSIMETRIA DELIBERADA entre os dois lados da conta:
 *
 * - `referenciaIso` (`dueAt`/`blockAt`) e DATA, nao instante: o backend
 *   grava `Date.UTC(ano, mes, diaDeVencimento)` (`ciclo-de-cobranca.ts`,
 *   `proximoVencimento`) -- meia-noite UTC e so a forma de representar "o
 *   dia X", igual a `birthDate`. Reconverter esse UTC pelo fuso da unidade
 *   *voltaria* um dia (21h em Sao Paulo de um dia vira 00h UTC do dia
 *   seguinte) e erraria o vencimento por 24h. Por isso o dia da referencia
 *   le OS COMPONENTES UTC direto da ISO, sem fuso.
 * - `agora` E um instante de verdade (o relogio de parede), e so ele precisa
 *   do fuso da unidade para responder "que dia e hoje, LA". Comparar
 *   instante contra instante marcaria a fatura como vencida as 00:01 do
 *   proprio dia do vencimento -- a comparacao e de DIA CIVIL, nunca de
 *   instante.
 */
function diferencaEmDias(referenciaIso: string, agora: Date, timezone: string): number {
  const diaDaReferencia = diaCivilUtcComoNumero(referenciaIso);
  const diaDeAgora = diaCivilComoNumero(agora, timezone);

  return Math.round((diaDaReferencia - diaDeAgora) / DIA_EM_MS);
}

/** O dia civil de uma data-calendario armazenada como meia-noite UTC. */
function diaCivilUtcComoNumero(iso: string): number {
  const data = new Date(iso);

  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
}

const DIA_EM_MS = 24 * 60 * 60 * 1000;

/**
 * O dia civil do instante, no fuso dado, como epoch UTC da meia-noite
 * daquele dia -- serve so para SUBTRAIR dois dias e obter a diferenca em
 * dias inteiros, nunca como instante real (a meia-noite local pode nao
 * corresponder a esse epoch de verdade, em fuso com deslocamento nao
 * inteiro de hora -- irrelevante aqui, que so compara).
 */
function diaCivilComoNumero(instante: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);

  const valor = (tipo: string): number => {
    const parte = partes.find((p) => p.type === tipo)?.value;

    if (parte === undefined) {
      throw new RangeError(`fuso invalido para aviso de vencimento: ${timezone}`);
    }

    return Number(parte);
  };

  return Date.UTC(valor('year'), valor('month') - 1, valor('day'));
}
