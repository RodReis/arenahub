import type { MarcaDaAcademia } from '../../../src/marca/ler-marca';
import { lerVersaoDoPainel } from '../../../src/version';
import estilos from './login.module.css';

/**
 * Fuso que a tela assume enquanto o seletor de unidade não existe.
 *
 * Declarado no rodapé de propósito: toda data do painel é lida neste fuso, e
 * uma suposição visível é corrigível — uma suposição silenciosa vira dado
 * errado apresentado com a confiança de dado certo.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

interface Props {
  readonly marca: MarcaDaAcademia;
}

/**
 * Coluna de identidade da tela de login — F46 (issue #99), com a marca do
 * tenant desde a F62 (ADR-052 §9).
 *
 * O login é a única tela sem o shell, e a única em que cabe dizer o que o
 * produto faz. Quem entra aqui é o time da academia, uma vez por turno; a
 * recepção passa o resto do dia nas telas densas do outro lado.
 *
 * ---------------------------------------------------------------------------
 * A MARCA DA ACADEMIA SUBSTITUI O DISCURSO DO PRODUTO, NÃO SE SOMA A ELE.
 * ---------------------------------------------------------------------------
 *
 * Sem slug, a coluna é o pitch do ArenaHub: "Da matrícula ao resultado físico
 * do aluno". Com slug, ela é a academia — logo, nome, missão e diferenciais.
 * Empilhar os dois produziria uma tela que fala de dois produtos ao mesmo
 * tempo, e a academia que configurou a própria marca veria a nossa por cima.
 *
 * Quando a academia existe mas não escreveu missão nem diferenciais, o
 * discurso do ArenaHub VOLTA: uma coluna com um nome e nada mais é pior que a
 * coluna que já existia, e a F62 não pode piorar a tela de quem não usou o
 * campo novo.
 *
 * `aria-hidden`: é conteúdo de marca, e quem usa leitor de tela quer chegar ao
 * formulário, não ouvir o slogan antes de cada login. O `<h1>` real está no
 * painel de trabalho.
 */
export function HeroDaMarca({ marca }: Props) {
  const daAcademia = marca.slug !== '';
  const temTexto = marca.missionText !== null || marca.highlightsText !== null;

  return (
    <aside className={estilos['identidade']} aria-hidden="true">
      {daAcademia && marca.temLogo ? (
        /*
         * `<img>` cru, e não `next/image`: o arquivo pode ser SVG, e o
         * otimizador do Next não redimensiona vetor -- passaria o arquivo
         * adiante depois de uma ida a mais ao servidor. A altura fixa no CSS
         * é o que evita o salto de layout que o `next/image` costuma cobrir.
         */
        <img
          className={estilos['logo']}
          src={`/marca/${encodeURIComponent(marca.slug)}/logo`}
          alt=""
          data-testid="logo-do-tenant"
        />
      ) : (
        <p className={estilos['wordmark']}>
          arenahub<span>.</span>
        </p>
      )}

      <div className={estilos['discurso']}>
        {daAcademia ? (
          <p className={estilos['frase']} data-testid="nome-do-tenant">
            {marca.displayName}
          </p>
        ) : (
          <p className={estilos['frase']}>Da matrícula ao resultado físico do aluno.</p>
        )}

        {daAcademia && temTexto ? (
          <>
            {marca.missionText === null ? null : (
              <p className={estilos['apoio']} data-testid="missao-do-tenant">
                {marca.missionText}
              </p>
            )}
            {marca.highlightsText === null ? null : (
              <p className={estilos['diferenciais']} data-testid="diferenciais-do-tenant">
                {marca.highlightsText}
              </p>
            )}
          </>
        ) : (
          <p className={estilos['apoio']}>
            Pagamento, reconhecimento facial, acesso, frequência e evolução em uma única
            plataforma.
          </p>
        )}
      </div>

      {/*
        Versão e fuso — diagnóstico, não enfeite.

        É o que o suporte pede primeiro quando alguém liga: qual versão está no
        ar e em que fuso a tela lê as datas. Fica aqui porque esta é a única
        página que todo mundo vê antes de entrar.
      */}
      <p className={estilos['rodape']}>
        admin-web v{lerVersaoDoPainel()} · {FUSO_PROVISORIO}
      </p>
    </aside>
  );
}
