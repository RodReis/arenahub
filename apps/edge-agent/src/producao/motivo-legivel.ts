/**
 * Motivo da decisao em portugues, para o LOG do teste de campo.
 *
 * Mesmos textos do painel (`packages/ui/src/domain/state-labels.ts`) -- o
 * Edge nao depende do pacote de UI, entao o mapa e copiado aqui. Os dois
 * ultimos so existem no Edge. Motivo desconhecido volta o proprio codigo:
 * log nunca esconde o que nao sabe traduzir.
 */
const MOTIVOS: Readonly<Record<string, string>> = {
  ACTIVE_ENTITLEMENT: 'Plano válido',
  MANUAL_OVERRIDE: 'Liberado manualmente pela recepção',
  FINANCIAL_OVERRIDE: 'Liberado com pagamento pendente',
  OFFLINE_DEVICE_DECISION: 'Liberado pela catraca offline',
  ADMIN_BLOCK: 'Bloqueio administrativo',
  STUDENT_BLOCKED: 'Aluno bloqueado',
  STUDENT_INACTIVE: 'Cadastro não está ativo',
  NO_ENTITLEMENT: 'Sem plano vigente, ou aluno não identificado (ver Eventos de acesso)',
  WRONG_UNIT: 'O plano vale em outra unidade',
  OUTSIDE_SCHEDULE: 'Fora do horário do plano',
  PAYMENT_OVERDUE: 'Pagamento em atraso',
  TENANT_SUSPENDED: 'Academia suspensa por inadimplência',
  CLOUD_UNAVAILABLE: 'Nuvem não respondeu',
  REENTRADA: 'Reenvio de passagem já decidida',
};

export function motivoLegivel(reason: string): string {
  return MOTIVOS[reason] ?? reason;
}
