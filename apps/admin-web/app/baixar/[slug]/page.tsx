import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { chamarApi } from '../../../lib/api/server-client';
import { origemPublica } from '../../../src/http/origem-publica';
import { lerMarca } from '../../../src/marca/ler-marca';
import estilos from './baixar.module.css';

export const dynamic = 'force-dynamic';

interface Destino {
  androidUrl: string | null;
  tenantSlug: string;
}

async function resolver(slug: string): Promise<Destino | null> {
  const resposta = await chamarApi<Destino>(`/api/v1/public/app-links/${encodeURIComponent(slug)}`);

  return resposta.ok && resposta.dados ? resposta.dados : null;
}

const DESCRICAO = 'Treino, plano e avaliação no seu celular. Toque para baixar e entre com o seu CPF.';

/**
 * A PREVIA DO WHATSAPP sai daqui (#538): titulo, descricao e a imagem
 * `opengraph-image.tsx` desta rota. `metadataBase` vem do proprio pedido --
 * sem ele a URL da imagem sairia relativa, e o WhatsApp a ignora.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const destino = await resolver(slug);
  const base = { metadataBase: new URL(await origemPublica()), robots: { index: false, follow: false } };

  if (!destino) return { ...base, title: 'Baixar o app' };

  const marca = await lerMarca(destino.tenantSlug);
  const titulo = `Baixe o app da ${marca.displayName}`;

  return {
    ...base,
    title: titulo,
    description: DESCRICAO,
    openGraph: {
      title: titulo,
      description: DESCRICAO,
      siteName: marca.displayName,
      type: 'website',
      locale: 'pt_BR',
    },
    ...(marca.temIcone
      ? { icons: { icon: `/marca/${encodeURIComponent(destino.tenantSlug)}/icon` } }
      : {}),
  };
}

const PASSOS = [
  'Toque em baixar e abra o arquivo.',
  'No Android, se o celular pedir, permita instalar apps desta origem.',
  'Abra o app e toque em “Primeiro acesso” para entrar com o seu CPF.',
] as const;

/**
 * Link curto do app (#538) -- `<painel>/baixar/<final>`. Quem abre e o ALUNO,
 * sem sessao, pelo QR do balcao ou pelo WhatsApp.
 *
 * PAGINA DA ACADEMIA, e nao redirecionamento: e ela que da nome e icone a
 * previa do WhatsApp (o redirecionamento direto mostrava "expo.dev") e que
 * escolhe o botao certo para cada celular. Hoje o Android baixa o APK; o
 * iPhone ja tem o lugar dele, "em breve" -- quando o app chegar a loja, o
 * link, o QR e as mensagens ja enviadas continuam os mesmos.
 */
export default async function BaixarOApp({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destino = await resolver(slug);

  if (!destino) {
    return (
      <main className={estilos['pagina']}>
        <section className={estilos['cartao']} data-testid="link-nao-encontrado">
          <h1 className={estilos['titulo']}>Link não encontrado</h1>
          <p className={estilos['texto']}>
            Confira o endereço ou peça o link atualizado na recepção da academia.
          </p>
        </section>
      </main>
    );
  }

  const marca = await lerMarca(destino.tenantSlug);
  const agente = (await headers()).get('user-agent') ?? '';
  const ehIphone = /iPhone|iPad|iPod/i.test(agente);

  const android = destino.androidUrl ? (
    <a
      className={estilos['botaoAndroid']}
      href={destino.androidUrl}
      data-testid="baixar-android"
    >
      <span className={estilos['rotuloDoBotao']}>Baixar para Android</span>
      <span className={estilos['detalheDoBotao']}>Arquivo de instalação (APK)</span>
    </a>
  ) : (
    <p className={estilos['indisponivel']} data-testid="instalador-indisponivel">
      O instalador para Android está indisponível no momento. Peça o link atualizado na recepção.
    </p>
  );

  const iphone = (
    <div className={estilos['cartaoIphone']} data-testid="ios-em-breve">
      <span className={estilos['rotuloDoBotao']}>iPhone</span>
      <span className={estilos['detalheDoBotao']}>
        {ehIphone
          ? 'O app para iPhone está a caminho. Por enquanto, fale com a recepção.'
          : 'Em breve na App Store'}
      </span>
    </div>
  );

  return (
    <main className={estilos['pagina']}>
      <section className={estilos['cartao']} aria-labelledby="titulo-baixar">
        <div className={estilos['academia']}>
          {marca.temIcone ? (
            <img
              className={estilos['icone']}
              src={`/marca/${encodeURIComponent(destino.tenantSlug)}/icon`}
              alt=""
              width={56}
              height={56}
            />
          ) : (
            <span className={estilos['inicial']} aria-hidden="true">
              {marca.displayName.slice(0, 1)}
            </span>
          )}
          <span className={estilos['nomeDaAcademia']}>{marca.displayName}</span>
        </div>

        <h1 id="titulo-baixar" className={estilos['titulo']}>
          Baixe o app da {marca.displayName}
        </h1>
        <p className={estilos['texto']}>{DESCRICAO}</p>

        {/* O celular de quem abriu vem primeiro. */}
        <div className={estilos['plataformas']}>
          {ehIphone ? (
            <>
              {iphone}
              {android}
            </>
          ) : (
            <>
              {android}
              {iphone}
            </>
          )}
        </div>

        <ol className={estilos['passos']}>
          {PASSOS.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
      </section>

      <p className={estilos['assinatura']}>
        tecnologia <strong>arenahub</strong>
      </p>
    </main>
  );
}
