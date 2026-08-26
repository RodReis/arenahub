import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { montarOpenApi } from '../../src/openapi.js';
import { OPERACOES_SEM_SCHEMA_DE_RESPOSTA } from './openapi-divida-de-schema.js';

const METODOS_HTTP = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** `POST /api/v1/invoices` -- a chave da allowlist e do relatorio de erro. */
function operacoesSemSchemaDeResposta(paths: Record<string, unknown>): string[] {
  const achadas: string[] = [];

  for (const [caminho, item] of Object.entries(paths)) {
    for (const metodo of METODOS_HTTP) {
      const operacao = (item as Record<string, unknown>)[metodo] as
        | { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
        | undefined;

      if (!operacao) continue;

      /**
       * BASTA UMA resposta com schema. `2xx` e o que interessa na pratica,
       * mas exigir o codigo exato aqui obrigaria a saber, para cada rota, se
       * ela devolve 200 ou 201 -- checagem que nao paga o que custa. O que
       * esta guarda existe para pegar e a operacao que nao descreve corpo
       * NENHUM, e essa passa igual pelos dois criterios.
       */
      const temSchema = Object.values(operacao.responses ?? {}).some((resposta) =>
        Object.values(resposta?.content ?? {}).some((conteudo) => conteudo?.schema !== undefined),
      );

      if (!temSchema) achadas.push(`${metodo.toUpperCase()} ${caminho}`);
    }
  }

  return achadas.sort();
}

const CAMINHO_DO_SNAPSHOT = join(
  process.cwd(),
  '../../packages/api-contracts/openapi/arenahub-v1.json',
);

/**
 * O contrato publicado tem de bater com as rotas que existem de verdade.
 *
 * Sem este teste, o snapshot vira documentacao que envelhece: alguem muda
 * uma rota, esquece de regerar, e quem consome a API descobre a divergencia
 * em producao.
 */
describe('contrato OpenAPI', () => {
  let app: INestApplication;
  let documento: ReturnType<typeof montarOpenApi>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    documento = montarOpenApi(app);

    // `ATUALIZAR_OPENAPI=1 pnpm --filter @arenahub/api test:integration`
    // regenera o snapshot. Fica aqui, e nao num script `tsx`, porque o
    // esbuild do `tsx` nao emite `design:paramtypes` e a injecao do Nest
    // falha em runtime -- o ts-jest emite corretamente.
    if (process.env['ATUALIZAR_OPENAPI']) {
      mkdirSync(dirname(CAMINHO_DO_SNAPSHOT), { recursive: true });
      writeFileSync(CAMINHO_DO_SNAPSHOT, `${JSON.stringify(documento, null, 2)}\n`, 'utf8');
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('bate com o snapshot versionado', () => {
    const snapshot: unknown = JSON.parse(readFileSync(CAMINHO_DO_SNAPSHOT, 'utf8'));

    // `paths` e o que interessa: e o contrato com quem consome. Versao muda
    // a cada release e nao deveria quebrar o teste.
    expect((documento as { paths: unknown }).paths).toEqual(
      (snapshot as { paths: unknown }).paths,
    );
  });

  it('publica as rotas que a fatia entrega', () => {
    const caminhos = Object.keys(documento.paths);

    expect(caminhos).toEqual(
      expect.arrayContaining([
        '/health/live',
        '/health/ready',
        '/version',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/units',
        '/api/v1/units/{id}',
        // F7 -- aluno, plano e entitlement manual.
        '/api/v1/students',
        '/api/v1/students/{id}',
        '/api/v1/students/{id}/status',
        '/api/v1/students/{id}/entitlements',
        '/api/v1/students/{id}/timeline',
        '/api/v1/plans',
        '/api/v1/plans/{id}',
        // F53 -- backend de preco de plano: obrigatorio na criacao, mais
        // reajuste que cria nova linha de vigencia sem tocar invoice emitida.
        '/api/v1/plans/{id}/prices',
        '/api/v1/subscriptions',
        '/api/v1/subscriptions/{id}/actions',
        '/api/v1/entitlements/courtesy',
        // F8 -- consentimento biometrico.
        '/api/v1/consent-documents/biometric',
        '/api/v1/consent-documents/biometric/current',
        '/api/v1/students/{id}/biometric-consent',
        // F8 -- inventario de dispositivo e identidade biometrica.
        '/api/v1/devices',
        '/api/v1/devices/{id}',
        '/api/v1/students/{studentId}/biometric-identities',
        '/api/v1/students/{studentId}/biometric-identities/upload',
        '/api/v1/students/{studentId}/biometric-identities/{identityId}',
        // F8 -- rota de Edge, autenticada por assinatura HMAC (nao por cookie).
        '/api/v1/edge/heartbeat',
        '/api/v1/edge/commands',
        '/api/v1/edge/commands/{id}/lease',
        '/api/v1/edge/sync-results/batch',
        // F8 -- painel de pendencia, rota de operacao (cookie + permissao).
        '/api/v1/device-sync-jobs',
        // F9 -- decisao online e desfecho da passagem, rotas de Edge assinadas.
        '/api/v1/edge/access-decisions',
        '/api/v1/edge/access-events/{id}/passage',
        // F9 -- liberacao manual, rota de operacao (cookie + permissao).
        '/api/v1/access/manual-overrides',
        // F11 -- painel operacional.
        '/api/v1/operations/overview',
        '/api/v1/operations/alerts',
        '/api/v1/operations/alerts/{id}/acknowledge',
        // F11 -- consulta e exportacao de eventos.
        '/api/v1/access-events',
        '/api/v1/access-events/{id}',
        '/api/v1/access-events/exports',
        '/api/v1/exports/{id}',
        '/api/v1/exports/{id}/cancel',
        '/api/v1/exports/{id}/download',
        // F12 e F13 -- invoice, pagamento manual, PIX e webhook.
        // NAO ESTAVAM AQUI: a lista parou na F11, e as duas fatias entregaram
        // rota sem declara-la. O snapshot pegava a mudanca, esta lista nao --
        // ela e a que diz, em prosa, o que a fatia PROMETEU publicar.
        // F53 -- task 6: GET adicionado ao mesmo path para a lista
        // transversal de faturas do tenant (POST ja existia, F12).
        '/api/v1/invoices',
        '/api/v1/invoices/{id}',
        '/api/v1/invoices/{id}/manual-payment',
        '/api/v1/invoices/{id}/payments/pix',
        '/api/v1/payments/{id}/status',
        '/api/v1/students/{id}/invoices',
        // F53 -- task 5: leitura barata para o laco de polling do balcao.
        '/api/v1/payment-attempts/{id}',
        '/api/v1/webhooks/payments/{provider}',
        // F14 -- cartao e recorrencia.
        '/api/v1/payment-methods',
        '/api/v1/invoices/{id}/payments/card',
        '/api/v1/subscriptions/{id}/recurrence/cancel',
        // F53 -- task 16: checkout hospedado de cartao (primeira cobranca,
        // sem token salvo). Coexiste com a rota tokenizada acima.
        '/api/v1/invoices/{id}/payments/card-checkout',
        // F15 -- inadimplencia e acesso.
        '/api/v1/billing/delinquency',
        '/api/v1/billing/delinquency/apply',
        '/api/v1/billing/financial-overrides',
        '/api/v1/billing/financial-overrides/{id}/revoke',
        // F16 -- estorno, conciliacao e recibo.
        '/api/v1/payments/{id}/refunds',
        '/api/v1/refunds/{id}/observe',
        '/api/v1/payments/{id}/receipt',
        '/api/v1/receipts/{id}',
        '/api/v1/reconciliation/runs',
        '/api/v1/reconciliation/items',
        '/api/v1/reconciliation/items/{id}/resolve',
        // F17 -- avaliacao fisica manual e contexto de saude.
        '/api/v1/students/{id}/assessments',
        '/api/v1/assessments/{id}',
        '/api/v1/assessments/{id}/draft',
        '/api/v1/assessments/{id}/publish',
        '/api/v1/assessments/{id}/corrections',
        '/api/v1/students/{id}/health-context',
        '/api/v1/students/{id}/health-context/{factor}',
        // F50 -- configuracao do totem (painel, sessao de gerente).
        '/api/v1/admin/kiosk-devices',
        '/api/v1/admin/kiosk-devices/{id}/config',
        '/api/v1/admin/kiosk-devices/{id}/config/publish',
        '/api/v1/admin/kiosk-devices/{id}/config/draft',
        // F51 -- upload da midia da tela publica (MP4, ADR-042 Decisao 7).
        '/api/v1/admin/kiosk-devices/{id}/media',
      ]),
    );
  });

  /**
   * FIX #163: A GUARDA NAO ENXERGAVA O CORPO.
   *
   * O snapshot compara `paths` inteiro, entao pega rota que some, rota que
   * nasce e parametro que muda. Nao pegava mudanca de FORMA da resposta --
   * porque nenhuma operacao declarava schema (113 de 113), e comparar
   * `{ "description": "" }` com outro `{ "description": "" }` sempre bate.
   * Foi assim que `GET /students/:id/invoices` virou de array para objeto na
   * F53 sem um aviso sequer.
   *
   * O CRITERIO (decisao do PI): exigir schema so das rotas NOVAS. As 113
   * herdadas ficam na allowlist, que so pode encolher.
   */
  it('rota nova declara schema de resposta', () => {
    const semSchema = operacoesSemSchemaDeResposta(documento.paths);
    const perdoadas = new Set(OPERACOES_SEM_SCHEMA_DE_RESPOSTA);

    const novas = semSchema.filter((operacao) => !perdoadas.has(operacao));

    expect(novas).toEqual([]);
  });

  /**
   * A ALLOWLIST NAO PODE MENTIR.
   *
   * Sem esta metade, uma rota que ganhou schema continuaria listada como
   * devedora para sempre, e a lista deixaria de dizer qual e a divida real --
   * viraria a documentacao que envelhece, o defeito que o snapshot existe
   * para impedir. Falhar aqui e trivial de resolver: apagar a linha.
   */
  it('a divida de schema so encolhe', () => {
    const semSchema = new Set(operacoesSemSchemaDeResposta(documento.paths));

    const jaResolvidas = OPERACOES_SEM_SCHEMA_DE_RESPOSTA.filter(
      (operacao) => !semSchema.has(operacao),
    );

    expect(jaResolvidas).toEqual([]);
  });

  it('nao expoe rota fora de /api/v1, health e version', () => {
    // Rota que escapou do prefixo e superficie que ninguem revisou.
    const forasteiras = Object.keys(documento.paths).filter(
      (caminho) =>
        !caminho.startsWith('/api/v1/') && !caminho.startsWith('/health') && caminho !== '/version',
    );

    expect(forasteiras).toEqual([]);
  });
});
