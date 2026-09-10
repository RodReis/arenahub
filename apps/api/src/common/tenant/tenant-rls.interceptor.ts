import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { comContexto, type TenantDbContext } from '@arenahub/database';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { TenantContext } from './tenant-context.js';

/**
 * Traduz o contexto da requisicao para o que a politica RLS le.
 *
 * A elevacao de suporte (ADR-052 SS3) vira `platform`, o unico contexto que
 * a politica deixa atravessar tenant. Ela EXPIRA: passada a validade, a
 * sessao volta a valer so para o proprio tenant. Sem essa checagem, uma
 * elevacao vencida seguiria lendo todos os tenants -- bypass silencioso, que
 * INV-005 proibe.
 */
export function paraContextoDeBanco(contexto: TenantContext): TenantDbContext {
  const elevacao = contexto.supportElevation;

  if (elevacao && elevacao.expiresAt.getTime() > Date.now()) {
    return { kind: 'platform' };
  }

  return { kind: 'tenant', tenantId: contexto.tenantId };
}

/**
 * Abre o escopo de contexto de banco pela duracao da requisicao.
 *
 * INTERCEPTOR, e nao middleware: no Nest o middleware roda ANTES dos guards,
 * e quem poe `tenantContext` na requisicao e o `AuthGuard`. Um middleware
 * nunca veria o tenant, e o escopo nasceria vazio em toda requisicao
 * autenticada -- falha que so apareceria ao tocar o banco.
 *
 * TRES origens de identidade, nao uma. O `AuthGuard` poe `tenantContext`
 * (pessoa, por cookie); o `KioskAuthGuard` poe `kioskContext` (totem) e o
 * `EdgeAuthGuard` poe `edgeContext` (catraca), ambos por assinatura HMAC.
 * Os dois dispositivos sao `@Public()` para o `AuthGuard` justamente porque
 * um processo nao tem cookie -- ler so `tenantContext` deixaria TODA rota de
 * dispositivo sem escopo, e as duas leem `students` (issue #302).
 *
 * No Edge o defeito seria o mais grave do sistema: `IdentityResolver` traz o
 * status do aluno por `include`, e a politica recusando essa linha devolve
 * o vinculo SEM o aluno -- a catraca decidiria sem saber se ele esta ativo.
 *
 * Nenhum dispositivo eleva: nao ha sessao de suporte num equipamento, entao
 * o contexto e sempre o do proprio tenant.
 *
 * Rota publica nao abre escopo. Nao ha tenant que se possa adivinhar sem
 * sessao, e inventar um seria exatamente o vazamento que a fatia impede.
 * Query a tabela protegida a partir dali falha com
 * `SemContextoDeTenantError` -- alto e visivel, em vez de lista vazia.
 *
 * `from(...)` embrulha a promessa porque o escopo precisa cobrir a execucao
 * INTEIRA do handler, nao so a chamada sincrona que devolve o Observable. Um
 * `contextoRls.run(ctx, () => next.handle())` retornaria o Observable ainda
 * dentro do escopo, mas a inscricao -- onde o trabalho de fato acontece --
 * correria fora dele.
 *
 * ARMADILHA PARA QUEM VIER DEPOIS: `lastValueFrom` colapsa o stream no
 * ULTIMO valor. Hoje nao ha rota que emita mais de um (nenhum `@Sse`, nenhum
 * `StreamableFile`, nenhum handler devolvendo `Observable` -- verificado), e
 * para o caso normal, um valor so, o efeito e nenhum. Uma rota de stream
 * quebraria aqui: os valores intermediarios sumiriam, e o sintoma apareceria
 * na rota nova, longe deste arquivo. Quando a primeira existir, trocar por um
 * operador que preserve o stream e mantenha o escopo aberto pela duracao dele.
 */
@Injectable()
export class TenantRlsInterceptor implements NestInterceptor {
  intercept(contextoDeExecucao: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = contextoDeExecucao.switchToHttp().getRequest<Request>();
    const contexto = requisicao.tenantContext;
    const dispositivo = requisicao.kioskContext ?? requisicao.edgeContext;

    const contextoDeBanco: TenantDbContext | undefined = contexto
      ? paraContextoDeBanco(contexto)
      : dispositivo
        ? { kind: 'tenant', tenantId: dispositivo.tenantId }
        : undefined;

    if (!contextoDeBanco) return proximo.handle();

    return from(
      comContexto(contextoDeBanco, () =>
        lastValueFrom(proximo.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
