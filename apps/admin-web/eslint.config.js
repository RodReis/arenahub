import base from '@arenahub/config/eslint';
import designSystem from '@arenahub/config/eslint/design-system';

export default [
  ...base,
  ...designSystem,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
