import { FormularioDeLogin } from './formulario-de-login';
import { HeroDaMarca } from './hero-da-marca';
import estilos from './login.module.css';
import type { MarcaDaAcademia } from '../../../src/marca/ler-marca';

interface Props {
  readonly marca: MarcaDaAcademia;
}

/**
 * A tela de entrada, com a marca que a rota decidiu — F62 (ADR-052 §10).
 *
 * DUAS ROTAS, UMA TELA: `/login` monta com a marca ArenaHub, `/{slug}/login`
 * com a da academia. Só isso muda entre elas, e por isso a tela é uma só —
 * duas cópias divergiriam na primeira correção feita em uma delas.
 *
 * O FORMULÁRIO NÃO RECEBE O SLUG, e a omissão é a decisão: `User` é global no
 * schema (e-mail único, sem `tenant_id`), então o slug identifica a MARCA da
 * tela, nunca o que a autenticação faz. Passá-lo adiante criaria a
 * expectativa de que `/outra-academia/login` recusa quem é de outro tenant —
 * garantia que o modelo de identidade não dá.
 */
export function PainelDeEntrada({ marca }: Props) {
  const daAcademia = marca.slug !== '';

  return (
    <main className={estilos['tela']}>
      <HeroDaMarca marca={marca} />

      <div className={estilos['trabalho']}>
        <div className={estilos['painel']}>
          <div className={estilos['cabecalho']}>
            <h1 className={estilos['titulo']}>Entrar no painel</h1>
            <p className={estilos['subtitulo']}>
              {daAcademia
                ? `Acesso do time da ${marca.displayName}. Alunos usam o aplicativo.`
                : 'Acesso do time da academia. Alunos usam o aplicativo.'}
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
            - **"MFA obrigatório para administradores"** afirmaria uma regra
              que vale só para o Super Admin (F61), não para o time da
              academia. Escrever na tela de entrada uma política que o sistema
              não aplica a quem a lê é ensinar o time a confiar em garantia que
              não tem.

            Quando qualquer um dos dois existir de verdade, o lugar é aqui.
          */}
        </div>
      </div>
    </main>
  );
}
