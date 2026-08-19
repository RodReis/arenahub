/**
 * Nucleo da importacao -- separado do script CLI (`prisma/import-pacto.ts`)
 * para ser testavel com um client injetado (Postgres de integracao), sem
 * depender de `process.env` nem de arquivo em disco.
 *
 * Regras do ADR-033 aplicadas aqui: ver `prisma/import-pacto.ts`.
 */
import type { PrismaClientArenaHub } from '../client.js';
import { converterRegistro, type RegistroPacto, type RegistroRejeitado } from './parser.js';

/** Maior matricula do Pacto e 2240 -- o sequencial local fecha acima disso. */
export const PROXIMO_SEQUENCIAL_APOS_IMPORTACAO = 3000;

export interface ResultadoDaImportacao {
  criados: number;
  atualizados: number;
  rejeitados: RegistroRejeitado[];
}

export interface AlvoDaImportacao {
  tenantId: string;
  planId: string;
  gymUnitId: string;
}

/**
 * Grava os registros ja convertidos. Idempotente: `membershipNumber` e
 * deterministico a partir da matricula do Pacto, e o upsert usa o indice
 * unico `(tenantId, membershipNumber)` -- rodar duas vezes produz o mesmo
 * resultado (regra de arquitetura no 4, INV-084).
 */
export async function importarRegistros(
  db: PrismaClientArenaHub,
  alvo: AlvoDaImportacao,
  registros: RegistroPacto[],
): Promise<ResultadoDaImportacao> {
  const rejeitados: RegistroRejeitado[] = [];
  let criados = 0;
  let atualizados = 0;

  for (const registro of registros) {
    const resultado = converterRegistro(registro);

    if (!resultado.ok) {
      rejeitados.push(resultado.rejeitado);
      continue;
    }

    const { aluno } = resultado;

    const jaExiste = await db.student.findUnique({
      where: {
        tenantId_membershipNumber: { tenantId: alvo.tenantId, membershipNumber: aluno.membershipNumber },
      },
    });

    await db.$transaction(async (tx) => {
      const estudante = await tx.student.upsert({
        where: {
          tenantId_membershipNumber: { tenantId: alvo.tenantId, membershipNumber: aluno.membershipNumber },
        },
        create: {
          tenantId: alvo.tenantId,
          membershipNumber: aluno.membershipNumber,
          fullName: aluno.fullName,
          birthDate: aluno.birthDate,
          registeredSex: aluno.registeredSex,
          cpf: aluno.cpf,
          // Regra 1 do ADR-033: CANCELLED, nunca ARCHIVED -- ARCHIVED e
          // terminal (INV-013) e impediria reativacao, que e o objetivo.
          status: 'CANCELLED',
          gymUnitId: alvo.gymUnitId,
        },
        update: {
          fullName: aluno.fullName,
          birthDate: aluno.birthDate,
          registeredSex: aluno.registeredSex,
          cpf: aluno.cpf,
        },
      });

      if (!jaExiste) {
        if (aluno.contacts.length > 0) {
          await tx.studentContact.createMany({
            data: aluno.contacts.map((contato) => ({
              tenantId: alvo.tenantId,
              studentId: estudante.id,
              type: contato.type,
              value: contato.value,
              isPrimary: contato.isPrimary,
            })),
          });
        }

        if (aluno.address) {
          await tx.studentAddress.create({
            data: { tenantId: alvo.tenantId, studentId: estudante.id, ...aluno.address },
          });
        }

        // Regra 3 do ADR-033: Subscription CANCELLED, SEM Entitlement --
        // regra de arquitetura no 1, aluno importado nao entra na academia.
        await tx.subscription.create({
          data: {
            tenantId: alvo.tenantId,
            studentId: estudante.id,
            planId: alvo.planId,
            status: 'CANCELLED',
            startsAt: estudante.createdAt,
            lastReason: aluno.planoOriginal
              ? `Importado do Pacto -- plano original: ${aluno.planoOriginal}`
              : 'Importado do Pacto -- sem plano original registrado',
          },
        });
      }
    });

    if (jaExiste) atualizados += 1;
    else criados += 1;
  }

  await db.$executeRaw`
    INSERT INTO student_sequences (tenant_id, next_value, updated_at)
    VALUES (${alvo.tenantId}::uuid, ${PROXIMO_SEQUENCIAL_APOS_IMPORTACAO}, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET next_value = GREATEST(student_sequences.next_value, EXCLUDED.next_value),
          updated_at = now()
  `;

  return { criados, atualizados, rejeitados };
}

export interface RelatorioDeCampo {
  campo: string;
  preenchidos: number;
  total: number;
}

/**
 * Conta preenchimento por campo -- e o que denuncia extrator quebrado antes
 * de ele virar milhares de linhas de lixo gravado (ADR-033: foi um
 * `logradouro 0/1934` que revelou o defeito de um extrator anterior).
 */
export function relatorioDePreenchimento(registros: RegistroPacto[]): RelatorioDeCampo[] {
  const total = registros.length;

  const contar = (predicado: (r: RegistroPacto) => boolean): number =>
    registros.filter(predicado).length;

  return [
    { campo: 'documento', preenchidos: contar((r) => Boolean(r.dados_pessoais.documento)), total },
    { campo: 'data_nascimento', preenchidos: contar((r) => Boolean(r.dados_pessoais.data_nascimento)), total },
    { campo: 'telefone', preenchidos: contar((r) => Boolean(r.dados_pessoais.telefone)), total },
    { campo: 'email', preenchidos: contar((r) => Boolean(r.dados_pessoais.email)), total },
    { campo: 'logradouro', preenchidos: contar((r) => Boolean(r.endereco.logradouro)), total },
    { campo: 'cidade', preenchidos: contar((r) => Boolean(r.endereco.cidade)), total },
    { campo: 'cep', preenchidos: contar((r) => Boolean(r.endereco.cep)), total },
  ];
}
