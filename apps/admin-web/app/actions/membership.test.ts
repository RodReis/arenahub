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
import { revalidatePath } from 'next/cache';

import { atribuirPlano, definirCredencial, venderDiaria } from './membership';

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
   * Uma chamada so, atomica (F82): POST /subscriptions/:id/trocar-plano
   * substitui as duas chamadas sequenciais (CANCEL depois POST) que existiam
   * aqui. A troca acontece numa transacao so no backend, entao nao ha mais
   * janela em que o aluno fique com duas assinaturas ativas nem sem nenhuma.
   */
  it('com assinatura vigente, chama a rota de troca -- nao cancela e cria em duas chamadas', async () => {
    // A troca vale no ato; nao ha direito novo a devolver, so as parcelas.
    vi.mocked(chamarApi).mockResolvedValueOnce({
      ok: true,
      dados: {
        subscriptionId: ASSINATURA_ANTIGA,
        planId: PLANO,
        effectiveFrom: '2026-10-06T12:00:00.000Z',
        parcelasReabertas: 1,
      },
      cookiesDaApi: [],
    });

    const estado = await atribuirPlano(
      {},
      formulario({ substituiSubscriptionId: ASSINATURA_ANTIGA, substituiVersion: '4' }),
    );

    expect(estado.sucesso).toEqual({
      subscriptionId: ASSINATURA_ANTIGA,
      parcelasReabertas: 1,
    });

    const chamadas = vi.mocked(chamarApi).mock.calls;
    expect(chamadas).toHaveLength(1);

    expect(chamadas[0]?.[0]).toBe(`/api/v1/subscriptions/${ASSINATURA_ANTIGA}/trocar-plano-agora`);
    expect(chamadas[0]?.[1]).toMatchObject({
      corpo: { planId: PLANO, version: 4, reason: 'Aluno pediu upgrade do plano' },
    });
  });

  /**
   * A troca falhou (ex.: conflito de versao): nada foi criado nem encerrado.
   *
   * A rota e atomica -- uma unica chamada, e se ela recusa, nao ha segunda
   * chamada de criacao para desfazer nem plano antigo para reativar.
   */
  it('nao cria assinatura quando a troca falha', async () => {
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
    // UMA chamada: a rota atomica recusou e nao ha segunda chamada.
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

describe('definirCredencial', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  function credencial(kind: string, externalId: string): FormData {
    const dados = new FormData();
    dados.set('studentId', ALUNO);
    dados.set('kind', kind);
    dados.set('externalId', externalId);
    return dados;
  }

  it('facial vai pela rota do numero da catraca, que vincula ao leitor na hora', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { externalId: '100000000123', linkedReaders: 1 },
      cookiesDaApi: [],
    });

    const r = await definirCredencial({}, credencial('FACIAL_ENROLL_ID', '100000000123'));

    expect(chamarApi).toHaveBeenCalledWith(`/api/v1/students/${ALUNO}/turnstile-number`, {
      metodo: 'POST',
      corpo: { externalId: '100000000123' },
    });
    expect(r).toEqual({ sucesso: { kind: 'FACIAL_ENROLL_ID', externalId: '100000000123' } });
  });

  it('cartao continua no PUT de credenciais', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { kind: 'TURNSTILE_CARD', externalId: 'ABC-9' },
      cookiesDaApi: [],
    });

    await definirCredencial({}, credencial('TURNSTILE_CARD', 'ABC-9'));

    expect(chamarApi).toHaveBeenCalledWith(`/api/v1/students/${ALUNO}/credentials`, {
      metodo: 'PUT',
      corpo: { kind: 'TURNSTILE_CARD', externalId: 'ABC-9' },
    });
  });

  it('facial fora de 1-12 digitos nem chega na API', async () => {
    const r = await definirCredencial({}, credencial('FACIAL_ENROLL_ID', '12a'));

    expect(r.erro).toBe('O identificador facial tem de 1 a 12 dígitos.');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('409 da rota nova vira frase de numero ocupado', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'Conflict', status: 409, code: 'CREDENTIAL_ALREADY_ASSIGNED', correlationId: '' },
      cookiesDaApi: [],
    });

    const r = await definirCredencial({}, credencial('FACIAL_ENROLL_ID', '100000000001'));

    expect(r.erro).toBe('Este número já está vinculado a outro aluno.');
  });
});

describe('venderDiaria', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  const entrada = {
    studentId: ALUNO,
    planId: PLANO,
    channel: 'DINHEIRO' as const,
    expectedTotalMinor: 3000,
  };

  it('depois da venda atualiza a ficha E a Cobranca do aluno', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { paymentId: 'pay-1', endsAt: '2026-10-08T03:00:00.000Z' },
      cookiesDaApi: [],
    });

    const r = await venderDiaria(entrada);

    expect(r).toEqual({ ok: true, paymentId: 'pay-1', endsAt: '2026-10-08T03:00:00.000Z' });
    expect(revalidatePath).toHaveBeenCalledWith(`/students/${ALUNO}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/students/${ALUNO}/billing`);
  });

  it('venda recusada nao revalida nada', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'Conflito', status: 409, code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION', correlationId: 'c' },
      cookiesDaApi: [],
    });

    const r = await venderDiaria(entrada);

    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
