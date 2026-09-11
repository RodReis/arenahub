import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';

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

  /*
   * `margin: 0` porque o respiro branco em volta do código já vem do padding
   * do contêiner — a margem do próprio SVG só encolheria os módulos dentro da
   * mesma caixa, piorando a leitura.
   */
  const qrCodeSvg = await QRCode.toString(inscricao.uri, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
  });

  return (
    <MolduraDeSegundoFator
      titulo="Configure o segundo fator"
      subtitulo="Esta conta exige um aplicativo autenticador. Cadastre a chave abaixo e confirme com o primeiro código."
    >
      {/*
        O QR Code é o caminho principal; a chave em texto fica fechada atrás do
        `<details>`.

        O QR carrega exatamente o mesmo segredo que o texto — esconder o texto
        não protege contra quem fotografa a tela, só contra quem lê por cima do
        ombro. O texto continua alcançável porque sem ele quem abre o painel no
        próprio desktop (sem outra câmera para escanear) não teria como cadastrar.

        O SVG é gerado no servidor: nada de biblioteca de QR no bundle do
        cliente, e a marcação já chega pronta no HTML.
      */}
      <div className={estilos['segredo']}>
        <p className={estilos['segredoRotulo']}>Escaneie no seu aplicativo autenticador</p>
        <div
          className={estilos['qrCode']}
          /*
            SVG vem do `qrcode`, gerado a partir da URI `otpauth://` que a
            própria API montou — não há entrada de usuário no caminho.
          */
          dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
        />
        <p className={estilos['segredoAjuda']}>
          {/*
            `otpauth://` é o esquema que Google Authenticator, 1Password, Authy
            e afins registram. No celular, abre direto no aplicativo, já com o
            segredo preenchido.
          */}
          No celular, <a href={inscricao.uri}>abra direto no aplicativo</a>.
        </p>

        <details className={estilos['segredoAlternativa']}>
          <summary className={estilos['segredoAlternativaResumo']}>Não consigo escanear</summary>
          <p className={estilos['segredoRotulo']}>Chave de configuração</p>
          <p className={estilos['segredoValor']}>{inscricao.base32}</p>
        </details>
      </div>

      <FormularioDeCodigo acao={confirmarInscricaoDeSegundoFator} rotulo="Ativar e entrar" />
    </MolduraDeSegundoFator>
  );
}
