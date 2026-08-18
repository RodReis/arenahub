import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

/**
 * REGRA DE ARQUITETURA No 1, aplicada a `students.gym_unit_id` (F45).
 *
 * A F45 deu unidade ao aluno. `gym_unit_id` e a unidade de ORIGEM -- onde a
 * pessoa se cadastrou e para onde a recepcao a conta. NAO e direito de
 * entrar: quem decide em qual unidade o aluno acessa continua sendo o plano,
 * por `PlanUnit` e `EntitlementUnitWindow`.
 *
 * POR QUE ESTE TESTE E ESTRUTURAL, e nao um caso de uso montando cenario:
 * o defeito que ele previne nao e "a decisao saiu errada" -- e "alguem
 * acrescentou `gymUnitId` ao `select` e a decisao passou a considera-lo".
 * Um teste de comportamento so pegaria isso se o cenario ja tivesse aluno
 * cuja unidade de origem diverge do plano, que e precisamente o caso que
 * ninguem lembra de escrever. Ler o codigo-fonte pega o dia em que a linha
 * for adicionada, e nao o dia em que ela causar dano.
 *
 * QUANDO ESTE TESTE FALHAR, a correcao quase nunca e edita-lo: e tirar a
 * leitura de `gymUnitId` do modulo de acesso. Se a leitura for mesmo
 * necessaria, ela exige ADR novo aprovado pelo PI (`CLAUDE.md`, Regras de
 * arquitetura) -- e ai sim a excecao entra aqui, nomeada e justificada.
 */

const PASTA_DO_ACESSO = join(dirname(fileURLToPath(import.meta.url)));

/** Arquivos de producao do modulo de acesso -- os `.spec.ts` ficam de fora. */
function arquivosDeProducao(): string[] {
  return readdirSync(PASTA_DO_ACESSO)
    .filter((nome) => nome.endsWith('.ts') && !nome.endsWith('.spec.ts'))
    .map((nome) => join(PASTA_DO_ACESSO, nome));
}

describe('students.gym_unit_id nao participa da decisao de acesso', () => {
  it('o modulo de acesso existe e tem arquivos a inspecionar', () => {
    // Sem esta assercao, uma pasta renomeada faria os testes abaixo passarem
    // por vacuidade -- verde por nao ter olhado nada.
    expect(arquivosDeProducao().length).toBeGreaterThan(0);
  });

  it.each(arquivosDeProducao())('%s nao seleciona gymUnitId de student', (caminho) => {
    const fonte = readFileSync(caminho, 'utf8');

    // `student: { select: { ... } }` -- o que o acesso le do aluno. Hoje e
    // `status` (INV-033) e, no override manual, `id` para existencia.
    const selecoesDeAluno = [...fonte.matchAll(/student:\s*\{\s*select:\s*\{([^}]*)\}/g)].map(
      (achado) => achado[1] ?? '',
    );

    for (const selecao of selecoesDeAluno) {
      expect(selecao).not.toMatch(/gymUnitId/);
    }
  });

  it.each(arquivosDeProducao())('%s nao filtra aluno por unidade', (caminho) => {
    const fonte = readFileSync(caminho, 'utf8');

    // `db.student.findX({ where: { ... gymUnitId ... } })` seria pior que
    // selecionar: filtrar por unidade de origem NEGARIA acesso a quem tem
    // plano multiunidade valido -- exatamente o aluno que a regra no 1
    // protege.
    const consultasDeAluno = [...fonte.matchAll(/\.student\.find\w*\(\{([\s\S]{0,400}?)\}\)/g)].map(
      (achado) => achado[1] ?? '',
    );

    for (const consulta of consultasDeAluno) {
      expect(consulta).not.toMatch(/gymUnitId/);
    }
  });
});
