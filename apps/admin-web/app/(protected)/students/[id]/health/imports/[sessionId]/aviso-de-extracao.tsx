import estilos from './sessao.module.css';

/**
 * Faixa de aviso persistente sobre a origem dos valores.
 *
 * Reescrita pelo ADR-039. O texto anterior dizia "nada é gravado antes da
 * sua confirmação campo a campo" — e isso deixou de ser verdade: a extração
 * publica sozinha. Um aviso que descreve um fluxo que não existe mais é pior
 * que nenhum aviso, porque ensina o avaliador a esperar uma barreira que não
 * vai aparecer.
 *
 * O que o aviso precisa dizer agora é o que MUDOU para quem lê: os valores
 * já estão publicados, vieram de leitura automática, e conferir contra o
 * original virou responsabilidade de quem anexou — não uma etapa que o
 * sistema exige.
 *
 * Não é `AIDisclaimer` (esse é sobre a ANÁLISE de IA, painel à direita):
 * este aviso é sobre a EXTRAÇÃO por leitura de imagem, e por isso mora acima
 * dos valores, não do painel de análise.
 */
export function AvisoDeExtracao() {
  return (
    <p className={estilos['avisoDeOcr']} role="note" data-testid="aviso-de-extracao">
      Estes valores foram extraídos automaticamente dos laudos e <strong>já estão publicados</strong>{' '}
      para o aluno. Confira contra os arquivos originais acima — se algum número estiver errado,
      corrija pela ficha do aluno. Campos sem valor no laudo ficam como &ldquo;—&rdquo;, nunca como
      zero.
    </p>
  );
}
