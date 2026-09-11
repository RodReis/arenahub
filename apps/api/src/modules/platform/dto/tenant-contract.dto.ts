import { z } from 'zod';

/**
 * Data que e DIA, e nao instante: as colunas sao `@db.Date`.
 *
 * Aceita `AAAA-MM-DD` e monta em UTC. Deixar o `new Date('2026-03-01')` do
 * cliente chegar com fuso faria `2026-02-28T21:00` virar o dia anterior no
 * Brasil -- e o aniversario do contrato mudaria de mes sozinho.
 */
const diaCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .transform((valor) => new Date(`${valor}T00:00:00.000Z`));

export const esquemaDeCriacaoDeContrato = z
  .object({
    tenantId: z.string().uuid(),
    planId: z.string().uuid(),
    indexCode: z.string().trim().min(1).max(24).toUpperCase().optional(),
    baseDate: diaCivil,
    anniversaryDay: z.number().int().min(1).max(31),
    anniversaryMonth: z.number().int().min(1).max(12),
    graceDays: z.number().int().min(0).max(180).optional(),
    /*
     * Para em 28 pela mesma razao de `billing_settings.due_day`: existir em
     * fevereiro sem regra de excecao. O aniversario aceita 31 porque e
     * data-base de contrato, nao dia de emissao.
     */
    issueDay: z.number().int().min(1).max(28),
    startsAt: diaCivil,
    endsAt: diaCivil.nullish(),
    supersedesId: z.string().uuid().nullish(),
  })
  .strict();

export const esquemaDeEncerramentoDeContrato = z
  .object({ encerradoEm: diaCivil })
  .strict();

/**
 * Descarte de rascunho -- F68.
 *
 * O MOTIVO E OBRIGATORIO, com o mesmo piso de 10 caracteres da inativacao de
 * tenant e da elevacao de suporte: o rascunho e apagado de verdade, e a linha
 * de auditoria e o unico lugar onde sobra registro de que ele existiu. Sem o
 * motivo, esse registro responde "quem" e nao responde "por que".
 */
export const esquemaDeDescarteDeContrato = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Descreva o motivo em ao menos 10 caracteres')
      .max(500),
  })
  .strict();

/**
 * Competencia e MES, nao dia. Aceitar `2026-03-15` criaria duas linhas para
 * marco, e a chave unica `(code, reference_month)` nao as veria como a mesma
 * competencia.
 */
export const esquemaDeValorDeIndice = z
  .object({
    code: z.string().trim().min(1).max(24).toUpperCase(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/, 'use o formato AAAA-MM'),
    /*
     * Variacao em MILESIMOS DE PONTO PERCENTUAL: 0,44% = 440. Inteiro pelo
     * mesmo motivo que dinheiro e inteiro -- o indice multiplica centavos.
     *
     * ACEITA NEGATIVO: deflacao existe, e recusa-la faria o Super Admin nao
     * conseguir cadastrar o mes em que o IPCA fechou abaixo de zero.
     */
    variationBasisPoints: z.number().int().min(-100_000).max(100_000),
  })
  .strict();
