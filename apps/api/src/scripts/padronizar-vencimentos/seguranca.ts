import type { INestApplicationContext } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

/**
 * `createApplicationContext(AppModule)` sobe o `ScheduleModule`: todo
 * `@Cron`/`@Interval`/`@Timeout` (outbox, alertas, inadimplencia...) passaria a
 * escrever no banco durante um dry-run "somente leitura". Para tudo antes da
 * primeira consulta. Devolve quantos agendadores foram parados.
 */
export function silenciarAgendadores(app: Pick<INestApplicationContext, 'get'>): number {
  const registro = app.get(SchedulerRegistry);
  const crons = [...registro.getCronJobs().keys()];
  const intervalos = registro.getIntervals();
  const timeouts = registro.getTimeouts();

  crons.forEach((nome) => registro.deleteCronJob(nome));
  intervalos.forEach((nome) => registro.deleteInterval(nome));
  timeouts.forEach((nome) => registro.deleteTimeout(nome));

  return crons.length + intervalos.length + timeouts.length;
}

/**
 * `host:porta/banco` da URL que o runtime REALMENTE usa -- o `PrismaService`
 * prefere `RUNTIME_DATABASE_URL` e so cai em `DATABASE_URL` se ela for vazia.
 * Nunca devolve usuario, senha nem a URL; `null` = ilegivel. O erro de
 * `new URL()` e descartado de proposito: a mensagem dele vaza a string inteira.
 */
export function rotuloDoBanco(env: Readonly<Record<string, string | undefined>>): string | null {
  const url = env['RUNTIME_DATABASE_URL'] || env['DATABASE_URL'];
  if (!url) return null;

  try {
    const { hostname, port, pathname } = new URL(url);
    const banco = decodeURIComponent(pathname.replace(/^\//, ''));

    return hostname && banco ? `${hostname}:${port || '5432'}/${banco}` : null;
  } catch {
    return null;
  }
}

/** Com `--gravar`, o operador digita o banco que espera atingir; divergiu, nao escreve. */
export function exigirConfirmacaoDoBanco(gravar: boolean, rotulo: string, confirmacao: string | undefined): void {
  if (!gravar || confirmacao === rotulo) return;

  throw new Error(
    `--gravar exige PADRONIZAR_CONFIRMA_BANCO=${rotulo} (banco-alvo atual). ` +
      `Recebido: ${confirmacao ? 'valor diferente' : 'ausente'}. Nada foi feito.`,
  );
}
