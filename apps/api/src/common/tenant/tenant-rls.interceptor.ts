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
 */
@Injectable()
export class TenantRlsInterceptor implements NestInterceptor {
  intercept(contextoDeExecucao: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = contextoDeExecucao.switchToHttp().getRequest<Request>();
    const contexto = requisicao.tenantContext;

    if (!contexto) return proximo.handle();

    return from(
      comContexto(paraContextoDeBanco(contexto), () =>
        lastValueFrom(proximo.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
