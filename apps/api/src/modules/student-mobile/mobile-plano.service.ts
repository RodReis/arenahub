import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';

/**
 * A situacao do direito de acesso, como o banco a nomeia.
 *
 * O enum do Prisma atravessa ate a tela SEM TRADUCAO aqui de proposito:
 * traduzir para pt-BR no BFF poria o texto da interface em dois lugares (aqui
 * e no app) e o primeiro a mudar mentiria. A tela traduz; a API nomeia.
 */
export type SituacaoDoPlano = 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface PlanoDoAluno {
  readonly situacao: SituacaoDoPlano;
  readonly inicioEm: string;
  readonly fimEm: string;
  /**
   * Nome do plano assinado. NULO quando a origem nao e assinatura (cortesia,
   * visitante, dependente): nao ha plano a nomear, e inventar um rotulo
   * ("Cortesia") faria a tela exibir como plano o que e uma concessao.
   */
  readonly nome: string | null;
}

export interface RespostaDoPlano {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  /**
   * NULO quando o aluno nao tem direito nenhum -- nem vigente, nem vencido.
   *
   * `null` e nao um objeto com `situacao: 'INACTIVE'`: nunca houve direito, e
   * `INACTIVE` nem existe no enum. Afirmar uma situacao para quem nao tem
   * nenhuma e inventar dado, e a tela nao teria como distinguir "sem plano"
   * de "plano num estado que eu nao conheco".
   */
  readonly plano: PlanoDoAluno | null;
}

@Injectable()
export class MobilePlanoService {
  constructor(private readonly db: PrismaService) {}

  /**
   * O plano do aluno da SESSAO -- Slice 4.2.
   *
   * `M4-FR-006` manda "exibir status da assinatura e data relevante SEM
   * INFERIR ESTADO NO CLIENTE": a situacao vem da coluna, ja decidida pelo
   * motor de entitlement. O app nao compara `fimEm` com o relogio dele para
   * concluir "vencido" -- relogio de celular erra, e a conclusao apareceria
   * como fato.
   */
  async montar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDoPlano> {
    /*
     * `comTenant` e nao `db.entitlement` direto -- ADR-054 §3, e a licao da
     * F23: `entitlements` tem RLS com FORCE, e fora de transacao com contexto
     * o Postgres devolve ZERO LINHAS sob o role restrito. Sem erro, sem log,
     * e a tela diria "sem plano" para quem tem plano.
     */
    /*
     * DUAS CONSULTAS, e nao uma com ordenacao esperta.
     *
     * A pergunta que o aluno faz ao abrir a tela e "posso entrar hoje?", e
     * quem responde e o direito ACTIVE. Uma busca so, ordenada por
     * `startsAt desc`, devolveria o direito AGENDADO para o mes que vem --
     * futuro e mais recente -- no lugar do que vale agora.
     *
     * Ordenar pelo enum `status` resolveria por acaso (`ACTIVE` vem primeiro
     * em ordem alfabetica) e quebraria calado no dia em que um estado novo
     * entrasse antes dele. O acaso nao esta documentado no enum, entao nao e
     * contrato -- a preferencia fica explicita aqui.
     *
     * O desempate por `id` fecha a porta que `include sem orderBy` ja abriu
     * neste repositorio: com dois direitos de mesmo `startsAt`, a ordem viria
     * da fisica do banco e mudaria sozinha apos um UPDATE.
     */
    const selecao = {
      status: true,
      startsAt: true,
      endsAt: true,
      subscription: { select: { plan: { select: { name: true } } } },
    } as const;

    const entitlement = await this.db.comTenant(async (tx) => {
      /*
       * A JANELA ENTRA NO `where`, e nao so o `status` -- e o mesmo filtro de
       * `access-projection.repository.ts`, que e quem de fato decide entrada
       * na catraca.
       *
       * `status: 'ACTIVE'` sozinho NAO significa vigente: o direito so vira
       * `EXPIRED` quando algo o expira, e enquanto esse algo nao roda existe
       * linha `ACTIVE` com `endsAt` no passado. Sem a janela, o app diria
       * "Ativo, válido até 01/08" num dia 12/09 -- e o aluno sairia de casa
       * com um direito que a catraca vai recusar, porque la a janela e
       * conferida. Duas telas do mesmo produto discordando sobre acesso.
       *
       * MULTIPLOS DIREITOS SIMULTANEOS SAO LEGITIMOS (INV-064: assinatura,
       * cortesia, visitante, dependente...) e nenhuma unica no banco os
       * impede. Entre dois vigentes, o app mostra o que TERMINA POR ULTIMO:
       * e a resposta certa para "ate quando posso treinar?", enquanto o que
       * COMECOU por ultimo pode ser o mais curto -- uma cortesia de uma
       * semana concedida hoje, ao lado da mensalidade que vai ate dezembro.
       */
      const vigente = await tx.entitlement.findFirst({
        where: {
          studentId: ctx.studentId,
          status: 'ACTIVE',
          startsAt: { lte: agora },
          endsAt: { gte: agora },
        },
        orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
        select: selecao,
      });

      if (vigente) return vigente;

      /*
       * Sem direito vigente, o mais recente CONTA a historia: "seu plano
       * venceu em tal data" e informacao; tela vazia e so ausencia.
       *
       * Aqui a ordem e por `startsAt`, e nao por `endsAt` como acima: o que
       * se procura e o ULTIMO VINCULO que existiu, nao o de validade mais
       * longa. Um direito revogado ontem descreve melhor a situacao do aluno
       * do que uma cortesia antiga cujo `endsAt` nominal era mais distante.
       */
      return tx.entitlement.findFirst({
        where: { studentId: ctx.studentId },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        select: selecao,
      });
    });

    if (!entitlement) {
      return { asOf: agora.toISOString(), status: 'AVAILABLE', plano: null };
    }

    return {
      asOf: agora.toISOString(),
      status: 'AVAILABLE',
      plano: {
        situacao: entitlement.status,
        inicioEm: entitlement.startsAt.toISOString(),
        fimEm: entitlement.endsAt.toISOString(),
        nome: entitlement.subscription?.plan.name ?? null,
      },
    };
  }
}
