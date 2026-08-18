/**
 * PostCSS -- exigido pelo Tailwind v4, que o shadcn/ui traz junto.
 *
 * Decisao do PI em 18/08/2026, contrariando o `PRODUCT.md` (que lista shadcn
 * como anti-referencia) e o `DESIGN-UI.md` §3.4. Ver o ADR da mudanca.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
