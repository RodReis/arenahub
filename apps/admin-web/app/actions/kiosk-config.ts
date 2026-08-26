'use server';

import { revalidatePath } from 'next/cache';
import type { KioskConfig } from '@arenahub/api-contracts';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Server Actions da Personalizacao do totem -- F50.
 *
 * As tres chamam as rotas admin da Task 3: salvar grava o RASCUNHO (nao
 * publica sozinho), publicar promove o rascunho a camada vigente, descartar
 * apaga o rascunho sem tocar na versao publicada. `revalidatePath` em todas:
 * a tela de configuracao le `estado` do servidor a cada render, sem cache de
 * cliente proprio.
 */

export interface EstadoDaAcaoDeConfiguracao {
  erro?: string;
  sucesso?: boolean;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  KIOSK_DEVICE_NOT_FOUND: 'Totem não encontrado nesta academia.',
  KIOSK_CONFIG_DRAFT_NOT_FOUND: 'Não há rascunho para publicar ou descartar.',
};

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function salvarRascunhoAction(
  kioskDeviceId: string,
  config: KioskConfig,
): Promise<EstadoDaAcaoDeConfiguracao> {
  const resposta = await chamarApi<void>(`/api/v1/admin/kiosk-devices/${kioskDeviceId}/config`, {
    metodo: 'PUT',
    corpo: config,
  });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar o rascunho') };
  }

  revalidatePath(`/operations/kiosks/${kioskDeviceId}`);

  return { sucesso: true };
}

export async function publicarAction(kioskDeviceId: string): Promise<EstadoDaAcaoDeConfiguracao> {
  const resposta = await chamarApi<{ version: number }>(
    `/api/v1/admin/kiosk-devices/${kioskDeviceId}/config/publish`,
    { metodo: 'POST' },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível publicar a configuração') };
  }

  revalidatePath(`/operations/kiosks/${kioskDeviceId}`);

  return { sucesso: true };
}

export async function descartarAction(kioskDeviceId: string): Promise<EstadoDaAcaoDeConfiguracao> {
  const resposta = await chamarApi<void>(
    `/api/v1/admin/kiosk-devices/${kioskDeviceId}/config/draft`,
    { metodo: 'DELETE' },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível descartar o rascunho') };
  }

  revalidatePath(`/operations/kiosks/${kioskDeviceId}`);

  return { sucesso: true };
}
