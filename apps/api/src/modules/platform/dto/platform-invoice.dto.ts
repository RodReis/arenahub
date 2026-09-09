import { z } from 'zod';

/**
 * Instante do pagamento. Aqui e INSTANTE e nao dia civil (ao contrario de
 * `tenant-contract.dto.ts`): `paid_at` e `timestamp`, e a hora do registro
 * importa quando o Super Admin concilia dois pagamentos do mesmo dia.
 */
export const esquemaDeRegistroDePagamento = z
  .object({ pagoEm: z.string().datetime().optional() })
  .strict();

/**
 * Emissao manual pelo Super Admin.
 *
 * `emitirEm` existe para o Super Admin emitir a competencia corrente fora do
 * dia agendado -- nao para escolher QUALQUER mes: a contagem de alunos e a de
 * agora, entao emitir uma competencia passada gravaria o retrato errado.
 * Ausente, usa o relogio do servidor, que e o caso normal.
 */
export const esquemaDeEmissaoDeFatura = z
  .object({
    tenantId: z.string().uuid(),
    emitirEm: z.string().datetime().optional(),
  })
  .strict();
