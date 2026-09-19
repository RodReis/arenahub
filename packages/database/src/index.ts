/**
 * Ponto de entrada do pacote de banco.
 *
 * Exporta a factory do client e o tipo gerado. Nenhum repositorio, nenhum
 * caso de uso e nenhuma entidade -- isso e escopo das fatias, nao do
 * bootstrap.
 *
 * REGRA DE ARQUITETURA No 2, para quando a primeira entidade chegar:
 * repositorio recebe `TenantContext` obrigatorio, e o tenant vem da
 * identidade autenticada -- nunca do corpo da requisicao nem do payload de
 * webhook. Este arquivo nao pode dificultar isso; por enquanto so nao
 * atrapalha.
 */
export { criarPrismaClient, type PrismaClientArenaHub } from './client.js';

/**
 * O client gerado, para quem precisa ESTENDE-LO em vez de instancia-lo --
 * caso do `PrismaService` do NestJS, que amarra `$connect`/`$disconnect` ao
 * ciclo de vida do modulo.
 *
 * Quem so precisa de uma conexao usa `criarPrismaClient`.
 */
export { PrismaClient, Prisma } from './generated/client.js';

/**
 * FONTE UNICA das permissoes do OWNER. Exportada do pacote (e nao so usada
 * por dentro) porque a F61 cria tenant pela API, e nao mais so pelo
 * `bootstrap-tenant` -- os dois caminhos leem a MESMA lista. Copia-la ja
 * produziu OWNER real sem `access.read` em producao; ver `permissoes.ts`.
 */
export { PERMISSOES_DO_OWNER } from './permissoes.js';
export { PrismaPg } from '@prisma/adapter-pg';

/**
 * Contexto de tenant para RLS (F66, ADR-054) -- a camada 2 do isolamento.
 *
 * A camada 1 nao muda: repositorio continua recebendo `TenantContext` e
 * filtrando por `tenantId`. Isto e o que faz o Postgres recusar sozinho o
 * que a aplicacao deixar passar.
 */
export {
  aplicarContextoNaTransacao,
  comContexto,
  contextoObrigatorio,
  contextoRls,
  gucsDoContexto,
  SemContextoDeTenantError,
  type ExecutorDeTransacao,
  type Guc,
  type TenantDbContext,
} from './rls.js';

/**
 * Tipos das entidades. Sem eles, um repositorio fora deste pacote nao
 * consegue NOMEAR o que devolve -- o TypeScript reclama de tipo inferido
 * nao portavel (TS2742) e exige anotacao.
 */
export type {
  AccessEvent,
  AccountCredit,
  AccessEventCorrection,
  AccessPassage,
  AccessPolicy,
  AdministrativeBlock,
  AuditLog,
  DataExportJob,
  BiometricAccessLog,
  BiometricIdentity,
  BodyAssessment,
  BodyMeasurement,
  Class,
  ClassException,
  ClassReservation,
  ClassAttendance,
  ConsentDocument,
  ConsentRecord,
  Device,
  DeviceCommand,
  DeviceSyncJob,
  DeviceUser,
  EdgeCredential,
  EdgeNode,
  Entitlement,
  EntitlementUnitWindow,
  FamilyGroup,
  FamilyMember,
  GuestPass,
  Invoice,
  InvoiceItem,
  InvoiceSequence,
  Payment,
  PaymentAttempt,
  PlanBenefit,
  PlanPrice,
  BillingSettings,
  GymUnit,
  GymUnitModality,
  HealthGoal,
  HealthMeasurement,
  InboxReceipt,
  Invitation,
  OutboxEvent,
  Permission,
  Plan,
  PlanAccessWindow,
  PlanClassEntitlement,
  PlanUnit,
  Role,
  RolePermission,
  Session,
  ReplayNonce,
  Student,
  StudentAccount,
  StudentAccountToken,
  StudentAddress,
  StudentContact,
  StudentHealthContext,
  StudentModality,
  StudentSequence,
  StudentSession,
  StudentTimelineEvent,
  ManualAccessOverride,
  OperationalAlert,
  SaasPlan,
  PlatformInvoice,
  IndexValue,
  Subscription,
  Tenant,
  TenantContract,
  TenantMembership,
  TenantPrivacySettings,
  User,
  UserRole,
} from './generated/client.js';

/**
 * Enums de status, para o dominio comparar sem string solta.
 *
 * Exportados como TIPO, nao como valor: o dominio declara os proprios
 * literais (funcao pura nao importa client de banco), e estes servem para
 * amarrar a assinatura de repositorio ao que o Prisma realmente aceita.
 */
export type {
  AccessMethod,
  AccessMode,
  AccessOutcome,
  AccessReason,
  AliasRejectionReason,
  AssessmentStatus,
  BiometricAccessKind,
  BiometricAccessPurpose,
  BiometricIdentityState,
  BodyMeasurementType,
  ClassExceptionType,
  ConsentDecision,
  ConsentDocumentType,
  ConsentSubjectKind,
  DataExportStatus,
  DeviceCommandState,
  DeviceKind,
  DeviceStatus,
  DeviceSyncJobState,
  DeviceSyncOperation,
  DeviceUserState,
  EdgeNodeStatus,
  EngagementDisputeStatus,
  EngagementDisputeSubject,
  EntitlementSource,
  EntitlementStatus,
  HealthContextFactor,
  HealthMeasurementType,
  LeadSource,
  MeasurementSource,
  MeasurementUnit,
  OperationalAlertSeverity,
  OperationalAlertState,
  PassageState,
  ProviderCapability,
  RankingCategory,
  RankingSnapshotStatus,
  PlatformInvoiceStatus,
  SaasPlanStatus,
  SaasPricingModel,
  StudentContactType,
  StudentRegisteredSex,
  StudentStatus,
  StudentTimelineEventType,
  SubscriptionStatus,
  TenantContractStatus,
  XpSourceKind,
} from './generated/client.js';
