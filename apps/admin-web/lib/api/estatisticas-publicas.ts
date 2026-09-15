import 'server-only';

import { z } from 'zod';

import { chamarApi } from './server-client';

const ESQUEMA = z.object({
  totalAlunosAtivos: z.number().int().nonnegative(),
  totalUnidadesAtivas: z.number().int().nonnegative(),
});

export type EstatisticasPublicas = z.infer<typeof ESQUEMA>;

/**
 * Contagem real de alunos e unidades, para o rodape do hero de login sem
 * marca de tenant -- F71.
 *
 * `null` em QUALQUER falha, inclusive a API fora do ar: `chamarApi` nao
 * envolve o `fetch` em try/catch (rede indisponivel lanca), e a estatistica e
 * um adorno do rodape -- a tela de login nao pode quebrar por causa dela.
 */
export async function lerEstatisticasPublicas(): Promise<EstatisticasPublicas | null> {
  try {
    const resposta = await chamarApi('/api/v1/plataforma/estatisticas-publicas', {
      esquema: ESQUEMA,
    });

    return resposta.ok && resposta.dados ? resposta.dados : null;
  } catch {
    return null;
  }
}
