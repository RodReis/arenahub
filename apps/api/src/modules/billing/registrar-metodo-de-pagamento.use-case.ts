import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';

/**
 * Registra um metodo de pagamento tokenizado do aluno. `MVP-02` 7, Slice 2.3:
 * "criacao e troca de metodo tokenizado".
 *
 * O QUE ESTE CASO DE USO NAO FAZ, E E O PONTO (INV-098, `M2-FR-011`): ele NAO
 * tokeniza. O token chega pronto, gerado no navegador do aluno pelo checkout
 * hospedado do provedor -- o dado do cartao vai do dispositivo dele direto
 * para a Getnet, e o backend nunca ve PAN nem CVV.
 *
 * Se algum dia esta assinatura receber `cardNumber`, o defeito nao e "faltou
 * validar": e o ArenaHub tendo entrado no escopo do PCI DSS. A guarda
 * estrutural em `dado-de-cartao-nao-entra-no-backend.spec.ts` existe para
 * pegar isso no dia em que a linha for escrita.
 */

export class AlunoNaoEncontradoParaMetodoError extends ErroDeDominio {
  constructor() {
    super('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
  }
}

export class TokenJaRegistradoParaOutroAlunoError extends ErroDeDominio {
  constructor() {
    /**
     * 409 e nao 422: nao ha nada de errado com a entrada -- o token existe e
     * pertence a outra pessoa. Devolver 422 mandaria a recepcao corrigir um
     * campo que esta certo.
     */
    super(
      'PAYMENT_METHOD_TOKEN_CONFLICT',
      409,
      'Este metodo de pagamento ja esta registrado para outro aluno',
    );
  }
}

export interface MetodoRegistrado {
  readonly id: string;
  readonly provider: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly isDefault: boolean;
}

export interface EntradaDeMetodo {
  readonly studentId: string;
  /** Token do cofre do provedor. NUNCA o numero do cartao (INV-098). */
  readonly externalTokenId: string;
  /**
   * `| undefined` explicito: o projeto usa `exactOptionalPropertyTypes`, e o
   * Zod devolve a propriedade PRESENTE valendo `undefined` quando o campo e
   * opcional. Sem isto o controller nao consegue repassar o que validou.
   */
  readonly brand?: string | undefined;
  readonly last4?: string | undefined;
  readonly expMonth?: number | undefined;
  readonly expYear?: number | undefined;
  /**
   * Torna este o metodo cobrado na recorrencia. O PRIMEIRO metodo do aluno e
   * padrao de qualquer forma -- ver abaixo.
   */
  readonly tornarPadrao?: boolean | undefined;
}

@Injectable()
export class RegistrarMetodoDePagamentoUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly contas: ProviderAccountResolver,
  ) {}

  async executar(contexto: TenantContext, entrada: EntradaDeMetodo): Promise<MetodoRegistrado> {
    // `comTenant`: `students` tem politica RLS (F66) e, fora de transacao
    // interceptada, o `set_config` nunca aplica -- sob o role restrito a
    // leitura volta VAZIA e o aluno legitimo vira "nao encontrado"
    // (issue #306).
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: entrada.studentId, tenantId: contexto.tenantId },
        select: { id: true },
      }),
    );

    if (!aluno) {
      throw new AlunoNaoEncontradoParaMetodoError();
    }

    /**
     * Resolve o provedor de CARTAO pela capacidade, nunca pela marca
     * (ADR-032). O token so faz sentido no cofre de quem o emitiu: gravar
     * `provider` a partir daqui impede que uma troca de PSP deixe tokens
     * orfaos apontando para um cofre que ninguem mais consulta.
     */
    const conta = await this.contas.resolver(contexto, 'CARD');

    return this.db.$transaction(async (tx) => {
      const existente = await tx.paymentMethod.findUnique({
        where: {
          provider_externalTokenId: {
            provider: conta.provider,
            externalTokenId: entrada.externalTokenId,
          },
        },
        select: { id: true, studentId: true, tenantId: true },
      });

      /**
       * REENVIO DO MESMO TOKEN NAO E ERRO. O checkout hospedado devolve o
       * mesmo token para o mesmo cartao, e uma tela recarregada repete a
       * chamada: sem isto o aluno acumularia metodos duplicados a cada
       * tentativa interrompida. Mas token de OUTRO aluno e conflito de
       * verdade -- devolver o metodo alheio vazaria de quem e o cartao.
       */
      if (existente) {
        if (existente.studentId !== aluno.id || existente.tenantId !== contexto.tenantId) {
          throw new TokenJaRegistradoParaOutroAlunoError();
        }

        const atualizado = await tx.paymentMethod.update({
          where: { id: existente.id },
          data: {
            brand: entrada.brand ?? null,
            last4: entrada.last4 ?? null,
            expMonth: entrada.expMonth ?? null,
            expYear: entrada.expYear ?? null,
            status: 'ACTIVE',
          },
          select: { id: true, provider: true, brand: true, last4: true, isDefault: true },
        });

        return atualizado;
      }

      /**
       * O PRIMEIRO metodo ativo do aluno e padrao mesmo sem ninguem pedir.
       * Sem isto, cadastrar cartao e nao marcar a caixinha deixaria a
       * assinatura sem forma de cobranca -- e a falha so apareceria no dia
       * do vencimento, longe da acao que a causou.
       */
      const jaTemAtivo = await tx.paymentMethod.count({
        where: { tenantId: contexto.tenantId, studentId: aluno.id, status: 'ACTIVE' },
      });

      const seraPadrao = entrada.tornarPadrao === true || jaTemAtivo === 0;

      if (seraPadrao) {
        await this.rebaixarPadraoAtual(tx, contexto.tenantId, aluno.id);
      }

      return tx.paymentMethod.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: aluno.id,
          provider: conta.provider,
          externalTokenId: entrada.externalTokenId,
          brand: entrada.brand ?? null,
          last4: entrada.last4 ?? null,
          expMonth: entrada.expMonth ?? null,
          expYear: entrada.expYear ?? null,
          isDefault: seraPadrao,
        },
        select: { id: true, provider: true, brand: true, last4: true, isDefault: true },
      });
    });
  }

  /**
   * Tira o posto de padrao de quem o tinha.
   *
   * DENTRO DA MESMA TRANSACAO do `create`, e nao antes: o indice parcial do
   * banco garante UM padrao ativo por aluno, entao rebaixar fora da transacao
   * deixaria o aluno sem padrao nenhum se o `create` falhasse depois.
   */
  private async rebaixarPadraoAtual(
    tx: Prisma.TransactionClient,
    tenantId: string,
    studentId: string,
  ): Promise<void> {
    await tx.paymentMethod.updateMany({
      where: { tenantId, studentId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
