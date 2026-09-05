import type { Metadata } from 'next';

import { FormularioDeAceite } from './formulario-de-aceite';
import estilos from '../../login/login.module.css';
import { lerVersaoDoPainel } from '../../../../src/version';

/** O mesmo do login, e declarado pela mesma razão: suposição visível. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

export const metadata: Metadata = {
  title: 'Aceitar convite — ArenaHub',
  /*
   * O TOKEN VAI NA URL, e a URL vaza para robô, histórico e barra de
   * endereço. Não indexar não protege o convite (ele é de uso único e vale
   * 24 horas), mas evita que um link válido apareça num resultado de busca
   * enquanto ainda funciona.
   */
  robots: { index: false, follow: false },
};

/**
 * Aceite de convite — issue #274.
 *
 * PÚBLICA de propósito: quem aceita convite ainda não tem conta, e a rota da
 * API que ela chama é `@Public()` pela mesma razão. Por isso vive em
 * `(auth)`, ao lado do login, e não em `(protected)` -- o layout protegido
 * redirecionaria para o login quem viesse aceitar.
 *
 * O TOKEN NÃO É VALIDADO AQUI. Não há rota para isso na API, e criar uma
 * daria a quem sonda um oráculo de "este convite existe?" sem custo. A
 * pessoa descobre que o convite morreu ao enviar a senha, com a mesma frase
 * que a API usa para expirado, revogado, já aceito e inexistente.
 */
export default async function PaginaDeAceite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className={estilos['tela']}>
      {/*
        A mesma coluna de identidade do login, e não uma tela nua: esta é a
        primeira coisa que a pessoa convidada vê do produto, e uma caixa de
        senha solta num fundo branco parece phishing.

        `aria-hidden`: é conteúdo de marca, e quem usa leitor de tela quer
        chegar ao formulário.
      */}
      <aside className={estilos['identidade']} aria-hidden="true">
        <p className={estilos['wordmark']}>
          arenahub<span>.</span>
        </p>

        <div className={estilos['discurso']}>
          <p className={estilos['frase']}>Da matrícula ao resultado físico do aluno.</p>
          <p className={estilos['apoio']}>
            Pagamento, reconhecimento facial, acesso, frequência e evolução em uma única
            plataforma.
          </p>
        </div>

        {/*
          O RODAPÉ NÃO É ENFEITE COPIADO DO LOGIN. A coluna usa
          `justify-content: space-between`, e sem um terceiro bloco o discurso
          desce até o rodapé em vez de ficar no meio — visto na tela, não em
          teste: `getByText` acha a frase nas duas posições.
        */}
        <p className={estilos['rodape']}>
          admin-web v{lerVersaoDoPainel()} · {FUSO_PROVISORIO}
        </p>
      </aside>

      <div className={estilos['trabalho']}>
        <div className={estilos['painel']}>
          <div className={estilos['cabecalho']}>
            <h1 className={estilos['titulo']}>Criar sua senha</h1>
            <p className={estilos['subtitulo']}>
              Você foi convidado para o painel da academia. Defina a senha para entrar.
            </p>
          </div>

          <FormularioDeAceite token={token} />
        </div>
      </div>
    </main>
  );
}
