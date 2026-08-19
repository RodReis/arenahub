/* eslint-disable @typescript-eslint/no-unsafe-assignment --
 * `eslint-plugin-jsx-a11y` e JavaScript puro e nao publica `.d.ts`: o import
 * chega como `any`, e o `no-unsafe-assignment` do base.js reclama com razao.
 * A excecao e de UM arquivo e de UMA regra, com o motivo escrito, e some
 * sozinha no dia em que o plugin publicar tipos.
 */
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint de app React -- hooks e acessibilidade.
 *
 * SEPARADO DO base.js DE PROPOSITO: a `api` e o `edge-agent` nao tem JSX e
 * nao devem pagar o custo de carregar plugin de React. Quem tem JSX importa
 * este arquivo; quem nao tem, nao fica sabendo que ele existe.
 *
 * COMO LIGAR, no eslint.config.js do workspace com JSX:
 *
 *   import base from '@arenahub/config/eslint';
 *   import react from '@arenahub/config/eslint/react';
 *
 *   export default [...base, ...react];
 *
 * POR QUE ISTO EXISTE (issue #112): o `admin-web` usa `useActionState` e
 * `useFormStatus` em oito telas, mais o `useToastDeErro` do design system.
 * Sem `rules-of-hooks`, hook fora de ordem e dependencia faltante so
 * aparecem em RUNTIME -- e a F45 mostrou que defeito de runtime nesta app
 * sobrevive a 55 E2E verdes. `jsx-a11y` cobre o outro lado: o
 * `docs/design/DS-PAINEL.md` trata acessibilidade como requisito (rotulo
 * associado ao controle, alvo de toque, contraste), e nada automatizava
 * isso -- dependia de alguem lembrar em revisao.
 */
/**
 * Anotado explicitamente: sem isto o `tsc` tenta nomear o tipo inferido a
 * partir de `@types/estree` dentro de `.pnpm/`, um caminho que nao e
 * portavel entre maquinas (TS2742). Os configs irmaos nao precisam disso
 * porque nao importam plugin com tipo proprio.
 *
 * @type {import('eslint').Linter.Config[]}
 */
const config = [
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // --- As duas regras que a issue #112 pediu ------------------------
      // `rules-of-hooks` e `error` sem discussao: hook fora de ordem nao e
      // estilo, e bug de estado que o React nao consegue recuperar.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // --- Acessibilidade: o que o DS-PAINEL.md §10 exige ---------------
      // Subconjunto nominal, nao o `recommended` inteiro: cada regra aqui
      // corresponde a uma linha do §10 (WCAG 2.2 AA) -- nao do §11, que e a
      // lista de regras de lint do design system e vive em design-system.js. Ligar o preset todo
      // traria regra sobre `<marquee>` e sobre ARIA que nao usamos, e o
      // ruido faria o time desligar o plugin em vez de ler o aviso.
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
    },
  },
];

export default config;
