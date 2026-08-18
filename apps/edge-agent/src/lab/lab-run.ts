import { type PermissaoLocal } from '../domain/access-decision.js';
import { type EventoReconhecimento } from '../domain/facial-device.js';
import { type SentidoGiro, type TurnstileAdapter } from '../domain/turnstile.js';
import { RastreadorDeRelogio } from '../domain/plausibilidade-de-relogio.js';
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
  /**
   * Nome do leitor, para separar a regua de relogio por dispositivo.
   *
   * A bancada tem um leitor so; o MVP 1 poe dois na mesma unidade, e cada
   * um tem seu proprio relogio. Regua compartilhada faria dois leitores
   * intercalando eventos legitimos marcarem um ao outro como retrocesso.
   */
  nomeDoLeitor?: string;
  /**
   * Avisado quando o horario do equipamento nao merece confianca.
   *
   * Callback em vez de logger direto: a bancada nao decide COMO se loga --
   * o CLI tem `pino`, o teste quer inspecionar. Timestamp errado em silencio
   * foi o que fez o achado de 17/08 aparecer so na analise do relatorio.
   */
  aoDetectarRelogioImplausivel?: (aviso: {
    dispositivo: string;
    razao: string;
    ocorridoEm: Date;
    recebidoEm: Date;
  }) => void;
}

/**
 * A tentativa mais o veredito sobre o relogio do equipamento.
 *
 * Sai daqui, e nao de dentro de `orquestrar-passagem`, porque a ordenacao
 * serve a FILA DE EVENTOS -- nao a decisao de acesso. O motor decide com o
 * `agora` do Edge; o relogio do leitor so influencia em que ordem os
 * eventos sobem para o coletor.
 */
export type TentativaComRelogio = TentativaPassagem & {
  /** Chave de ordenacao. Ausente = o `ocorridoEm` serve, o caso normal. */
  ordenarPor?: Date;
  relogioImplausivel: boolean;
};

export interface BancadaLab {
  processar: (
    evento: EventoReconhecimento,
    correlationId: string,
    agora: Date,
  ) => Promise<TentativaComRelogio>;
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

  // Regua de relogio por dispositivo. Ver `plausibilidade-de-relogio.ts`.
  const relogios = new RastreadorDeRelogio();
  const leitor = deps.nomeDoLeitor ?? 'facial';

  return {
    processar: async (evento, correlationId, agora) => {
      // ANTES de decidir: a chave de ordenacao vale para o evento, e evento
      // NEGADO tambem sobe para o coletor. Avaliar so no ALLOW deixaria
      // metade dos eventos sem chave.
      const relogio = relogios.avaliar(leitor, evento.ocorridoEm, evento.recebidoEm);

      if (relogio.implausivel) {
        // Timestamp errado calado foi o que fez o achado de 17/08 aparecer
        // so na analise do relatorio, e nao na bancada.
        deps.aoDetectarRelogioImplausivel?.({
          dispositivo: leitor,
          razao: relogio.razao ?? 'desconhecida',
          ocorridoEm: evento.ocorridoEm,
          recebidoEm: evento.recebidoEm,
        });
      }

      const r = await processador(evento, correlationId, agora);

      // So a latencia de quem foi ao menos decidido para ALLOW alimenta o
      // M0-NFR-001: o DENY nao mede a cadeia fisica, retorna antes dela.
      if (r.decisao.resultado === 'ALLOW') {
        latenciasColetadas.push(r.latenciaDecisaoMs);
      }

      return {
        ...r,
        relogioImplausivel: relogio.implausivel,
        // Ausente quando o `ocorridoEm` serve: a fila resolve pelo COALESCE
        // e a linha nao carrega copia do que ja esta la.
        ...(relogio.implausivel ? { ordenarPor: relogio.ordenarPor } : {}),
      };
    },
    latencias: () => latenciasColetadas,
  };
}
