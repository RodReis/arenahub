import estilos from './AppShell.module.css';

interface Props {
  readonly href: string;
  readonly label: string;
  /**
   * A rota atual. Quem chama compara -- o componente nao le o router, para
   * seguir Server Component.
   */
  readonly current?: boolean;
}

/**
 * Item da navegacao principal.
 *
 * `aria-current="page"` existe porque sem ele quem usa leitor de tela ouve
 * sete links identicos em toda tela e nunca sabe onde esta. O estilo do item
 * ativo pendura no mesmo atributo, entao os dois canais -- visual e sonoro --
 * nao podem divergir.
 */
export function NavLink({ href, label, current = false }: Props) {
  return (
    <a
      className={estilos['navlink']}
      href={href}
      {...(current ? { 'aria-current': 'page' as const } : {})}
    >
      {label}
    </a>
  );
}
