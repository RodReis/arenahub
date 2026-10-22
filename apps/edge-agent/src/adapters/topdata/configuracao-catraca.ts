import type { ConfiguracaoAcesso } from './easyinner-ponte.js';

/**
 * Modo de operacao da catraca, como o cadastro do TopAcademia o chama.
 *
 * O numero gravado na placa NAO e o modo: depende tambem de a catraca estar
 * instalada invertida. Quem traduz e `derivarConfiguracao`.
 */
export const MODOS_CATRACA = [
  'entrada-e-saida',
  'so-entrada',
  'so-saida',
  'saida-liberada',
  'entrada-liberada',
  'dois-sentidos-liberados',
] as const;

export type ModoCatraca = (typeof MODOS_CATRACA)[number];

/**
 * Acionamento/leitor que a placa recebe para um modo -- espelho do
 * `MontaConfiguracaoInner` do exemplo oficial C# do SDK EasyInner 6.0.2.0,
 * que o TopAcademia tambem segue (`Inners.ConstruirAcionamentos`).
 *
 * Numa catraca invertida o lado fisico se troca: "saida liberada" vira
 * acionamento 7 (CATRACA_ENTRADA_LIBERADA) + leitor 2 (SOMENTE_SAIDA). Gravar
 * 6 numa catraca invertida libera o lado errado -- Arena Positiva, 22/10/2026.
 *
 * Acionamento: 1 entrada e saida controladas, 2 so entrada, 3 so saida,
 * 6 saida liberada, 7 entrada liberada, 8 dois sentidos liberados.
 * Leitor: 0 desativado, 1 so entrada, 2 so saida, 3 entrada e saida.
 * Leitor 2 sempre desativado: a instalacao tem um leitor so.
 */
export function derivarConfiguracao(modo: ModoCatraca, invertida: boolean): ConfiguracaoAcesso {
  const par = (acionamento1: number, leitor1: number): ConfiguracaoAcesso => ({
    acionamento1,
    leitor1,
    leitor2: 0,
  });

  switch (modo) {
    case 'entrada-e-saida':
      return par(1, 3);
    case 'so-entrada':
      return invertida ? par(3, 2) : par(2, 1);
    case 'so-saida':
      return invertida ? par(2, 1) : par(3, 2);
    case 'saida-liberada':
      return invertida ? par(7, 2) : par(6, 1);
    case 'entrada-liberada':
      return invertida ? par(6, 1) : par(7, 2);
    case 'dois-sentidos-liberados':
      return par(8, 3);
  }
}
