import { ImageResponse } from 'next/og';

import { ACCENT_SEED_DEFAULT, CARBON } from '@arenahub/ui';

import { lerMarca } from '../../../src/marca/ler-marca';

export const alt = 'Baixe o app da academia';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

/** Cores dos TOKENS (o gerador de imagem nao le variavel CSS). */
const FUNDO = CARBON['900'];
const TEXTO = CARBON['50'];
const SECUNDARIO = CARBON['300'];
const DESTAQUE = ACCENT_SEED_DEFAULT;

async function iconeComoDataUri(tenantSlug: string): Promise<string | null> {
  try {
    const resposta = await fetch(
      `${URL_INTERNA}/api/v1/branding/${encodeURIComponent(tenantSlug)}/icon`,
      { cache: 'no-store' },
    );
    if (!resposta.ok) return null;

    const tipo = resposta.headers.get('content-type') ?? 'image/png';
    const bytes = Buffer.from(await resposta.arrayBuffer()).toString('base64');

    return `data:${tipo};base64,${bytes}`;
  } catch {
    return null;
  }
}

async function tenantDoLink(slug: string): Promise<string | null> {
  try {
    const resposta = await fetch(
      `${URL_INTERNA}/api/v1/public/app-links/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (!resposta.ok) return null;

    const corpo = (await resposta.json()) as { tenantSlug?: unknown };

    return typeof corpo.tenantSlug === 'string' ? corpo.tenantSlug : null;
  } catch {
    return null;
  }
}

/**
 * A imagem da previa do WhatsApp (#538): icone e nome da ACADEMIA no lugar do
 * "expo.dev". PNG, e nao o SVG do icone direto: o WhatsApp nao mostra SVG em
 * previa. Sem icone, a inicial do nome no mesmo lugar.
 */
export default async function ImagemDaPrevia({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenantSlug = await tenantDoLink(slug);
  const marca = tenantSlug ? await lerMarca(tenantSlug) : null;
  const nome = marca?.displayName ?? 'ArenaHub';
  const icone = tenantSlug && marca?.temIcone ? await iconeComoDataUri(tenantSlug) : null;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          padding: '72px 80px',
          backgroundColor: FUNDO,
          backgroundImage: `radial-gradient(circle at 85% 10%, ${DESTAQUE}55, transparent 55%)`,
          color: TEXTO,
          fontFamily: 'sans-serif',
          alignItems: 'center',
          gap: '56px',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '220px',
            height: '220px',
            borderRadius: '48px',
            backgroundColor: `${TEXTO}12`,
            border: `2px solid ${TEXTO}30`,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {icone ? (
            <img src={icone} alt="" width={180} height={180} style={{ objectFit: 'contain' }} />
          ) : (
            <span style={{ fontSize: '120px', fontWeight: 800, color: DESTAQUE }}>
              {nome.slice(0, 1)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: 1 }}>
          <span style={{ fontSize: '34px', color: SECUNDARIO, fontWeight: 600 }}>{nome}</span>
          <span style={{ fontSize: '72px', fontWeight: 800, lineHeight: 1.05 }}>Baixe o app</span>
          <span style={{ fontSize: '30px', color: SECUNDARIO }}>
            Treino, plano e avaliação no seu celular.
          </span>
          <span
            style={{
              display: 'flex',
              marginTop: '12px',
              alignSelf: 'flex-start',
              padding: '14px 28px',
              borderRadius: '999px',
              backgroundColor: DESTAQUE,
              fontSize: '30px',
              fontWeight: 700,
            }}
          >
            Toque para baixar
          </span>
        </div>
      </div>
    ),
    size,
  );
}
