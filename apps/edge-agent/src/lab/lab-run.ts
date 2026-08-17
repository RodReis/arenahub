import { type PermissaoLocal } from '../domain/access-decision.js';
import { type EventoReconhecimento } from '../domain/facial-device.js';
import { type SentidoGiro, type TurnstileAdapter } from '../domain/turnstile.js';
import {
  criarProcessadorDePassagem,
  type TentativaPassagem,
} from '../application/orquestrar-passagem.js';

/**
 * Bancada do `lab:run` -- MVP 0, cadeia FISICA com decisao LOCAL.
 *
 * Liga o reconhecimento facial ao acionamento da catraca pelo caminho da
 * Slice 0.3 (`orquestrar-passagem`), coletando a latencia rosto -> comando
 * (`M0-NFR-001`). A decisao e local de proposito: o gate do MVP 0 quer provar
 * que o FIO FISICO funciona, sem depender da nuvem (isso e F9, MVP 1).
 *
 * Esta funcao NAO fala com hardware: recebe o adapter da catraca pronto. Quem
 * sobe a ponte e o servidor facial e o CLI (`lab-run-cli.ts`). Assim a
 * orquestracao roda no CI com fakes, e so o wiring de I/O espera a bancada.
 */

export interface DepsBancadaLab {
  catraca: TurnstileAdapter;
  /** enrollids que a bancada conhece -- seed local, sem banco. */
  permitidos: readonly string[];
  agoraMonotonicoMs: () => number;
  /** Sentido do giro. Default `entrada`. Ver DepsPassagem.sentido. */
  sentido?: SentidoGiro;
}

export interface BancadaLab {
  processar: (
    evento: EventoReconhecimento,
    correlationId: string,
    agora: Date,
  ) => Promise<TentativaPassagem>;
  /** Latencias de decisao coletadas, para `resumirLatencia`. */
  latencias: () => readonly number[];
}

export function criarBancadaLab(deps: DepsBancadaLab): BancadaLab {
  // Estado local da bancada: as permissoes conhecidas e o ultimo ALLOW de
  // cada uma (a janela anti-repique precisa dele). Sem banco -- e uma POC.
  const permissoes = new Map<string, PermissaoLocal>();
  for (const enrollid of deps.permitidos) {
    permissoes.set(enrollid, { externalEnrollId: enrollid });
  }

  const latenciasColetadas: number[] = [];

  const processador = criarProcessadorDePassagem({
    catraca: deps.catraca,
    buscarPermissao: (externalEnrollId) => permissoes.get(externalEnrollId) ?? null,
    registrarAllow: (externalEnrollId, em) => {
      const p = permissoes.get(externalEnrollId);
      if (p) permissoes.set(externalEnrollId, { ...p, ultimoAllowEm: em });
    },
    agoraMonotonicoMs: deps.agoraMonotonicoMs,
    sentido: deps.sentido ?? 'entrada',
  });

  return {
    processar: async (evento, correlationId, agora) => {
      const r = await processador(evento, correlationId, agora);
      // So a latencia de quem foi ao menos decidido para ALLOW alimenta o
      // M0-NFR-001: o DENY nao mede a cadeia fisica, retorna antes dela.
      if (r.decisao.resultado === 'ALLOW') {
        latenciasColetadas.push(r.latenciaDecisaoMs);
      }
      return r;
    },
    latencias: () => latenciasColetadas,
  };
}
