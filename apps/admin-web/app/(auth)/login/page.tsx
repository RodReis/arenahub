import type { Metadata } from 'next';

import { FormularioDeLogin } from './formulario-de-login';
import estilos from './login.module.css';
import { lerVersaoDoPainel } from '../../../src/version';

export const metadata: Metadata = {
  title: 'Entrar — ArenaHub',
};

/**
 * Fuso que a tela assume enquanto o seletor de unidade não existe.
 *
 * Declarado no rodapé de propósito: toda data do painel é lida neste fuso, e
 * uma suposição visível é corrigível — uma suposição silenciosa vira dado
 * errado apresentado com a confiança de dado certo.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

export default function PaginaDeLogin() {
  return (
    <main className={estilos['tela']}>
      {/*
        Coluna de identidade — F46, issue #99.

        O login é a única tela sem o shell, e a única em que cabe dizer o que o
        produto faz. Quem entra aqui é o time da academia, uma vez por turno; a
        recepção passa o resto do dia nas telas densas do outro lado.

        `aria-hidden`: é conteúdo de marca, e quem usa leitor de tela quer
        chegar ao formulário, não ouvir o slogan antes de cada login. O `<h1>`
        real está no painel de trabalho.
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

        <p className={estilos['rodape']}>
          admin-web v{lerVersaoDoPainel()} · {FUSO_PROVISORIO}
        </p>
      </aside>

      <div className={estilos['trabalho']}>
        <div className={estilos['painel']}>
          <div className={estilos['cabecalho']}>
            <h1 className={estilos['titulo']}>Entrar no painel</h1>
            <p className={estilos['subtitulo']}>
              Acesso do time da academia. Alunos usam o aplicativo.
            </p>
          </div>

          <FormularioDeLogin />

          {/*
            A referência visual trazia "Esqueci minha senha" e "MFA obrigatório
            para administradores" abaixo do botão. Nenhum dos dois entrou, e a
            omissão é deliberada:

            - **recuperação de senha não existe** — nem rota no painel, nem
              endpoint na API. Link para lugar nenhum é pior que ausência: quem
              esqueceu a senha clicaria, chegaria a um 404 e ligaria para o
              suporte de qualquer jeito, agora achando que o produto quebrou;
            - **"MFA obrigatório para administradores"** afirmaria uma regra que
              não encontrei no código. O MFA existe (`mfa.service.ts`), mas
              nada o torna obrigatório por papel. Escrever na tela de entrada
              uma política que o sistema não aplica é ensinar o time a confiar
              em garantia que não tem.

            Quando qualquer um dos dois existir de verdade, o lugar é aqui.
          */}
        </div>
      </div>
    </main>
  );
}
