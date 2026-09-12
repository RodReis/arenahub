/**
 * Camada de UI do app do aluno -- F43, contrato em `docs/design/DS-APP.md`.
 *
 * Os componentes que carregam os QUATRO PADROES que o app nao pode errar
 * (SPEC-043 §1) estao todos aqui, e cada um tem o porque escrito no proprio
 * arquivo:
 *
 *   espera de pagamento .... `EstadoDeEspera`  -- nunca escreve "Pago"
 *   carteirinha ............ `Carteirinha`     -- token opaco, sem PII
 *   saude e IA ............. `AvisoDeIA`       -- persistente, nao dispensavel
 *   engajamento ............ `OptInDeEngajamento` -- nasce desligado
 */

export { ProvedorDeTema, useTema, type Tema, type Tom } from './theme.js';

export { Ausente } from './Ausente.js';
export { AvisoDeIA } from './AvisoDeIA.js';
export { Badge } from './Badge.js';
export { Botao, type VarianteDeBotao } from './Botao.js';
export { Card, DivisorDeCard } from './Card.js';
export { Carteirinha } from './Carteirinha.js';
export { EstadoDeEspera } from './EstadoDeEspera.js';
export { OptInDeEngajamento } from './OptInDeEngajamento.js';

export { Alerta, Bloqueio, Check, Informacao, Relogio, ICONE_DO_TOM } from './icones.js';
