import type { EstatisticasPublicas } from '../../../lib/api/estatisticas-publicas';
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
  /** `null` quando a coluna e da academia (tem tenant) -- so o discurso do ArenaHub mostra. */
  readonly estatisticas: EstatisticasPublicas | null;
}

/**
 * Os quatro pilares do produto -- copy fixa, a mesma do protótipo aprovado
 * (F71). Nao e dado, e marketing: nao muda por tenant nem por requisicao.
 */
const RECURSOS = [
  {
    titulo: 'Cadastro e biometria',
    texto: 'Ficha completa, facial e carteirinha digital',
    tracado: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6 M15.5 11.5l2 2 4-4.5',
  },
  {
    titulo: 'Receita e cobrança',
    texto: 'Planos, PIX, inadimplência e bloqueio',
    tracado: 'M2.5 6.5h19v11h-19z M2.5 10.5h19 M6 14.5h4',
  },
  {
    titulo: 'Bioimpedância',
    texto: 'Laudo mensal, evolução e análise',
    tracado: 'M3 17l5-6 4 4 5-8 4 5 M3 21h18',
  },
  {
    titulo: 'Catracas e totem',
    texto: 'Acesso ao vivo e tela da recepção',
    tracado: 'M6.5 2.5h11v19h-11z M10 18.5h4 M9.5 6h5',
  },
] as const;

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
export function HeroDaMarca({ marca, estatisticas }: Props) {
  const daAcademia = marca.slug !== '';
  const temTexto = marca.missionText !== null || marca.highlightsText !== null;

  if (daAcademia) {
    return (
      <aside className={estilos['identidade']} aria-hidden="true">
        {marca.temLogo ? (
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
          <p className={estilos['frase']} data-testid="nome-do-tenant">
            {marca.displayName}
          </p>

          {temTexto ? (
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

          É o que o suporte pede primeiro quando alguém liga: qual versão está
          no ar e em que fuso a tela lê as datas. Fica aqui porque esta é a
          única página que todo mundo vê antes de entrar.
        */}
        <p className={estilos['rodape']}>
          admin-web v{lerVersaoDoPainel()} · {FUSO_PROVISORIO}
        </p>
      </aside>
    );
  }

  /*
   * SEM TENANT -- o pitch do ArenaHub, com foto, cards de recursos e a
   * contagem real do rodapé (F71). `estatisticas` chega pronta de fora
   * (`PainelDeEntrada` busca no servidor): este componente so RENDERIZA, e o
   * teste que o exercita sem `async` continua funcionando.
   */
  return (
    <aside className={`${estilos['identidade']} ${estilos['identidadeComFoto']}`} aria-hidden="true">
      <img className={estilos['heroFoto']} src="/login/hero.jpg" alt="" />
      <div className={estilos['heroGradienteVertical']} />
      <div className={estilos['heroGradienteHorizontal']} />

      <div className={estilos['heroConteudo']}>
        <div className={estilos['heroTopo']}>
          <div className={estilos['heroBadge']}>
            <div className={estilos['heroBadgeMiolo']}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 9.5v5 M5 7.5v9 M19 7.5v9 M21.5 9.5v5 M5 12h3.2 M15.8 12H19 M8.2 12l1.4-2.6 1.9 5.2 1.7-4 1 1.4h1.6" />
              </svg>
            </div>
          </div>
          <div>
            <p className={estilos['heroWordmark']}>
              arenahub<span>.</span>
            </p>
            <p className={estilos['heroSelo']}>PAINEL DA ACADEMIA</p>
          </div>
        </div>

        <div className={estilos['heroPitch']}>
          <p className={estilos['heroKicker']}>CADASTRO · ACESSO · RECEITA · EVOLUÇÃO</p>
          <p className={estilos['heroHeadline']}>Da matrícula ao resultado físico do aluno.</p>
          <p className={estilos['heroApoio']}>
            Pagamento, reconhecimento facial, acesso, frequência e evolução em uma única
            plataforma.
          </p>

          <div className={estilos['heroGrade']}>
            {RECURSOS.map((recurso) => (
              <div key={recurso.titulo} className={estilos['heroCard']}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d={recurso.tracado} />
                </svg>
                <div>
                  <p className={estilos['heroCardTitulo']}>{recurso.titulo}</p>
                  <p className={estilos['heroCardTexto']}>{recurso.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/*
          Versão, fuso e contagem real -- diagnóstico e prova social, não
          enfeite. A contagem some quando a API de estatísticas falha
          (`lerEstatisticasPublicas` devolve `null`): a tela de login não pode
          quebrar por causa de um número no rodapé.
        */}
        <p className={estilos['heroRodape']}>
          <span>admin-web v{lerVersaoDoPainel()}</span>
          <span>·</span>
          <span>{FUSO_PROVISORIO}</span>
          {estatisticas === null ? null : (
            <>
              <span>·</span>
              {/* Numero cru, sem separador de milhar -- `toLocaleString` e `Intl.DateTimeFormat` soltos sao banidos fora de TenantDateTime (regra 5 do DS §11), e este numero nao e data nem justifica Intl.NumberFormat so para um rodape. */}
              <span data-testid="estatisticas-publicas">
                {estatisticas.totalAlunosAtivos} alunos · {estatisticas.totalUnidadesAtivas} unidades
              </span>
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
