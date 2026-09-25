import { Injectable } from '@nestjs/common';
import type { StudentCredential, StudentCredentialKind } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * O numero ja pertence a OUTRO aluno deste tenant.
 *
 * Mesma FORMA de erro que a violacao do UNIQUE do Prisma (`code: 'P2002'`)
 * produziria -- assim o controller traduz os dois casos (conflito
 * descoberto na leitura, ou colisao rara na escrita) pela MESMA funcao
 * `ehViolacaoDeUnicidade`, sem duplicar a checagem.
 */
export class CredencialJaAtribuidaError extends Error {
  readonly code = 'P2002';

  constructor() {
    super('Credencial já pertence a outro aluno');
  }
}

/**
 * Escrita de `StudentCredential` -- o numero que o leitor (cartao de
 * catraca ou identificador facial) reconhece para o aluno.
 *
 * ISSUE #396: ate aqui o UNICO gravador era o import em lote
 * (`packages/database/src/import-ativos/importar.ts`), que le a coluna
 * `Identificador Facial` do CSV do Pacto. Aluno cadastrado manualmente pela
 * recepcao (fora do import) nao tinha como vincular o numero que a
 * academia ja tem em maos -- a ficha ficava completa no sistema, mas a
 * catraca nao teria como identificar a pessoa por biometria ou cartao.
 *
 * NAO E sincronizacao com o leitor Topdata -- isso e fatia propria, com
 * SPEC do PI (regra de arquitetura #7, `CLAUDE.md`: biometria nunca e a
 * UNICA porta). Este repositorio so grava o numero que a recepcao digita,
 * do mesmo jeito que o import ja grava o que ve no CSV.
 */
@Injectable()
export class StudentCredentialRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Cria ou atualiza a credencial de um `kind` PARA ESTE ALUNO -- um aluno
   * tem NO MAXIMO uma credencial por tipo (cartao, facial), espelhando o
   * que `import-ativos` ja faz linha a linha.
   *
   * NAO E UM UPSERT PELO NUMERO. A primeira versao deste metodo fazia
   * `upsert` com `where` no par (tenant, kind, externalId): quando o
   * numero ja existia -- de OUTRO aluno --, o `where` achava a linha dele
   * mesmo assim e o `update: { studentId }` TRANSFERIA a credencial em
   * silencio, sem checar dono. O teste de integracao pegou isso (`recusa
   * o numero que ja pertence a OUTRO aluno`): esperava 400, recebeu 200 --
   * a catraca teria passado a abrir para a pessoa errada.
   *
   * A leitura primeiro decide qual dos tres casos e: (1) mesmo aluno, numero
   * igual -- no-op; (2) mesmo aluno, numero mudou -- atualiza a linha DELE
   * pelo id; (3) outro aluno dono do numero -- P2002 ao tentar criar, que
   * quem chama traduz em `CREDENTIAL_ALREADY_ASSIGNED`. Nunca um `update`
   * que troca o dono.
   */
  async definir(
    contexto: TenantContext,
    studentId: string,
    kind: StudentCredentialKind,
    externalId: string,
  ): Promise<StudentCredential> {
    return this.db.comTenant(async (tx) => {
      const existente = await tx.studentCredential.findUnique({
        where: { tenantId_kind_externalId: { tenantId: contexto.tenantId, kind, externalId } },
      });

      if (existente) {
        if (existente.studentId === studentId) return existente;

        throw new CredencialJaAtribuidaError();
      }

      const atual = await tx.studentCredential.findFirst({
        where: { tenantId: contexto.tenantId, studentId, kind },
      });

      if (atual) {
        return tx.studentCredential.update({ where: { id: atual.id }, data: { externalId } });
      }

      return tx.studentCredential.create({
        data: { tenantId: contexto.tenantId, studentId, kind, externalId },
      });
    });
  }

  async listarPorAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<StudentCredential[]> {
    return this.db.comTenant((tx) =>
      tx.studentCredential.findMany({
        where: { tenantId: contexto.tenantId, studentId },
        orderBy: { kind: 'asc' },
      }),
    );
  }
}
