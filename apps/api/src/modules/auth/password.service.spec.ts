import { describe, expect, it } from '@jest/globals';

import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const servico = new PasswordService();

  it('gera envelope versionado com sal e hash', async () => {
    const envelope = await servico.gerarHash('senha-correta-horse-battery');

    // O envelope carrega os parametros usados. Sem isso, subir o custo de
    // derivacao no futuro invalidaria toda senha ja gravada -- com isso, a
    // senha antiga continua conferindo e migra na proxima troca.
    expect(envelope).toMatch(/^scrypt\$v=1\$N=16384\$r=8\$p=1\$[\w-]+\$[\w-]+$/);
  });

  it('gera sal diferente a cada chamada', async () => {
    const [um, outro] = await Promise.all([
      servico.gerarHash('mesma-senha'),
      servico.gerarHash('mesma-senha'),
    ]);

    // Sal fixo faria senhas iguais produzirem hash igual, entregando de
    // graca quem compartilha senha com quem.
    expect(um).not.toBe(outro);
  });

  it('confere a senha correta', async () => {
    const envelope = await servico.gerarHash('senha-correta-horse-battery');

    await expect(servico.conferir('senha-correta-horse-battery', envelope)).resolves.toBe(true);
  });

  it('recusa a senha errada', async () => {
    const envelope = await servico.gerarHash('senha-correta-horse-battery');

    await expect(servico.conferir('senha-errada', envelope)).resolves.toBe(false);
  });

  it('devolve false para envelope invalido, sem lancar', async () => {
    // Registro corrompido no banco nao pode derrubar o login com stack
    // trace: vira "senha invalida", que e o que o usuario ve de qualquer
    // forma, e o operador investiga pelo log.
    for (const invalido of ['', 'nao-e-envelope', 'scrypt$v=1$faltando-campos', 'bcrypt$x$y']) {
      await expect(servico.conferir('qualquer', invalido)).resolves.toBe(false);
    }
  });

  it('recusa envelope de algoritmo diferente', async () => {
    await expect(
      servico.conferir('qualquer', 'argon2$v=1$N=16384$r=8$p=1$c2FsdA$aGFzaA'),
    ).resolves.toBe(false);
  });
});
