import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { alunoRecebeAcessoNormal, type StatusDeAluno } from '../../students/domain/student.js';
import {
  direitoEhEfetivo,
  montarSnapshotDePolitica,
  type DireitoDeAcesso,
  type StatusDeEntitlement,
} from './entitlement.js';
import { instanteDentroDaJanela, interseccaoDeJanelas, type JanelaDeAcesso } from './plan.js';

/**
 * Propriedades dos invariantes de entitlement.
 *
 * POR QUE PROPRIEDADE E NAO EXEMPLO: os testes de exemplo em
 * `entitlement.spec.ts` provam os casos que EU pensei. Estes provam os casos
 * que eu nao pensei -- o fast-check gera centenas de combinacoes de status,
 * data, unidade e janela, e encolhe qualquer contraexemplo ate a forma
 * minima.
 *
 * As cinco propriedades vem do plano de apoio (Task 7 passo 1) e mapeiam
 * direto para os invariantes do `docs/CONVENTION.md`.
 */

const UNIDADES = ['unidade-a', 'unidade-b', 'unidade-c'];
const SP = 'America/Sao_Paulo';

const TODOS_STATUS_DE_ALUNO: StatusDeAluno[] = [
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
];

const TODOS_STATUS_DE_ENTITLEMENT: StatusDeEntitlement[] = [
  'SCHEDULED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
];

/** Instante dentro de uma faixa plausivel de operacao (2026-2027). */
const instante = fc
  .integer({
    min: Date.UTC(2026, 0, 1) / 1000,
    max: Date.UTC(2027, 11, 31) / 1000,
  })
  .map((segundos) => new Date(segundos * 1000));

/** Janela valida: inicio < fim, dentro de um dia. */
const janela: fc.Arbitrary<JanelaDeAcesso> = fc
  .record({
    gymUnitId: fc.constantFrom(...UNIDADES),
    dayOfWeek: fc.integer({ min: 1, max: 7 }),
    startMinute: fc.integer({ min: 0, max: 1439 }),
    duracao: fc.integer({ min: 1, max: 1440 }),
  })
  .map(({ gymUnitId, dayOfWeek, startMinute, duracao }) => ({
    gymUnitId,
    dayOfWeek,
    startMinute,
    endMinute: Math.min(startMinute + duracao, 1440),
  }))
  .filter((j) => j.endMinute > j.startMinute);

const direito: fc.Arbitrary<DireitoDeAcesso> = fc
  .record({
    status: fc.constantFrom(...TODOS_STATUS_DE_ENTITLEMENT),
    inicio: instante,
    duracaoDias: fc.integer({ min: 1, max: 400 }),
    janelas: fc.array(janela, { minLength: 0, maxLength: 8 }),
  })
  .map(({ status, inicio, duracaoDias, janelas }) => ({
    status,
    startsAt: inicio,
    endsAt: new Date(inicio.getTime() + duracaoDias * 24 * 60 * 60 * 1000),
    janelas,
  }));

