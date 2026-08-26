import type { KioskConfig } from '@arenahub/api-contracts';

/** Um card da grade da area interna -- `DS-TOTEM.md` §3.10 e §5.2. */
export interface CardDeModulo {
  readonly campo: keyof KioskConfig['modulos'];
  readonly titulo: string;
  readonly destino: string;
  /** `transacao` ganha destaque visual: e a unica que muda estado. */
  readonly natureza: 'leitura' | 'transacao';
}

/**
 * A grade do `DS-TOTEM.md` §5.2, na ordem em que o documento a desenha.
 *
 * A ORDEM E ESTA LISTA -- nao ha campo `ordem` na config, e nao ha
 * ordenacao derivada de `Object.keys(config.modulos)`: a ordem das chaves de
 * um objeto e da declaracao do schema Zod, e mover um campo la reordenaria a
 * tela do totem sem ninguem pedir.
 *
 * `ranking` esta FORA: a F33 (MVP 5) e a fatia que o alimenta e nao foi
 * entregue -- modulo sem fatia entregue nao aparece (ADR-042, Decisao 5,
 * trava 2). O campo segue no contrato, e a ausencia aqui e o que o mantem
 * invisivel.
 */
const GRADE: readonly CardDeModulo[] = [
  {
    campo: 'avaliacao',
    titulo: 'Avaliação do mês',
    destino: 'Resumo da última medição',
    natureza: 'leitura',
  },
  {
    campo: 'evolucao',
    titulo: 'Evolução',
    destino: 'Comparação com a anterior',
    natureza: 'leitura',
  },
  {
    campo: 'historicoDeAvaliacoes',
    titulo: 'Histórico de avaliações',
    destino: 'Uma por mês',
    natureza: 'leitura',
  },
  {
    campo: 'pagamento',
    titulo: 'Pagamento',
    destino: 'Pagar por QR, na hora',
    natureza: 'transacao',
  },
  {
    campo: 'historicoDePagamentos',
    titulo: 'Histórico de pagamentos',
    destino: 'Faturas e comprovantes',
    natureza: 'leitura',
  },
];

/**
 * Os cards que ESTE totem exibe. Pura: recebe a config, devolve a lista.
 *
 * Modulo desligado sai da lista -- nao vem desabilitado, nao vem cinza.
 */
export function modulosVisiveis(config: KioskConfig): readonly CardDeModulo[] {
  return GRADE.filter((card) => config.modulos[card.campo]);
}
