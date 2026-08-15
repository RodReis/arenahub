import { Injectable } from '@nestjs/common';

/**
 * Responde uma pergunta so: o banco atende agora?
 *
 * Isolado num provider porque readiness precisa ser substituivel em teste sem
 * subir Postgres, e porque a Task 2 troca a consulta por Prisma sem tocar no
 * controller.
 *
 * Hoje a checagem e honesta sobre o que ainda nao existe: enquanto nao ha
 * cliente de banco no workspace, a API nao tem como afirmar que esta pronta
 * para receber trafego que dependa de dados. Responder `ready` aqui seria a
 * mesma mentira que o guarda do `run-task.mjs` (#44) impede nos comandos --
 * verde sem verificacao.
 */
@Injectable()
export class VerificadorDeBanco {
  verificar(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
