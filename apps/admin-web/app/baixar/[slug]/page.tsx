import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { chamarApi } from '../../../lib/api/server-client';
import estilos from './baixar.module.css';

export const metadata: Metadata = {
  title: 'Baixar o app',
  // Link de distribuicao, nao pagina de conteudo: nada a indexar.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Link curto do app (#538) -- `<painel>/baixar/<final>`.
 *
 * Quem abre e o ALUNO, sem sessao, pelo QR do balcao ou pelo WhatsApp. A API
 * diz para onde o final aponta HOJE e a pagina so redireciona: trocar o APK no
 * painel muda o destino sem mudar o link, o QR impresso nem a mensagem ja
 * enviada.
 *
 * Por agora so Android. Quando o iOS chegar, e aqui que o celular escolhe a
 * loja -- o link continua o mesmo.
 */
export default async function BaixarOApp({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resposta = await chamarApi<{ androidUrl: string }>(
    `/api/v1/public/app-links/${encodeURIComponent(slug)}`,
  );

  if (resposta.ok && resposta.dados) {
    redirect(resposta.dados.androidUrl);
  }

  return (
    <main className={estilos['pagina']}>
      <section className={estilos['cartao']} aria-labelledby="titulo-baixar" data-testid="instalador-indisponivel">
        <h1 id="titulo-baixar" className={estilos['titulo']}>
          Instalador indisponível no momento
        </h1>
        <p className={estilos['texto']}>
          Este link do app não está ativo agora. Peça o link atualizado na recepção da academia.
        </p>
      </section>
    </main>
  );
}
