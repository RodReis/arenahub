'use client';

import { NavLink } from '@arenahub/ui';
import { usePathname } from 'next/navigation';

/**
 * Navegação principal — F46, issue #99.
 *
 * `'use client'` num shell que é todo servidor precisa de justificativa, e a
 * daqui vem da documentação do Next: **ler o pathname no servidor não é
 * suportado**, e layout não re-renderiza na navegação. Passar a rota de cima
 * daria um valor congelado no primeiro carregamento — a sidebar marcaria a
 * tela de entrada para sempre, que é pior que não marcar nada.
 *
 * O custo está contido: só a lista de links vira cliente. Topbar, seletor de
 * unidade, cabeçalho e conteúdo seguem no servidor.
 *
 * Antes disto o `NavLink` recebia `current` em lugar nenhum. O componente
 * aceitava a prop, o CSS de item ativo existia, e o único lugar do repositório
 * que passava era o teste unitário — verde e morto. A recepcionista navega
 * entre quatro telas por atendimento e via sete links idênticos toda vez.
 */
interface Item {
  readonly href: string;
  readonly label: string;
}

export function Navegacao({ itens }: { readonly itens: readonly Item[] }) {
  const rota = usePathname();
  const atual = itemAtual(rota, itens);

  return (
    <>
      {itens.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          current={item.href === atual}
        />
      ))}
    </>
  );
}

/**
 * Qual item marcar como atual — **um só**.
 *
 * Casa por prefixo, e não por igualdade: a ficha do aluno é `/students/<id>` e
 * precisa acender "Alunos". Sidebar que apaga ao abrir um registro tira a
 * única âncora de lugar que a tela tem.
 *
 * Mas prefixo sozinho acenderia DOIS itens em `/operations/devices`, e
 * `aria-current="page"` duplicado afirma ao leitor de tela que a pessoa está
 * em duas páginas ao mesmo tempo. Por isso o mais específico vence: entre
 * `/operations` e `/operations/devices`, ganha quem casa com mais caracteres.
 *
 * O `/` no fim do prefixo impede que `/access-events` acenda `/access` por
 * acaso de string — são telas diferentes que compartilham o começo do caminho.
 */
function itemAtual(rota: string, itens: readonly Item[]): string | null {
  const candidatos = itens.filter(
    (item) => rota === item.href || rota.startsWith(`${item.href}/`),
  );

  if (candidatos.length === 0) return null;

  return candidatos.reduce((maisEspecifico, item) =>
    item.href.length > maisEspecifico.href.length ? item : maisEspecifico,
  ).href;
}
