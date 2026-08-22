import { StateBadge } from '@arenahub/ui';

import estilos from './sessao.module.css';
import type { CartaoDeArquivo } from './sessao';

/**
 * Um cartão por laudo enviado, com a MINIATURA do arquivo (ADR-041).
 *
 * ---------------------------------------------------------------------------
 * A IMAGEM NO LUGAR DO NOME DO ARQUIVO
 * ---------------------------------------------------------------------------
 *
 * Antes o cartão mostrava `WhatsApp Image 2026-08-04 at 08.21.31` — um texto
 * que não diz nada sobre o que foi enviado. Quem confere quer reconhecer o
 * laudo de relance, e o laudo é uma imagem; o nome do arquivo é um acidente
 * de como a foto chegou ao computador.
 *
 * A URL vem assinada e de vida curta (`GET .../file-url`), nunca pública:
 * laudo é dado de saúde, e link permanente vira link reencaminhado.
 *
 * ---------------------------------------------------------------------------
 * TRÊS ESTADOS, TRÊS TRATAMENTOS
 * ---------------------------------------------------------------------------
 *
 *   1. **imagem** (`image/*`) — miniatura de verdade, clicável para o
 *      original em tamanho cheio;
 *   2. **PDF ou CSV** — não há miniatura sem renderizar o documento, então o
 *      cartão mostra o tipo e o link para abrir. Fingir uma prévia genérica
 *      seria pior que assumir que não há;
 *   3. **arquivo expurgado** (`url === null`) — a retenção curta já apagou o
 *      original (`MVP-03` §15). O cartão DIZ isso, em vez de exibir imagem
 *      quebrada: "não existe mais" e "não carregou" pedem reações
 *      diferentes de quem olha.
 */

const SUBTITULO_DO_TIPO: Record<string, string> = {
  BIOIMPEDANCE: 'Balança de bioimpedância',
  BIOIMPEDANCE_ANALYSIS: 'App da balança',
  ECG: 'Eletrocardiograma',
};

/**
 * `UNKNOWN` não vira "UNKNOWN" na tela.
 *
 * O tipo fica desconhecido quando o extrator não classificou e quem enviou
 * não declarou — o caso do laudo que falhou na extração. Mostrar o enum cru
 * dá à recepção uma palavra em inglês que não significa nada; "Laudo não
 * identificado" diz o que é, e o estado do cartão ao lado já diz o que
 * fazer.
 */
function subtituloDoTipo(tipoDeLaudo: string): string {
  return SUBTITULO_DO_TIPO[tipoDeLaudo] ?? 'Laudo não identificado';
}

/**
 * O motivo da falha, em português de quem opera.
 *
 * O código cru (`EXTRACTOR_NO_CONTENT`) não diz nada a quem está no balcão.
 * E cada motivo pede uma ação diferente: arquivo ilegível se reenvia com
 * outra foto; extrator fora do ar se tenta de novo mais tarde.
 */
const MOTIVO_DA_FALHA: Record<string, string> = {
  EXTRACTOR_NO_CONTENT: 'O extrator não achou valores neste arquivo — traçado de ECG e foto tremida costumam dar nisso.',
  EXTRACTOR_UNAVAILABLE: 'O extrator estava fora do ar. Envie o arquivo de novo mais tarde.',
  FILE_TYPE_NOT_ALLOWED: 'Tipo de arquivo não aceito.',
};

/** O que o cartão consegue mostrar do arquivo em si. */
function Previa({ cartao }: { readonly cartao: CartaoDeArquivo }) {
  if (cartao.estado === 'FAILED') {
    return (
      <p className={estilos['previaAusente']} data-testid={`previa-falha-${cartao.importId}`}>
        {MOTIVO_DA_FALHA[cartao.motivoDaFalha ?? ''] ??
          'Não foi possível ler este arquivo.'}
      </p>
    );
  }

  if (cartao.url === null) {
    return (
      <p className={estilos['previaAusente']} data-testid={`previa-ausente-${cartao.importId}`}>
        Arquivo já expurgado — a avaliação publicada permanece.
      </p>
    );
  }

  if (!cartao.contentType?.startsWith('image/')) {
    return (
      <a
        className={estilos['previaDocumento']}
        href={cartao.url}
        target="_blank"
        rel="noreferrer"
        data-testid={`previa-documento-${cartao.importId}`}
      >
        Abrir {cartao.contentType === 'application/pdf' ? 'PDF' : 'arquivo'} original
      </a>
    );
  }

  return (
    <a
      className={estilos['previaImagem']}
      href={cartao.url}
      target="_blank"
      rel="noreferrer"
      data-testid={`previa-imagem-${cartao.importId}`}
    >
      {/*
        `<img>` nativo e não `next/image`: a URL é assinada, muda a cada
        carregamento e expira em minutos -- o otimizador do Next cachearia
        uma URL morta e serviria erro a partir da segunda visita.

        `alt` descreve o QUE é, não repete o nome do arquivo: quem usa leitor
        de tela ganha "laudo de bioimpedância", não "WhatsApp Image 2026-08-04".
      */}
      <img
        src={cartao.url}
        alt={`Laudo — ${subtituloDoTipo(cartao.tipoDeLaudo).toLowerCase()}`}
        loading="lazy"
      />
    </a>
  );
}

export function CartoesDeArquivo({ cartoes }: { readonly cartoes: readonly CartaoDeArquivo[] }) {
  if (cartoes.length === 0) return null;

  return (
    <ul className={estilos['arquivos']}>
      {cartoes.map((cartao) => (
        <li
          key={cartao.importId}
          className={estilos['arquivo']}
          data-testid={`arquivo-${cartao.importId}`}
        >
          <Previa cartao={cartao} />

          <div className={estilos['dadosDoArquivo']}>
            <p className={estilos['subtituloDoArquivo']}>{subtituloDoTipo(cartao.tipoDeLaudo)}</p>
            <StateBadge machine="fileReviewState" state={cartao.estado} />
          </div>
        </li>
      ))}
    </ul>
  );
}
