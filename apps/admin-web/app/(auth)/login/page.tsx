import type { Metadata } from 'next';

import { FormularioDeLogin } from './formulario-de-login';

export const metadata: Metadata = {
  title: 'Entrar — ArenaHub',
};

export default function PaginaDeLogin() {
  return (
    <main>
      <h1>Entrar no ArenaHub</h1>
      <FormularioDeLogin />
    </main>
  );
}
