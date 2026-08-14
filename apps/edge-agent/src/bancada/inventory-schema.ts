import { z } from 'zod';

/**
 * Schema do inventario da bancada (gate de entrada do MVP 0, PRD §4).
 *
 * Campo desconhecido e `null`, NUNCA palpite. O PRD e explicito: "nao se
 * substitui hardware real por suposicao". Por isso quase tudo aceita null --
 * o schema garante que o campo EXISTE e foi considerado, nao que alguem
 * inventou um valor para ele.
 */

const naoLido = z.null();

/** Item de gate: cumprido, nao cumprido, ou cumprido em parte. */
const estadoDeGate = z.union([z.boolean(), z.literal('parcial')]);

export const esquemaDispositivo = z.object({
  id: z.string().min(1),
  tipo: z.enum(['catraca', 'leitor-facial', 'outro']),
  fabricante: z.string().min(1),
  modelo: z.string().min(1).or(naoLido),
  numeroSerie: z.string().min(1).or(naoLido),
  firmware: z.string().min(1).or(naoLido),

  // Catraca
  numeroInner: z.number().int().positive().optional(),
  descricaoNoSoftware: z.string().optional(),
  tipoDeCatraca: z.enum(['padrao', 'easy']).optional(),
  modoOperacao: z.string().optional(),
  instaladaA: z.enum(['esquerda', 'direita']).optional(),
  entradas: z
    .object({
      teclado: z.boolean(),
      cartao: z.boolean(),
      // No Topdata, "biometria" e digital -- o facial e equipamento
      // separado. Confundir os dois faz o inventario mentir.
      biometriaDigital: z.boolean(),
      leitorFacial: z.boolean(),
    })
    .optional(),

  // Leitor facial
  identificador: z.string().min(1).optional(),
  vinculadoA: z.string().min(1).optional(),
  rede: z
    .object({
      ip: z.union([z.ipv4(), naoLido]),
      obtencao: z.enum(['dhcp', 'fixo']).or(naoLido),
    })
    .optional(),
});

export const esquemaInventario = z.object({
  versao: z.literal(1),
  atualizadoEm: z.iso.date(),
  observadoPor: z.string().min(1),

  gate: z.object({
    inventarioComSerie: estadoDeGate,
    firmwareRegistrado: estadoDeGate,
    sdkDisponivelLegalmente: estadoDeGate,
    windowsERedeIsolada: estadoDeGate,
    diagramaFisicoAprovado: estadoDeGate,
    consentimentoParticipantes: estadoDeGate,
    paradaDeEmergenciaDefinida: estadoDeGate,
  }),

  dispositivos: z.array(esquemaDispositivo).min(1),

  hospedeiro: z.object({
    papel: z.string().min(1),
    so: z.string().min(1),
    versaoExata: z.string().min(1).or(naoLido),
    arquitetura: z.string().min(1).or(naoLido),
    nomeNaRede: z.string().min(1).or(naoLido),
  }),

  rede: z.object({
    isolada: z.boolean(),
    faixa: z.string().min(1),
    observacao: z.string().optional(),
    /**
     * Como o PC alcanca o equipamento. `tcp-ip` significa que nao ha serial
     * nem porta COM no caminho -- o que muda o ADR-010: sem dependencia de
     * porta fisica, o transporte deixa de ser refem de Windows.
     */
    topologia: z.enum(['tcp-ip', 'serial', 'rs485', 'misto']).optional(),
    meio: z.string().min(1).optional(),
  }),

  /**
   * Software que veio com o equipamento, e que o ArenaHub substitui. A base
   * do ArenaHub e propria e separada -- os usuarios daqui entram por
   * importacao depois, fora do MVP 0.
   */
  softwareDeFabrica: z
    .object({
      // Quantidade, nunca identidade. Nenhum dado de pessoa entra aqui.
      pessoasCadastradas: z.number().int().nonnegative(),
      origem: z.string().min(1),
      destino: z.string().min(1).optional(),
    })
    .optional(),
});

export type Inventario = z.infer<typeof esquemaInventario>;
export type Dispositivo = z.infer<typeof esquemaDispositivo>;

/** Itens do gate que ainda nao estao cumpridos por inteiro. */
export function pendenciasDoGate(inv: Inventario): string[] {
  return Object.entries(inv.gate)
    .filter(([, estado]) => estado !== true)
    .map(([item, estado]) => `${item}: ${estado === 'parcial' ? 'parcial' : 'nao cumprido'}`);
}
