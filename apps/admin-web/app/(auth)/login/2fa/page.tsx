import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { verificarSegundoFator } from '../../../actions/auth';
import { FormularioDeCodigo } from '../formulario-de-codigo';
import { MolduraDeSegundoFator } from '../moldura-de-segundo-fator';
import { lerPreAuth } from '../../../../lib/api/pre-auth';

export const metadata: Metadata = {
  title: 'Segundo fator — ArenaHub',
};

/**
 * Segundo passo do login de quem JÁ tem o autenticador cadastrado.
 *
 * Chegar aqui sem desafio pendente não é erro a explicar, é rota fora de
 * ordem: manda de volta ao login em vez de mostrar um campo de código que não
 * teria como funcionar.
 */
export default async function PaginaDeSegundoFator() {
  const desafio = await lerPreAuth();

  if (!desafio) redirect('/login');
  if (desafio.desafio === 'MFA_SETUP') redirect('/login/configurar-2fa');

  return (
    <MolduraDeSegundoFator
      titulo="Confirme que é você"
      subtitulo="Digite o código de seis dígitos do seu aplicativo autenticador."
    >
      <FormularioDeCodigo acao={verificarSegundoFator} rotulo="Entrar" />
    </MolduraDeSegundoFator>
  );
}
