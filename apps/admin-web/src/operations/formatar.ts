/**
 * Formatação do painel operacional — F11.
 *
 * Funções puras, testáveis sem montar componente. O que elas resolvem não é
 * estética: é a diferença entre a recepção entender o estado em dois segundos
 * ou precisar interpretar um timestamp ISO enquanto uma pessoa espera.
 */

/**
 * Idade legível de um instante.
 *
 * "há 3 minutos" em vez de `2026-08-16T17:32:11.000Z`. O operador precisa
 * saber se o silêncio começou agora ou ontem — e converter ISO de cabeça, no
 * meio do atendimento, ninguém faz.
 */
export function idadeLegivel(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'nunca';

  const quando = new Date(iso);

  if (!Number.isFinite(quando.getTime())) return '—';

  const segundos = Math.floor((agora.getTime() - quando.getTime()) / 1000);

  // Relógio do navegador adiantado em relação ao servidor produziria "há -3
  // segundos", que parece defeito da tela e não do relógio.
  if (segundos < 0) return 'agora';

  if (segundos < 60) return `há ${segundos}s`;

  const minutos = Math.floor(segundos / 60);

  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);

  if (horas < 24) return `há ${horas}h`;

  return `há ${Math.floor(horas / 24)}d`;
}

/**
 * Um recurso está saudável?
 *
 * Mesmo limite de 90 s das regras de alerta no servidor. A duplicação é
 * consciente e limitada a ISTO: a tela precisa pintar o estado antes de o
 * ciclo de alerta rodar, senão um Edge que caiu há 40 s apareceria verde.
 *
 * O que a tela NÃO faz é decidir se alerta — isso é do servidor, que tem a
 * lista de regras e o histórico.
 */
export const LIMITE_DE_SILENCIO_MS = 90_000;

export function estaSilencioso(iso: string | null, agora: Date = new Date()): boolean {
  if (!iso) return true;

  const quando = new Date(iso);

  if (!Number.isFinite(quando.getTime())) return true;

  return agora.getTime() - quando.getTime() > LIMITE_DE_SILENCIO_MS;
}

/**
 * Rótulos de severidade em pt-BR.
 *
 * `CRITICAL` vira "Crítico" e significa **a catraca não está funcionando
 * agora**. A tela não inventa severidade nova nem reordena: quem classifica é
 * o servidor.
 */
export const ROTULO_DE_SEVERIDADE: Record<string, string> = {
  CRITICAL: 'Crítico',
  WARNING: 'Atenção',
  INFO: 'Informação',
};

export const ROTULO_DE_ESTADO_DE_ALERTA: Record<string, string> = {
  OPEN: 'Aberto',
  ACKNOWLEDGED: 'Reconhecido',
  RESOLVED: 'Resolvido',
};

/**
 * Razões de decisão em pt-BR — ADR-024.
 *
 * O código é estável e serve à correlação; a frase é de interface. Sem a
 * tradução, a recepção veria `WRONG_UNIT` e abriria chamado para descobrir o
 * que fazer.
 *
 * As frases dizem O QUE ACONTECEU, não o que o sistema concluiu: "o plano
 * vale em outra unidade" é acionável; "unidade errada" acusa o aluno.
 */
export const ROTULO_DE_RAZAO: Record<string, string> = {
  ACTIVE_ENTITLEMENT: 'Plano válido',
  MANUAL_OVERRIDE: 'Liberado manualmente pela recepção',
  NO_ENTITLEMENT: 'Sem plano vigente',
  WRONG_UNIT: 'O plano vale em outra unidade',
  OUTSIDE_SCHEDULE: 'Fora do horário do plano',
  STUDENT_BLOCKED: 'Aluno bloqueado',
  STUDENT_INACTIVE: 'Cadastro não está ativo',
  ADMIN_BLOCK: 'Bloqueio administrativo',
};

export const ROTULO_DE_MODO: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  OVERRIDE: 'Liberação manual',
};

export const ROTULO_DE_METODO: Record<string, string> = {
  FACIAL: 'Facial',
  QR: 'QR Code',
  CARD: 'Cartão',
  PIN: 'PIN',
  MANUAL: 'Manual',
};

export const ROTULO_DE_PASSAGEM: Record<string, string> = {
  NOT_APPLICABLE: '—',
  PENDING: 'Aguardando giro',
  CONFIRMED: 'Passou',
  TIMED_OUT: 'Não passou',
};

/** Instante no fuso de Brasília, legível. */
export function instanteLegivel(iso: string | null): string {
  if (!iso) return '—';

  const data = new Date(iso);

  if (!Number.isFinite(data.getTime())) return '—';

  return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Traduz um código, caindo para o próprio código quando não conhece. */
export function traduzir(dicionario: Record<string, string>, codigo: string): string {
  // Cair para o código é deliberado: um valor novo do servidor aparece como
  // está, feio mas correto. Uma tela que mostrasse "—" para código
  // desconhecido esconderia justamente o caso novo que ninguém previu.
  return dicionario[codigo] ?? codigo;
}