describe('propriedades do entitlement', () => {
  /**
   * INV-035: entitlement expirado NUNCA retorna ALLOW.
   *
   * A propriedade e mais forte que o teste de exemplo: vale para qualquer
   * status (inclusive `ACTIVE`, o caso do job de expiracao atrasado),
   * qualquer aluno elegivel, qualquer unidade e qualquer janela.
   */
  it('direito vencido nunca e efetivo, seja qual for o status gravado', () => {
    fc.assert(
      fc.property(
        direito,
        fc.constantFrom(...TODOS_STATUS_DE_ALUNO),
        fc.constantFrom(...UNIDADES),
        fc.integer({ min: 1, max: 10_000 }),
        (base, statusDoAluno, unidade, minutosDepois) => {
          const depoisDoFim = new Date(base.endsAt.getTime() + minutosDepois * 60_000);
          const resultado = direitoEhEfetivo(base, statusDoAluno, unidade, SP, depoisDoFim);

          expect(resultado.efetivo).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  /** INV-033 e `M1-BR-002`: aluno inelegivel nunca recebe acesso normal. */
  it('aluno BLOCKED, CANCELLED ou ARCHIVED nunca e efetivo', () => {
    fc.assert(
      fc.property(
        direito,
        fc.constantFrom<StatusDeAluno>('BLOCKED', 'CANCELLED', 'ARCHIVED'),
        fc.constantFrom(...UNIDADES),
        instante,
        (base, statusDoAluno, unidade, agora) => {
          const resultado = direitoEhEfetivo(base, statusDoAluno, unidade, SP, agora);

          expect(resultado).toEqual({ efetivo: false, motivo: 'STUDENT_NOT_ELIGIBLE' });
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * A unidade efetiva esta SEMPRE presente no snapshot do entitlement.
   *
   * Contrapositiva: se o direito e efetivo, entao a unidade consultada tem
   * janela no snapshot. Impede que uma unidade nao listada passe por
   * qualquer caminho.
   */
  it('unidade efetiva esta sempre no snapshot do direito', () => {
    fc.assert(
      fc.property(
        direito,
        fc.constantFrom(...TODOS_STATUS_DE_ALUNO),
        fc.constantFrom(...UNIDADES),
        instante,
        (base, statusDoAluno, unidade, agora) => {
          const resultado = direitoEhEfetivo(base, statusDoAluno, unidade, SP, agora);

          if (resultado.efetivo) {
            expect(base.janelas.some((j) => j.gymUnitId === unidade)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * INV-034 e `M1-BR-006`: a regra mais restritiva prevalece.
   *
   * A interseccao de duas janelas nunca permite um instante que qualquer uma
   * delas negasse. Provado sobre o instante, nao so sobre os numeros.
   */
  it('interseccao de janelas nunca permite o que uma das partes nega', () => {
    fc.assert(
      fc.property(
        fc.array(janela, { minLength: 1, maxLength: 5 }),
        fc.array(janela, { minLength: 1, maxLength: 5 }),
        fc.constantFrom(...UNIDADES),
        instante,
        (a, b, unidade, agora) => {
          const restritiva = interseccaoDeJanelas(a, b);

          if (instanteDentroDaJanela(agora, SP, unidade, restritiva)) {
            expect(instanteDentroDaJanela(agora, SP, unidade, a)).toBe(true);
            expect(instanteDentroDaJanela(agora, SP, unidade, b)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * O snapshot e a unica fonte da decisao -- mutacao no plano nao a alcanca.
   *
   * Prova estrutural: `montarSnapshotDePolitica` copia as janelas, e
   * `direitoEhEfetivo` so le `direito.janelas`. Alterar o array original
   * depois de montado nao muda a resposta.
   */
  it('mutar o plano depois da derivacao nao altera a decisao', () => {
    fc.assert(
      fc.property(
        fc.array(janela, { minLength: 1, maxLength: 5 }),
        fc.constantFrom(...UNIDADES),
        instante,
        (janelasDoPlano, unidade, agora) => {
          const snapshot = montarSnapshotDePolitica('p', 'Plano', UNIDADES, [
            ...janelasDoPlano,
          ]);

          const base: DireitoDeAcesso = {
            status: 'ACTIVE',
            startsAt: new Date(agora.getTime() - 86_400_000),
            endsAt: new Date(agora.getTime() + 86_400_000),
            janelas: snapshot.janelas,
          };

          const antes = direitoEhEfetivo(base, 'ACTIVE', unidade, SP, agora);

          // O "plano" muda: janelas apagadas na fonte original.
          janelasDoPlano.length = 0;

          const depois = direitoEhEfetivo(base, 'ACTIVE', unidade, SP, agora);

          expect(depois).toEqual(antes);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * Coerencia entre as duas portas de INV-033: o que
   * `alunoRecebeAcessoNormal` nega, `direitoEhEfetivo` tambem nega. Duas
   * implementacoes da mesma regra divergindo e como o invariante morre em
   * silencio.
   */
  it('concorda com alunoRecebeAcessoNormal para todo status de aluno', () => {
    fc.assert(
      fc.property(
        direito,
        fc.constantFrom(...TODOS_STATUS_DE_ALUNO),
        fc.constantFrom(...UNIDADES),
        instante,
        (base, statusDoAluno, unidade, agora) => {
          const resultado = direitoEhEfetivo(base, statusDoAluno, unidade, SP, agora);

          if (!alunoRecebeAcessoNormal(statusDoAluno)) {
            expect(resultado.efetivo).toBe(false);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
