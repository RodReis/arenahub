import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  confirmarInscricaoDeSegundoFator,
  iniciarInscricaoDeSegundoFator,
} from '../../../actions/auth';
import { FormularioDeCodigo } from '../formulario-de-codigo';
import { MolduraDeSegundoFator } from '../moldura-de-segundo-fator';
import { lerPreAuth } from '../../../../lib/api/pre-auth';
import estilos from '../login.module.css';

export const metadata: Metadata = {
  title: 'Configurar segundo fator — ArenaHub',
};

/**
 * Primeira configuração do segundo fator, para quem ainda não tem.
 *
 * O segredo é buscado AO ABRIR a página, e não num passo anterior: ele já
 * nasce gravado como `PENDING` na API, e mostrar a tela antes de tê-lo daria
 * um campo de código sem nada a cadastrar.
 */
export default async function PaginaDeConfiguracaoDeSegundoFator() {
  const desafio = await lerPreAuth();

  if (!desafio) redirect('/login');
  if (desafio.desafio === 'MFA_VERIFY') redirect('/login/2fa');

  const inscricao = await iniciarInscricaoDeSegundoFator();

  /*
   * Sem segredo não há o que configurar. Voltar ao login é melhor que
   * mostrar a tela vazia: o pre-auth pode ter vencido entre o login e aqui, e
   * nesse caso o caminho real é entrar de novo.
   */
  if (!inscricao) redirect('/login');

  return (
    <MolduraDeSegundoFator
      titulo="Configure o segundo fator"
      subtitulo="Esta conta exige um aplicativo autenticador. Cadastre a chave abaixo e confirme com o primeiro código."
    >
      {/*
        A CHAVE EM TEXTO, e não um QR Code.

        Todo autenticador aceita entrada manual, e gerar o QR exigiria uma
        biblioteca nova no bundle da tela de login para desenhar o mesmo
        segredo que já está aqui. Quem abre o painel no celular tem o link
        abaixo, que o próprio sistema operacional entrega ao aplicativo.
      */}
      <div className={estilos['segredo']}>
        <p className={estilos['segredoRotulo']}>Chave de configuração</p>
        <p className={estilos['segredoValor']}>{inscricao.base32}</p>
        <p className={estilos['segredoAjuda']}>
          Cadastre no seu aplicativo autenticador, ou{' '}
          {/*
            `otpauth://` é o esquema que Google Authenticator, 1Password, Authy
            e afins registram. No celular, abre direto no aplicativo, já com o
            segredo preenchido.
          */}
          <a href={inscricao.uri}>abra direto no aplicativo</a>.
        </p>
      </div>

      <FormularioDeCodigo acao={confirmarInscricaoDeSegundoFator} rotulo="Ativar e entrar" />
    </MolduraDeSegundoFator>
  );
}
