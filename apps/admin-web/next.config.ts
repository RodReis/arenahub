import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // `API_INTERNAL_URL` fica deliberadamente fora daqui: o que entra em `env`
  // vai para o bundle do cliente. A URL interna da API so e lida no servidor,
  // pelo cliente de API das Server Actions.
  poweredByHeader: false,
};

export default config;
