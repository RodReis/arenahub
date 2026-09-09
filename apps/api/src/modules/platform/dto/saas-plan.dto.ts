import { z } from 'zod';

/**
 * Dinheiro em CENTAVOS, inteiro (regra de arquitetura 6).
 *
 * `int()` recusa `4.99`: aceitar decimal aqui deixaria o Prisma truncar
 * silenciosamente para 4, e a academia seria cobrada um centavo por aluno.
 *
 * ZERO E VALIDO, e de proposito -- o preco do aluno inativo e negociado por
 * contrato e pode ser zero (ADR-052 §6).
 */
const precoEmCentavos = z.number().int().min(0).max(100_000_000);

/**
 * A coerencia entre modelo e valores NAO e validada aqui, e sim no caso de
 * uso (`conferirValores`).
 *
 * Um `refine` no esquema roda ANTES de qualquer leitura de banco, e com isso
 * o plano com valores errados responderia 422 no lugar do 404 do plano que
 * nem existe -- a validacao sequestraria o erro mais especifico. O caso de
 * uso confere na ordem certa, e o banco tem o CHECK como ultima trava.
 */
export const esquemaDePlanoSaas = z
  .object({
    name: z.string().trim().min(1).max(120),
    model: z.enum(['PER_STUDENT', 'FIXED_MONTHLY']),
    activeStudentPriceMinor: precoEmCentavos.nullish(),
    inactiveStudentPriceMinor: precoEmCentavos.nullish(),
    fixedPriceMinor: precoEmCentavos.nullish(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
  })
  .strict();
