/**
 * Contratos compartilhados entre API, Edge Agent e clientes.
 *
 * O que entra aqui e o que PRECISA ser identico nos dois lados. Duas
 * implementacoes da mesma regra divergem no primeiro detalhe esquecido.
 */
export {
  assinar,
  assinaturaConfere,
  calcularHashDoCorpo,
  calcularHashDoNonce,
  montarTextoCanonico,
  normalizarCaminhoEQuery,
  timestampEstaNaJanela,
  CABECALHOS,
  CABECALHOS_DO_KIOSK,
  JANELA_DE_RELOGIO_EM_SEGUNDOS,
  PREFIXO_CANONICO,
  type MotivoDeRecusa,
  type RequisicaoAssinavel,
} from './edge-auth.js';
export {
  ACCENTS_DO_TOTEM,
  CONFIG_PADRAO_DO_TOTEM,
  MAXIMO_DE_PATROCINADORES,
  ROTULO_PADRAO_DE_PATROCINIO,
  TEMPOS_POR_BLOCO,
  TIPOS_DE_BLOCO,
  blocoDaTelaPublicaSchema,
  blocosEmRodizio,
  indicadoresDaUnidadeSchema,
  kioskConfigSchema,
  resolverConfig,
  rotuloDePatrocinio,
} from './kiosk-config.js';
export type {
  BlocoDaTelaPublica,
  IndicadoresDaUnidade,
  KioskConfig,
  KioskConfigLayers,
  TipoDeBloco,
} from './kiosk-config.js';
