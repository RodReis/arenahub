/**
 * Dinheiro e inteiro na menor unidade monetaria.
 *
 * Origem: M2-BR-001, CLAUDE.md ("proibido float para dinheiro"),
 * docs/DESIGN-UI.md §14.3 item 6.
 *
 * O que esta regra alcanca e o que nao alcanca:
 *
 *   alcanca   -> literal decimal escrito no codigo (0.1, 19.90), parseFloat
 *                e toFixed. Sao os tres jeitos de dinheiro virar float sem
 *                ninguem perceber.
 *
 *   NAO alcanca -> `a * b` onde ambos sao number vindos do banco. Detectar
 *                isso exige saber que aquele number e dinheiro, e o tipo
 *                Money ainda nao existe (ele nasce no MVP 2, card F12).
 *
 * Por isso esta config e opcional e nao entra na base: aplicada hoje sobre
 * codigo generico, proibiria float legitimo (latencia, percentual, peso
 * corporal do MVP 3). Quem a liga e o modulo financeiro, quando existir.
 *
 * Uso:
 *
 *   import base from '@arenahub/config/eslint';
 *   import money from '@arenahub/config/eslint/money';
 *   export default [...base, ...money];
 */
export default [
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[raw=/^[0-9]*\\.[0-9]+$/]',
          message:
            'Dinheiro e inteiro na menor unidade monetaria (M2-BR-001). ' +
            'Use centavos: 1990 em vez de 19.90.',
        },
        {
          selector: 'CallExpression[callee.name="parseFloat"]',
          message:
            'parseFloat produz float. Dinheiro e inteiro na menor unidade ' +
            'monetaria (M2-BR-001).',
        },
        {
          selector: 'CallExpression[callee.property.name="toFixed"]',
          message:
            'toFixed arredonda em ponto flutuante. Formate a partir do ' +
            'inteiro em centavos (M2-BR-001).',
        },
      ],
    },
  },
];
