/**
 * Adiantamento de cobrança — o aluno paga hoje por meses futuros.
 *
 * Sem banco, sem rede, sem relógio (`CLAUDE.md`; "agora" entra por
 * parâmetro). Cada competência devolvida vira uma chamada separada a
 * `POST /api/v1/invoices` — a idempotência (INV-066) e o preço travado no
 * momento da abertura já vêm de `abrirInvoiceDoPeriodo` no backend; esta
 * função só decide QUAIS meses pedir.
 */

const MAXIMO_DE_MESES = 12;

/** Primeiro dia do mês de `data`, em UTC — mesma normalização de `competenciaDe` na API. */
function competenciaDe(data: Date): Date {
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), 1));
}

/**
 * As `quantidadeDeMeses` competências consecutivas a partir de `agora`,
 * começando no mês corrente — nunca pula mês, nunca duplica.
 *
 * TETO EM 12: adiantamento não é o mesmo produto que assinatura anual; um
 * valor absurdo aqui é digitação errada, não intenção real da recepção.
 */
export function competenciasParaAdiantar(agora: Date, quantidadeDeMeses: number): Date[] {
  if (!Number.isInteger(quantidadeDeMeses)) {
    throw new Error('quantidade de meses deve ser um numero inteiro');
  }

  if (quantidadeDeMeses < 1) {
    throw new Error('quantidade de meses deve ser pelo menos 1');
  }

  if (quantidadeDeMeses > MAXIMO_DE_MESES) {
    throw new Error(`no maximo ${String(MAXIMO_DE_MESES)} meses de cada vez`);
  }

  const primeiroMes = competenciaDe(agora);

  return Array.from({ length: quantidadeDeMeses }, (_, indice) =>
    new Date(Date.UTC(primeiroMes.getUTCFullYear(), primeiroMes.getUTCMonth() + indice, 1)),
  );
}
