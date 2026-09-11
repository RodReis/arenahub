import { comContexto } from '@arenahub/database';

import type { TenantContext } from '../../src/common/tenant/tenant-context.js';

/**
 * Envolve um servico ou repositorio para que TODA chamada dele corra com o
 * contexto de banco aberto -- o que, em requisicao HTTP, o
 * `TenantRlsInterceptor` faz sozinho.
 *
 * POR QUE ISTO EXISTE. O teste de integracao chama o caso de uso DIRETO, sem
 * passar por HTTP, entao nenhum interceptor roda. Quem toca tabela com
 * politica RLS (F66) por `comTenant` recusa com `SemContextoDeTenantError`,
 * e esse erro e o comportamento CERTO: o ADR-054 SS3 escolheu falhar alto em
 * vez de devolver lista vazia, que seria indistinguivel de "nao ha dados".
 * Abrir o escopo aqui e o equivalente de teste ao que a requisicao faz.
 *
 * NAO afrouxa o que esta sob teste: o escopo diz ao Postgres QUAL tenant, e
 * o `where` de cada repositorio continua sendo exercitado como antes. O
 * isolamento entre tenants segue provado em `rls-isolation.int-spec.ts`, que
 * de proposito nao usa este helper.
 *
 * `Proxy` sobre a instancia, e nao um objeto com os metodos usados hoje: um
 * metodo novo cairia como `is not a function`, e o sintoma nao apontaria
 * para a causa.
 *
 * O tenant sai do PRIMEIRO argumento: o `TenantContext` na maioria das
 * assinaturas (`CONVENTION.md`), ou o proprio `tenantId` em string, forma
 * que alguns casos de uso chamados por job usam. Metodo que nao siga nenhuma
 * das duas nao passa por aqui -- chame-o direto, dentro de um `comContexto`
 * proprio.
 *
 * ATENCAO AO USAR EM TESTE DE CORRIDA. Este helper abre o ESCOPO, nao a
 * transacao -- quem abre transacao e o `comTenant` dentro do codigo de
 * producao. Mas onde o codigo sob teste tiver `comTenant` em volta de uma
 * leitura otimista que antecede escrita condicionada, as duas chamadas
 * concorrentes deixam de ler o mesmo estado e a corrida se resolve numa
 * barreira ANTERIOR a que o teste vigia. Isso aconteceu na #306 com
 * `AderirARecorrenciaUseCase`, e a saida foi corrigir o codigo de producao
 * (ler a tabela sem politica solta, e so o campo protegido em `comTenant`),
 * nao afrouxar o teste. Sintoma: falha intermitente com o erro CERTO na
 * classe ERRADA.
 */
export function comContextoDeTenant<T extends object>(instancia: T): T {
  return new Proxy({} as T, {
    get(_alvo, propriedade: string) {
      const metodo = (instancia as unknown as Record<string, unknown>)[propriedade];

      if (typeof metodo !== 'function') return metodo;

      return (...argumentos: unknown[]) => {
        const primeiro = argumentos[0] as TenantContext | string | undefined;
        const tenantId = typeof primeiro === 'string' ? primeiro : primeiro?.tenantId;

        if (!tenantId) {
          throw new Error(
            `comContextoDeTenant: '${propriedade}' foi chamado sem TenantContext nem tenantId ` +
              'no primeiro argumento, e o helper deriva o tenant dele. Chame o metodo direto, ' +
              'dentro de um `comContexto(...)` proprio.',
          );
        }

        return comContexto({ kind: 'tenant', tenantId }, () =>
          (metodo as (...a: unknown[]) => Promise<unknown>).apply(instancia, argumentos),
        );
      };
    },

    /**
     * Escrita vai para a INSTANCIA, nao para o alvo vazio do `Proxy`.
     *
     * Sem isto, o teste que troca um metodo privado para simular corrida
     * (`billing-inadimplencia`, o webhook comitando no meio da janela)
     * gravaria no objeto vazio: a troca nao teria efeito, o codigo original
     * rodaria, e o teste falharia por um motivo que nada no erro revela.
     */
    set(_alvo, propriedade: string, valor: unknown) {
      (instancia as unknown as Record<string, unknown>)[propriedade] = valor;

      return true;
    },
  });
}
