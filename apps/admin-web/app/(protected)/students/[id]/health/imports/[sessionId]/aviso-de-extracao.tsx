import estilos from './sessao.module.css';

/**
 * Faixa de aviso persistente sobre a origem dos valores -- mock do PI.
 *
 * Não é `AIDisclaimer` (esse é sobre a ANÁLISE de IA, painel à direita):
 * este aviso é sobre a EXTRAÇÃO por leitura de imagem, e por isso mora
 * acima da tabela de revisão, não do painel de análise.
 */
export function AvisoDeExtracao() {
  return (
    <p className={estilos['avisoDeOcr']} role="note" data-testid="aviso-de-extracao">
      Os valores abaixo vieram de leitura de imagem. Nada é gravado antes da sua confirmação campo
      a campo — confira cada valor contra o arquivo original. Campos sem valor no laudo ficam como
      &ldquo;—&rdquo;, nunca como zero.
    </p>
  );
}
