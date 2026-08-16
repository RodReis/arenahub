/**
 * Ausencia de dado NAO e zero -- DS-PAINEL.md §10 item 5.
 *
 * Existe como componente para o `aria-label` nunca divergir: "—" sozinho e
 * lido como "traco" ou pulado, dependendo do leitor de tela.
 */
export function Ausente() {
  return <span aria-label="não informado">—</span>;
}
