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
};

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
