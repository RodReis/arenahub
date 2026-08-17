import type { Metadata } from 'next';

import { Icon } from '@arenahub/ui';

import { FormularioDeLogin } from './formulario-de-login';
import estilos from './login.module.css';

export const metadata: Metadata = {
  title: 'Entrar — ArenaHub',
};

export default function PaginaDeLogin() {
  return (
    <main className={estilos['tela']}>
      <div className={estilos['cartao']}>
        <div className={estilos['marca']}>
          {/* Decorativo: o `<h1>` ao lado ja nomeia o produto. */}
          <span className={estilos['simbolo']}>
            <Icon name="dumbbell" />
          </span>
          <h1 className={estilos['titulo']}>ArenaHub</h1>
          <p className={estilos['subtitulo']}>Gestão multi-tenant segura</p>
        </div>

        <FormularioDeLogin />
      </div>
    </main>
  );
}
