import base from '@arenahub/config/eslint';
import designSystem from '@arenahub/config/eslint/design-system';
import react from '@arenahub/config/eslint/react';

export default [
  ...base,
  ...designSystem,
  ...react,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
