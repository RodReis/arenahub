import type { Metadata } from 'next';

import { PainelDeEntrada } from '../../login/painel-de-entrada';
import { lerMarca } from '../../../../src/marca/ler-marca';

interface Props {
  readonly params: Promise<{ slug: string }>;
}

/**
 * Título e ÍCONE DA ABA saem da marca da academia — o terceiro aceite da
 * issue #285.
 *
 * O ícone entra por `icons.icon` em vez de um `favicon.ico` estático porque
 * ele muda por rota: um arquivo em `app/` seria o mesmo para o painel inteiro.
 *
 * `type` declarado junto do `url`: sem ele o navegador adivinha pela extensão
 * da URL, e esta não tem extensão nenhuma.
 *
 * Academia sem ícone NÃO declara `icons`, e aí vale o do layout raiz. Declarar
 * a rota mesmo assim faria a aba pedir um arquivo que responde 404 a cada
 * visita, e algumas versões de navegador mostram o ícone quebrado em vez de
 * cair no padrão.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const marca = await lerMarca(slug);

  const titulo = marca.slug === '' ? 'Entrar — ArenaHub' : `Entrar — ${marca.displayName}`;

  if (!marca.temIcone) return { title: titulo };

  return {
    title: titulo,
    icons: { icon: [{ url: `/marca/${encodeURIComponent(marca.slug)}/icon`, type: 'image/svg+xml' }] },
  };
}

/**
 * Login da academia identificada pelo slug — F62 (ADR-052 §10).
 *
 * SLUG DESCONHECIDO NÃO É 404: `lerMarca` devolve a marca ArenaHub, e a tela
 * de entrada aparece normalmente. Um `notFound()` aqui transformaria a tela de
 * login num oráculo — quem tentasse nomes descobriria de graça quais academias
 * são clientes do ArenaHub, e um 404 num slug real diria que ele foi
 * desligado. É literalmente o aceite da issue #285.
 */
export default async function PaginaDeLoginDoTenant({ params }: Props) {
  const { slug } = await params;

  return <PainelDeEntrada marca={await lerMarca(slug)} />;
}
