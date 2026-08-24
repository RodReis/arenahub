import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `chamarApi` e `server-only` e o `revalidatePath` exige contexto de request.
 * Os dois viram mock -- o que este teste verifica e a ORQUESTRACAO da troca
 * de plano, nao o transporte HTTP nem o cache do Next.
 */
vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { atribuirPlano } from './membership';

/*
 * UUIDs VALIDOS: o digito de versao (13o) e a variante (17o) nao sao livres.
 * `2222-2222-2222-...` e recusado pelo `z.string().uuid()` da propria Server
 * Action, e o teste morreria na validacao sem nunca chegar na orquestracao
 * que ele existe para verificar.
 */
const ALUNO = '11111111-1111-4111-8111-111111111111';
const PLANO = '22222222-2222-4222-8222-222222222222';
const ASSINATURA_ANTIGA = '33333333-3333-4333-8333-333333333333';

function formulario(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('studentId', ALUNO);
  dados.set('planId', PLANO);
  dados.set('startsAt', '2026-09-01T08:00');
  dados.set('endsAt', '2026-12-01T08:00');
  dados.set('reason', 'Aluno pediu upgrade do plano');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

/** Resposta de sucesso da criacao de assinatura. */
function assinaturaCriada() {
  return {
    ok: true,
    dados: { subscriptionId: 'nova', entitlement: { id: 'ent-novo' } },
    cookiesDaApi: [],
  };
}

describe('atribuirPlano', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('sem assinatura vigente, apenas cria -- nao tenta cancelar nada', async () => {
    vi.mocked(chamarApi).mockResolvedValue(assinaturaCriada());

    const estado = await atribuirPlano({}, formulario());

    expect(estado.sucesso).toBeDefined();
    expect(vi.mocked(chamarApi)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe('/api/v1/subscriptions');
  });

  /**
   * O CORACAO DESTA FATIA.
   *
   * `POST /subscriptions` CRIA, nao substitui. Sem o cancelamento antes, o
   * aluno fica com duas assinaturas e dois entitlements ACTIVE: a lista
   * mostra o plano novo (le a assinatura mais recente) e a catraca continua
   * honrando o antigo pela uniao das janelas. A tela mente e o acesso nao
   * muda.
   */
  it('com assinatura vigente, CANCELA a anterior ANTES de criar a nova', async () => {
    vi.mocked(chamarApi)
      .mockResolvedValueOnce({
        ok: true,
        dados: { id: ASSINATURA_ANTIGA, status: 'CANCELLED' },
        cookiesDaApi: [],
      })
      .mockResolvedValueOnce(assinaturaCriada());

    const estado = await atribuirPlano(
      {},
      formulario({ substituiSubscriptionId: ASSINATURA_ANTIGA, substituiVersion: '4' }),
    );

    expect(estado.sucesso).toBeDefined();

    const chamadas = vi.mocked(chamarApi).mock.calls;
    expect(chamadas).toHaveLength(2);

    // ORDEM: cancelamento primeiro, criacao depois.
    expect(chamadas[0]?.[0]).toBe(`/api/v1/subscriptions/${ASSINATURA_ANTIGA}/actions`);
    expect(chamadas[0]?.[1]).toMatchObject({
      corpo: { action: 'CANCEL', version: 4 },
    });
    expect(chamadas[1]?.[0]).toBe('/api/v1/subscriptions');
  });

  /**
   * Cancelamento falhou: NAO cria a nova.
   *
   * Criar assim mesmo deixaria o aluno com o plano antigo vivo E um novo por
   * cima -- o estado exato que a troca existe para evitar, alcancado por um
   * caminho de erro.
   */
  it('nao cria a nova assinatura quando o cancelamento falha', async () => {
    vi.mocked(chamarApi).mockResolvedValueOnce({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Conflito de versao',
        status: 409,
        code: 'SUBSCRIPTION_VERSION_CONFLICT',
        correlationId: 'teste',
      },
      cookiesDaApi: [],
    });

    const estado = await atribuirPlano(
      {},
      formulario({ substituiSubscriptionId: ASSINATURA_ANTIGA, substituiVersion: '4' }),
    );

    expect(estado.sucesso).toBeUndefined();
    expect(estado.erro).toContain('Alguém alterou esta assinatura');
    // UMA chamada: a criacao nunca aconteceu.
    expect(vi.mocked(chamarApi)).toHaveBeenCalledTimes(1);
  });

  /**
   * Id sem versao e erro de montagem da tela, nao entrada da recepcao.
   * Seguir em frente criaria o segundo plano sem cancelar o primeiro.
   */
  it('recusa a troca quando veio o id da assinatura sem a versao', async () => {
    vi.mocked(chamarApi).mockResolvedValue(assinaturaCriada());

    const estado = await atribuirPlano(
      {},
      formulario({ substituiSubscriptionId: ASSINATURA_ANTIGA }),
    );

    expect(estado.sucesso).toBeUndefined();
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });

  it('preserva o preenchimento quando a validacao falha', async () => {
    const estado = await atribuirPlano({}, formulario({ reason: 'ok' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.valores?.planId).toBe(PLANO);
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });
});
