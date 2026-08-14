import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { FacialSimulator } from '../adapters/facial-simulator.js';
import { gerarExternalEnrollId } from '../domain/external-enroll-id.js';
import { DeviceUserRepository } from '../persistence/device-user-repository.js';
import {
  cadastrarIdentidade,
  detectarOrfaos,
  removerIdentidade,
} from './sincronizar-identidade.js';

const DISPOSITIVO = 'facial-01';
const AGORA = new Date('2026-08-14T12:00:00.000Z');

describe('ciclo de vida facial', () => {
  let dir: string;
  let repo: DeviceUserRepository;
  let dispositivo: FacialSimulator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-f2-'));
    repo = new DeviceUserRepository(join(dir, 'teste.sqlite'));
    dispositivo = new FacialSimulator();
  });

  afterEach(() => {
    repo.fechar();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * O ACEITE DA SLICE 0.2, palavra por palavra: "criar, reconhecer e remover
   * tres identidades de teste sem colisao e sem deixar dado orfao no
   * dispositivo".
   *
   * Roda contra o simulador -- `M0-NFR-006` exige CI sem hardware. Na bancada,
   * o mesmo caminho roda contra o TopdataFacialAdapter.
   */
  it('cria, reconhece e remove tres identidades sem colisao nem orfao', async () => {
    const pessoas = ['pessoa-a', 'pessoa-b', 'pessoa-c'];
    const ids = pessoas.map(() => gerarExternalEnrollId());

    // sem colisao: tres identificadores distintos
    expect(new Set(ids).size).toBe(3);

    for (const [i, pessoaId] of pessoas.entries()) {
      const r = await cadastrarIdentidade(
        { repo, dispositivo },
        {
          pessoaId,
          externalEnrollId: ids[i]!,
          dispositivoId: DISPOSITIVO,
          rotulo: `teste-${i}`,
        },
        AGORA,
      );
      expect(r.ok).toBe(true);
    }

    expect(await dispositivo.listar()).toHaveLength(3);

    // reconhecer: o evento chega com o id que cadastramos
    const recebidos: string[] = [];
    dispositivo.aoReconhecer((e) => recebidos.push(e.externalEnrollId));
    for (const id of ids) dispositivo.simularReconhecimento(id, AGORA);
    expect(recebidos).toEqual(ids);

    // remover os tres
    for (const pessoaId of pessoas) {
      const r = await removerIdentidade({ repo, dispositivo }, { pessoaId, dispositivoId: DISPOSITIVO }, AGORA);
      expect(r.ok).toBe(true);
    }

    // sem dado orfao: nem no dispositivo, nem como esperado localmente
    expect(await dispositivo.listar()).toHaveLength(0);
    expect(await detectarOrfaos({ repo, dispositivo }, DISPOSITIVO)).toEqual([]);
  });

  it('registra a intencao ANTES de mandar, para falha nao virar orfao', async () => {
    // Se mandassemos primeiro, morrer no meio deixaria dado no dispositivo
    // que ninguem sabe que existe.
    dispositivo.programarFalha('cadastrar', 'dispositivo fora do ar');

    const pessoaId = 'pessoa-a';
    const r = await cadastrarIdentidade(
      { repo, dispositivo },
      { pessoaId, externalEnrollId: gerarExternalEnrollId(), dispositivoId: DISPOSITIVO, rotulo: 't' },
      AGORA,
    );

    expect(r.ok).toBe(false);
    // O registro local existe e sabe que falhou -- e o que a reconciliacao
    // usa para retentar.
    expect(repo.buscar(pessoaId, DISPOSITIVO)?.estado).toBe('falha');
    expect(repo.listarPendentes(DISPOSITIVO)).toHaveLength(1);
  });

  it('remover quem nao existe e sucesso, nao erro', async () => {
    // Regra de arquitetura no 4: reprocessar tem de ser seguro. O estado
    // desejado -- ausencia -- ja vale.
    const r = await removerIdentidade(
      { repo, dispositivo },
      { pessoaId: 'nunca-cadastrada', dispositivoId: DISPOSITIVO },
      AGORA,
    );

    expect(r.ok).toBe(true);
  });

  it('cadastrar duas vezes nao duplica no dispositivo', async () => {
    const entrada = {
      pessoaId: 'pessoa-a',
      externalEnrollId: gerarExternalEnrollId(),
      dispositivoId: DISPOSITIVO,
      rotulo: 't',
    };

    await cadastrarIdentidade({ repo, dispositivo }, entrada, AGORA);
    await cadastrarIdentidade({ repo, dispositivo }, entrada, AGORA);

    expect(await dispositivo.listar()).toHaveLength(1);
  });

  it('detecta identidade que existe no dispositivo e nao aqui', async () => {
    // Cenario real: o software de fabrica cadastrou alguem, ou uma remocao
    // falhou pela metade.
    const intruso = gerarExternalEnrollId();
    await dispositivo.cadastrar({ externalEnrollId: intruso, rotulo: 'nao-nosso' });

    expect(await detectarOrfaos({ repo, dispositivo }, DISPOSITIVO)).toEqual([intruso]);
  });
});
