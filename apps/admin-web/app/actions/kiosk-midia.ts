'use server';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Upload da midia da tela publica -- F51, ADR-042 Decisao 7.
 *
 * NAO revalida caminho nenhum: o upload devolve uma CHAVE, que o componente
 * coloca no rascunho em memoria. Quem grava e `salvarRascunhoAction`, e um
 * `revalidatePath` aqui rebuscaria o estado do servidor por cima do rascunho
 * que o gerente ainda esta editando -- apagando o que ele digitou antes de
 * enviar o video.
 */

export interface EstadoDoUploadDeMidia {
  erro?: string;
  midiaKey?: string;
}

/**
 * Cada recusa tem frase propria porque cada uma pede uma ACAO diferente:
 * arquivo grande demais se corta, arquivo do tipo errado se converte,
 * antivirus fora do ar se tenta de novo. Uma frase generica faria o gerente
 * tentar de novo o que nunca vai passar.
 */
const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  KIOSK_DEVICE_NOT_FOUND: 'Totem não encontrado nesta academia.',
  FILE_REQUIRED: 'Escolha um arquivo de vídeo.',
  FILE_TOO_LARGE: 'O vídeo passa de 40 MB. Reduza a duração ou a qualidade.',
  FILE_EMPTY: 'O arquivo está vazio.',
  FILE_TYPE_NOT_ALLOWED: 'Só entram arquivos MP4.',
  FILE_SIGNATURE_MISMATCH: 'O arquivo não é um MP4 válido, mesmo com esse nome.',
  FILE_INFECTED: 'O antivírus recusou este arquivo.',
  SCANNER_UNAVAILABLE: 'O antivírus está indisponível. Tente de novo em instantes.',
  SCANNER_TIMEOUT: 'O antivírus demorou a responder. Tente de novo em instantes.',

  /*
   * INGESTAO DE REEL (ADR-042, Decisao 7).
   *
   * As duas familias abaixo dizem coisas OPOSTAS ao gerente, e por isso nao
   * compartilham frase:
   *
   *   - `LINK_*` e `MIDIA_*` -> o problema esta no que ele colou. Ele
   *     resolve trocando o link.
   *   - `EXTRATOR_*` -> a ferramenta falhou. Ele NAO resolve pela tela, e a
   *     saida e o upload de MP4.
   *
   * Misturar as duas faria o gerente caçar um link bom atras de um defeito
   * que nao e dele -- exatamente o que o ADR mandou evitar.
   */
  LINK_NAO_E_DO_INSTAGRAM: 'Cole um endereço do Instagram (instagram.com).',
  LINK_NAO_APONTA_PARA_POST:
    'Esse endereço não aponta para um post. Use o link de um reel, post ou IGTV.',
  MIDIA_INDISPONIVEL:
    'Não foi possível abrir esse post. Confira se ele é público e ainda existe.',
  MIDIA_SEM_VIDEO: 'Esse post não tem vídeo.',
  MIDIA_GRANDE_DEMAIS: 'O vídeo do Instagram passa de 40 MB. Envie um MP4 reduzido.',
  EXTRATOR_INDISPONIVEL:
    'A cópia do Instagram está indisponível nesta instalação. Envie um MP4.',
  EXTRATOR_TIMEOUT: 'O Instagram demorou a responder. Tente de novo ou envie um MP4.',
  EXTRATOR_FALHOU:
    'Não foi possível copiar do Instagram agora — o problema não é o seu link. Envie um MP4 ou tente mais tarde.',
};

export interface EstadoDaIngestaoDeLink {
  erro?: string;
  midiaKey?: string;
  /** A URL CANONICA -- e ela que o bloco guarda, nao a que o gerente colou. */
  linkExterno?: string;
}

/**
 * Copia um reel do Instagram para a midia do bloco (ADR-042, Decisao 7).
 *
 * Mesma disciplina de `enviarMidiaAction`: NAO revalida caminho nenhum --
 * devolve chave e link, e quem grava e o `salvarRascunhoAction`. Um
 * `revalidatePath` aqui apagaria o rascunho que o gerente ainda edita.
 */
export async function ingerirMidiaDeLinkAction(
  kioskDeviceId: string,
  link: string,
): Promise<EstadoDaIngestaoDeLink> {
  const resposta = await chamarApi<{ midiaKey: string; linkExterno: string }>(
    `/api/v1/admin/kiosk-devices/${kioskDeviceId}/media/from-link`,
    { metodo: 'POST', corpo: { link } },
  );

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';

    return {
      erro: MENSAGEM[codigo] ?? `Não foi possível copiar o vídeo (${codigo || 'erro'}).`,
    };
  }

  return { midiaKey: resposta.dados.midiaKey, linkExterno: resposta.dados.linkExterno };
}

export async function enviarMidiaAction(
  kioskDeviceId: string,
  formulario: FormData,
): Promise<EstadoDoUploadDeMidia> {
  const resposta = await chamarApi<{ midiaKey: string }>(
    `/api/v1/admin/kiosk-devices/${kioskDeviceId}/media`,
    { metodo: 'POST', formulario },
  );

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';

    return {
      erro: MENSAGEM[codigo] ?? `Não foi possível enviar o vídeo (${codigo || 'erro'}).`,
    };
  }

  return { midiaKey: resposta.dados.midiaKey };
}
