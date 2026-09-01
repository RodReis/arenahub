import type { IndicadoresDeEngajamento } from '../../../actions/engagement';
import estilos from './configuracao.module.css';

/**
 * Indicadores do engajamento -- F35, `M5-FR-018`.
 *
 * Server Component puro: números que a página já buscou, sem interação.
 *
 * DUAS LEITURAS, e a separação é o desenho: em cima, o que está acontecendo;
 * embaixo, o que ainda depende de alguém. Misturar as duas faria a secretaria
 * procurar a fila no meio de estatística — e a fila é o que ela abre a tela
 * para ver.
 *
 * `<h2>`, e não `<h3>`: o único heading acima destes é o `<h1>` da página
 * (`engagement/page.tsx`), e não há `<h2>` nenhum na aba — `PainelDeConfiguracao`
 * usa `<legend>`. Com `<h3>` o nível 2 ficava vago, e quem navega por heading
 * em leitor de tela ouve um degrau que não existe (WCAG 1.3.1).
 */
export function Indicadores({ dados }: { readonly dados: IndicadoresDeEngajamento }) {
  // Participação sobre a base ATIVA, que é o único denominador honesto: aluno
  // inativo nunca aparece em exposição nenhuma (INV-155).
  const taxa =
    dados.alunosAtivos > 0
      ? Math.round((dados.participandoDoRanking / dados.alunosAtivos) * 100)
      : null;

  return (
    <div data-testid="indicadores-de-engajamento">
      <section aria-labelledby="titulo-participacao" className={estilos['grupo']}>
        <h2 id="titulo-participacao">Participação</h2>

        <dl className={estilos['numeros']}>
          <div>
            <dt>Alunos ativos</dt>
            <dd data-testid="indicador-alunosAtivos">{dados.alunosAtivos}</dd>
          </div>
          <div>
            <dt>No placar</dt>
            <dd data-testid="indicador-participandoDoRanking">
              {dados.participandoDoRanking}
              {taxa !== null && <span className={estilos['efeito']}> ({taxa}%)</span>}
            </dd>
          </div>
          <div>
            <dt>Pediram para sair</dt>
            <dd data-testid="indicador-optOut">{dados.optOut}</dd>
          </div>
        </dl>

        <p className={estilos['aviso']}>
          Quem não pediu para sair participa. Sair do placar não reduz pontos nem acesso.
        </p>
      </section>

      <section aria-labelledby="titulo-pendencias" className={estilos['grupo']}>
        <h2 id="titulo-pendencias">Esperando alguém</h2>

        <dl className={estilos['numeros']}>
          <div>
            <dt>Apelidos na fila</dt>
            <dd data-testid="indicador-apelidosPendentes">{dados.apelidosPendentes}</dd>
          </div>
          <div>
            <dt>Contestações abertas</dt>
            <dd data-testid="indicador-contestacoesAbertas">{dados.contestacoesAbertas}</dd>
          </div>
          <div>
            <dt>Apelidos ocultados</dt>
            <dd data-testid="indicador-apelidosOcultos">{dados.apelidosOcultos}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
